import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { createRequire } from 'module'
import ffmpegPath from 'ffmpeg-static'
import * as tf from '@tensorflow/tfjs'
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm'
import {
  BasicPitch,
  outputToNotesPoly,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
} from '@spotify/basic-pitch'
import tonejsMidi from '@tonejs/midi'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { ADMIN_EMAILS } from '@/lib/admin'
import { logStageTiming } from '@/lib/replicate-timing'
import {
  INSTRUMENTS_CREDITS,
  INSTRUMENTS_MAX_SECONDS,
  INSTRUMENTS_MAX_BYTES,
  MIN_NOTE_SECONDS,
  MIN_NOTE_AMPLITUDE,
  findInstrument,
} from '@/lib/instruments'

// Instruments — voice → instrument, all local compute in this one function
// (pipeline proven by scripts/spike-voice-to-instrument.mjs; see PROJECT_STATUS
// §6): the user's monophonic vocal is decoded to 22050 Hz mono, transcribed to
// notes by Basic Pitch (tfjs WASM backend, ~10× faster than the JS-CPU backend
// in local measurement, with CPU fallback), filtered for spurious short/quiet
// notes, written as MIDI, and rendered through js-synthesizer (libfluidsynth
// WASM) with the bundled TimGM6mb GM soundfont on the chosen program.
//
// Credits: Choir pattern — atomic deduct_credits() up front, add_credits()
// refund on EVERY failure path after the charge, ADMIN_EMAILS bypass.
// Result: a normal saved track (voice-swaps bucket + kind='instrument' row →
// sign-on-read playback, Saved Tracks, share, delete, 90-day retention).
export const maxDuration = 60

const { Midi } = tonejsMidi
const execFileAsync = promisify(execFile)
const nodeRequire = createRequire(import.meta.url)

const BP_SAMPLE_RATE = 22050
const RENDER_SAMPLE_RATE = 44100
const RENDER_CHUNK = 8192

// ── Module-level singletons (reused across warm invocations) ────────────────

// tfjs backend: prefer WASM (SIMD), fall back to the pure-JS CPU backend if
// the .wasm assets didn't ship or fail to instantiate on the lambda.
let tfReadyPromise: Promise<string> | null = null
function ensureTf(): Promise<string> {
  if (!tfReadyPromise) {
    tfReadyPromise = (async () => {
      try {
        setWasmPaths(path.join(path.dirname(nodeRequire.resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist') + path.sep)
        await tf.setBackend('wasm')
        await tf.ready()
      } catch (err) {
        console.warn('[instruments] wasm backend unavailable, using cpu:', err instanceof Error ? err.message : String(err))
        await tf.setBackend('cpu')
        await tf.ready()
      }
      return tf.getBackend()
    })()
  }
  return tfReadyPromise
}

// Basic Pitch model, loaded from the package's own files (the browser-oriented
// tfjs loads via fetch, so hand it a filesystem IOHandler).
let basicPitchInstance: BasicPitch | null = null
async function getBasicPitch(): Promise<BasicPitch> {
  if (basicPitchInstance) return basicPitchInstance
  const modelDir = path.dirname(nodeRequire.resolve('@spotify/basic-pitch/model/model.json'))
  const fileIOHandler = {
    load: async () => {
      const modelJSON = JSON.parse(await fs.readFile(path.join(modelDir, 'model.json'), 'utf8'))
      const shards: Buffer[] = []
      for (const group of modelJSON.weightsManifest) {
        for (const p of group.paths) shards.push(await fs.readFile(path.join(modelDir, p)))
      }
      return {
        modelTopology: modelJSON.modelTopology,
        format: modelJSON.format,
        generatedBy: modelJSON.generatedBy,
        convertedBy: modelJSON.convertedBy,
        weightSpecs: modelJSON.weightsManifest.flatMap((g: { weights: unknown[] }) => g.weights),
        weightData: new Uint8Array(Buffer.concat(shards)).buffer,
      }
    },
  }
  basicPitchInstance = new BasicPitch(tf.loadGraphModel(fileIOHandler as never))
  return basicPitchInstance
}

// js-synthesizer needs its Emscripten module registered before first use.
let synthReadyPromise: Promise<typeof import('js-synthesizer')> | null = null
function ensureSynth(): Promise<typeof import('js-synthesizer')> {
  if (!synthReadyPromise) {
    synthReadyPromise = (async () => {
      const libfluid = nodeRequire('js-synthesizer/externals/libfluidsynth-2.4.6.js')
      const g = globalThis as { Module?: unknown }
      if (typeof g.Module === 'undefined') g.Module = libfluid
      const JSSynth = nodeRequire('js-synthesizer')
      await JSSynth.waitForReady()
      return JSSynth
    })()
  }
  return synthReadyPromise
}

// Best-effort atomic refund — never throws (Choir pattern).
async function refundCredits(userId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('add_credits', {
      p_user_id: userId,
      p_amount: INSTRUMENTS_CREDITS,
    })
    if (error) console.error('[instruments] refund failed:', error.message)
  } catch (err) {
    console.error('[instruments] refund threw:', err instanceof Error ? err.message : String(err))
  }
}

// Insert tolerating a deploy that outruns migration 20260712000003 (kind).
async function insertSwapRow(row: Record<string, unknown>): Promise<{ error: { message: string } | null }> {
  const first = await supabaseAdmin.from('voice_swaps').insert(row)
  if (first.error && /kind/.test(first.error.message)) {
    const { kind: _kind, ...withoutKind } = row
    return supabaseAdmin.from('voice_swaps').insert(withoutKind)
  }
  return first
}

export async function POST(req: NextRequest) {
  let chargedUserId: string | null = null
  let workDir: string | null = null
  try {
    if (!adminConfigured) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    if (!ffmpegPath) {
      return NextResponse.json({ error: 'Audio engine unavailable on this platform' }, { status: 500 })
    }

    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    let body: { vocalPath?: string; instrumentId?: string; title?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { vocalPath, instrumentId } = body
    if (!vocalPath || typeof vocalPath !== 'string' || vocalPath.includes('..')) {
      return NextResponse.json({ error: 'vocalPath is required' }, { status: 400 })
    }
    if (!vocalPath.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'vocalPath must be one of your own uploads' }, { status: 403 })
    }
    const instrument = instrumentId ? findInstrument(instrumentId) : undefined
    if (!instrument) {
      return NextResponse.json({ error: 'Unknown instrument' }, { status: 400 })
    }
    const title = (body.title ?? '').trim().slice(0, 120) || `${instrument.label} melody`

    // ── Charge BEFORE the work (atomic; refunded on any failure below) ──────
    const isAdmin = ADMIN_EMAILS.includes(user.email ?? '')
    if (!isAdmin) {
      const { error: debitError } = await supabaseAdmin.rpc('deduct_credits', {
        p_user_id: user.id,
        p_amount: INSTRUMENTS_CREDITS,
      })
      if (debitError) {
        if (debitError.message.includes('INSUFFICIENT_CREDITS')) {
          return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 })
        }
        console.error('[instruments] debit failed:', debitError.message)
        return NextResponse.json({ error: 'Failed to deduct credits' }, { status: 500 })
      }
      chargedUserId = user.id
    }

    // ── Fetch the vocal (fresh signature from the durable path) ─────────────
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('audio-uploads')
      .createSignedUrl(vocalPath, 300)
    if (signErr || !signed?.signedUrl) {
      if (chargedUserId) await refundCredits(chargedUserId)
      return NextResponse.json({ error: 'Could not read the uploaded vocal — upload it again' }, { status: 404 })
    }
    const vocalRes = await fetch(signed.signedUrl)
    if (!vocalRes.ok) {
      if (chargedUserId) await refundCredits(chargedUserId)
      return NextResponse.json({ error: `Vocal download failed (http ${vocalRes.status})` }, { status: 502 })
    }
    const vocalBuffer = Buffer.from(await vocalRes.arrayBuffer())
    if (vocalBuffer.length > INSTRUMENTS_MAX_BYTES) {
      if (chargedUserId) await refundCredits(chargedUserId)
      return NextResponse.json({ error: 'Vocal file is too large — record a shorter take' }, { status: 413 })
    }

    // ── Decode to 22050 Hz mono float32 (Basic Pitch's expected input) ──────
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvox-instr-'))
    const inFile = path.join(workDir, 'input')
    const f32File = path.join(workDir, 'in.f32')
    await fs.writeFile(inFile, vocalBuffer)
    await execFileAsync(ffmpegPath, [
      '-v', 'error', '-y', '-i', inFile,
      '-f', 'f32le', '-ar', String(BP_SAMPLE_RATE), '-ac', '1', f32File,
    ])
    const rawPcm = await fs.readFile(f32File)
    const audio = new Float32Array(rawPcm.buffer, rawPcm.byteOffset, rawPcm.byteLength / 4)
    const audioSeconds = audio.length / BP_SAMPLE_RATE
    if (audioSeconds < 1) {
      if (chargedUserId) await refundCredits(chargedUserId)
      return NextResponse.json({ error: 'The recording is too short — sing or hum at least a second' }, { status: 400 })
    }
    if (audioSeconds > INSTRUMENTS_MAX_SECONDS) {
      if (chargedUserId) await refundCredits(chargedUserId)
      return NextResponse.json(
        { error: `Keep it under ${INSTRUMENTS_MAX_SECONDS} seconds for now (yours is ${Math.round(audioSeconds)}s)` },
        { status: 413 }
      )
    }

    // ── Audio → notes (Basic Pitch) ──────────────────────────────────────────
    const backend = await ensureTf()
    const basicPitch = await getBasicPitch()
    const frames: number[][] = []
    const onsets: number[][] = []
    const contours: number[][] = []
    const tInfer = Date.now()
    await basicPitch.evaluateModel(
      audio,
      (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c) },
      () => {}
    )
    const inferMs = Date.now() - tInfer
    // Tune INSTRUMENTS_MAX_SECONDS from these lines after first deploy.
    logStageTiming('basicpitch', inferMs, { cold: 'n/a' })
    console.log(`[instruments] basic-pitch backend=${backend} audio=${audioSeconds.toFixed(1)}s inference=${inferMs}ms`)

    const allNotes = noteFramesToTime(
      addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.25, 0.25, 5))
    )
    // Spurious-note filter: hums produce brief low-confidence artifacts around
    // breaths and note transitions.
    const notes = allNotes.filter((n) => n.durationSeconds >= MIN_NOTE_SECONDS && n.amplitude >= MIN_NOTE_AMPLITUDE)
    console.log(`[instruments] notes: ${allNotes.length} transcribed, ${notes.length} after filter`)
    if (notes.length === 0) {
      if (chargedUserId) await refundCredits(chargedUserId)
      return NextResponse.json(
        { error: 'No melody detected — try a clearer, single-note hum or la-la take (no chords, minimal background)' },
        { status: 422 }
      )
    }

    // ── Notes → MIDI ─────────────────────────────────────────────────────────
    const midi = new Midi()
    const track = midi.addTrack()
    track.instrument.number = instrument.gmProgram
    for (const n of notes) {
      track.addNote({
        midi: n.pitchMidi,
        time: n.startTimeSeconds,
        duration: n.durationSeconds,
        velocity: Math.min(1, n.amplitude),
      })
    }
    const midBytes = Buffer.from(midi.toArray())

    // ── MIDI → instrument audio (WASM FluidSynth + bundled GM soundfont) ────
    const JSSynth = await ensureSynth()
    const synth = new JSSynth.Synthesizer()
    synth.init(RENDER_SAMPLE_RATE)
    const sf2 = await fs.readFile(path.join(process.cwd(), 'assets/soundfonts/TimGM6mb.sf2'))
    await synth.loadSFont(sf2.buffer.slice(sf2.byteOffset, sf2.byteOffset + sf2.byteLength))
    await synth.addSMFDataToPlayer(midBytes.buffer.slice(midBytes.byteOffset, midBytes.byteOffset + midBytes.byteLength))
    await synth.playPlayer()

    const chunks: Array<[Float32Array, Float32Array]> = []
    let renderedFrames = 0
    const maxFrames = RENDER_SAMPLE_RATE * Math.ceil(audioSeconds + 3) // runaway guard
    while (synth.isPlayerPlaying() && renderedFrames < maxFrames) {
      const l = new Float32Array(RENDER_CHUNK)
      const r = new Float32Array(RENDER_CHUNK)
      synth.render([l, r])
      chunks.push([l, r])
      renderedFrames += RENDER_CHUNK
    }
    for (let i = 0; i < Math.ceil(RENDER_SAMPLE_RATE / RENDER_CHUNK); i++) { // 1s release tail
      const l = new Float32Array(RENDER_CHUNK)
      const r = new Float32Array(RENDER_CHUNK)
      synth.render([l, r])
      chunks.push([l, r])
      renderedFrames += RENDER_CHUNK
    }
    synth.close()

    const interleaved = new Float32Array(renderedFrames * 2)
    let o = 0
    for (const [l, r] of chunks) {
      for (let i = 0; i < l.length; i++) {
        interleaved[o++] = l[i]
        interleaved[o++] = r[i]
      }
    }
    const outF32 = path.join(workDir, 'out.f32')
    const outMp3 = path.join(workDir, 'out.mp3')
    await fs.writeFile(outF32, Buffer.from(interleaved.buffer))
    // TimGM6mb renders quiet — bring it up, hard-cap at −1 dB.
    await execFileAsync(ffmpegPath, [
      '-v', 'error', '-y', '-f', 'f32le', '-ar', String(RENDER_SAMPLE_RATE), '-ac', '2', '-i', outF32,
      '-af', 'volume=12dB,alimiter=limit=0.891',
      '-c:a', 'libmp3lame', '-b:a', '256k', outMp3,
    ])
    const mp3Buffer = await fs.readFile(outMp3)

    // ── Persist as a saved track ─────────────────────────────────────────────
    const swapId = crypto.randomUUID()
    const swapPath = `${user.id}/${swapId}.mp3`
    const { error: uploadError } = await supabaseAdmin.storage
      .from('voice-swaps')
      .upload(swapPath, mp3Buffer, { contentType: 'audio/mpeg', upsert: true })
    if (uploadError) {
      if (chargedUserId) await refundCredits(chargedUserId)
      return NextResponse.json({ error: `Storage upload failed: ${uploadError.message}` }, { status: 500 })
    }

    const { error: insertError } = await insertSwapRow({
      id: swapId,
      user_id: user.id,
      song_name: title,
      voice_used: `${instrument.emoji} ${instrument.label} · from your voice`,
      result_path: swapPath,
      kind: 'instrument',
    })
    if (insertError) {
      await supabaseAdmin.storage.from('voice-swaps').remove([swapPath]).catch(() => {})
      if (chargedUserId) await refundCredits(chargedUserId)
      console.error('[instruments] row insert failed:', insertError.message)
      return NextResponse.json({ error: `Could not save the result: ${insertError.message}` }, { status: 500 })
    }

    console.log(`[instruments] ${notes.length} notes → ${instrument.id} → swap ${swapId} (${mp3Buffer.length} bytes)`)
    return NextResponse.json({
      swapId,
      url: `/api/voice-swaps/${swapId}/result.mp3`,
      noteCount: notes.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[instruments] failed:', msg)
    if (chargedUserId) await refundCredits(chargedUserId)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
