import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import ffmpegPath from 'ffmpeg-static'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { ADMIN_EMAILS } from '@/lib/admin'
import { CHOIR_CREDITS, CHOIR_PRESETS, CHOIR_MODE_LABELS, type ChoirMode, type ChoirVoices } from '@/lib/choir-presets'
import { normalizeLoudness } from '@/lib/loudness'

// Choir Composer — DSP vocal harmonizer. Takes the user's uploaded solo vocal
// (a durable audio-uploads path from the existing presign flow) and builds a
// harmony stack entirely with ffmpeg: the vocal is split into N layers, each
// harmony layer is pitch-shifted to a musical interval with
// asetrate → aresample → atempo (atempo restores the original timing; this
// chain exists in every ffmpeg build, unlike the rubberband filter which
// static builds may lack), mixed with the unshifted lead, limited, and encoded
// to MP3. No AI model, no per-run vendor cost — synchronous in one request.
//
// Credits follow the Song Studio pattern: atomic deduct_credits() up front,
// add_credits() refund on ANY failure after the charge (never charged on
// failure), ADMIN_EMAILS bypass both.
//
// The result persists exactly like a swap/Song Studio track: audio in the
// voice-swaps bucket + a kind='choir' voice_swaps row → playable forever via
// the sign-on-read proxy, listed in Saved Tracks, shareable, deletable,
// 90-day retention. No migration needed — `kind` exists (20260712000003).
export const maxDuration = 60

const execFileAsync = promisify(execFile)

const SAMPLE_RATE = 44100
// Uploaded vocal cap — harmonizing needs a solo take, not a full mix; 25 MB
// comfortably covers ~10 min of MP3 or ~4 min of WAV while keeping the
// in-function download + two ffmpeg passes well inside maxDuration.
const MAX_INPUT_BYTES = 25 * 1024 * 1024
// Lead stays dominant; each harmony sits under it. The post-mix limiter
// catches whatever the sum still peaks at.
const LEAD_GAIN = 1.0
const HARMONY_GAIN = 0.55

// Best-effort atomic refund — never throws (gender-split/Song Studio pattern).
async function refundCredits(userId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('add_credits', {
      p_user_id: userId,
      p_amount: CHOIR_CREDITS,
    })
    if (error) console.error('[choir] refund failed:', error.message)
  } catch (err) {
    console.error('[choir] refund threw:', err instanceof Error ? err.message : String(err))
  }
}

// Insert tolerating a deploy that outruns migration 20260712000003 (kind
// column) — same defense as the Song Studio route.
async function insertSwapRow(row: Record<string, unknown>): Promise<{ error: { message: string } | null }> {
  const first = await supabaseAdmin.from('voice_swaps').insert(row)
  if (first.error && /kind/.test(first.error.message)) {
    const { kind: _kind, ...withoutKind } = row
    return supabaseAdmin.from('voice_swaps').insert(withoutKind)
  }
  return first
}

// One harmony chain: shift pitch by `st` semitones without changing duration.
// asetrate resamples the clock (pitch AND speed change by `factor`), aresample
// brings the stream back to the standard rate, atempo=1/factor restores the
// original timing. |st| <= 12 keeps 1/factor inside atempo's 0.5-2.0 range —
// enforced by the preset table, asserted here for safety.
function harmonyChain(inLabel: string, outLabel: string, st: number): string {
  const factor = Math.pow(2, st / 12)
  const tempo = 1 / factor
  if (tempo < 0.5 || tempo > 2.0) throw new Error(`preset offset ${st}st is outside the single-atempo range`)
  return `[${inLabel}]asetrate=${Math.round(SAMPLE_RATE * factor)},aresample=${SAMPLE_RATE},atempo=${tempo.toFixed(6)},volume=${HARMONY_GAIN}[${outLabel}]`
}

export async function POST(req: NextRequest) {
  // Set once credits are debited so every failure path after it can refund.
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

    let body: { vocalPath?: string; voices?: number; mode?: string; title?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { vocalPath } = body
    if (!vocalPath || typeof vocalPath !== 'string' || vocalPath.includes('..')) {
      return NextResponse.json({ error: 'vocalPath is required' }, { status: 400 })
    }
    // The presign flow uploads to `<user_id>/...` — accepting only the
    // caller's own folder keeps this from harmonizing someone else's file.
    if (!vocalPath.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'vocalPath must be one of your own uploads' }, { status: 403 })
    }
    const voices = body.voices as ChoirVoices
    const mode = body.mode as ChoirMode
    if (![2, 4, 8].includes(voices)) {
      return NextResponse.json({ error: 'voices must be 2, 4 or 8' }, { status: 400 })
    }
    if (mode !== 'major' && mode !== 'octaves') {
      return NextResponse.json({ error: "mode must be 'major' or 'octaves'" }, { status: 400 })
    }
    const title = (body.title ?? '').trim().slice(0, 120) || 'Choir harmony'

    // ── Charge BEFORE the work (atomic; refunded on any failure below) ──────
    const isAdmin = ADMIN_EMAILS.includes(user.email ?? '')
    if (!isAdmin) {
      const { error: debitError } = await supabaseAdmin.rpc('deduct_credits', {
        p_user_id: user.id,
        p_amount: CHOIR_CREDITS,
      })
      if (debitError) {
        if (debitError.message.includes('INSUFFICIENT_CREDITS')) {
          return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 })
        }
        console.error('[choir] debit failed:', debitError.message)
        return NextResponse.json({ error: 'Failed to deduct credits' }, { status: 500 })
      }
      chargedUserId = user.id
    }

    // ── Fetch the vocal (sign fresh from the durable path — never a stored
    //    signed URL) ────────────────────────────────────────────────────────
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
    if (vocalBuffer.length > MAX_INPUT_BYTES) {
      if (chargedUserId) await refundCredits(chargedUserId)
      return NextResponse.json({ error: 'Vocal file is too large (max 25 MB) — use a shorter solo take' }, { status: 413 })
    }

    // ── ffmpeg: normalize, then split → shift → mix → limit → mp3 ───────────
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvox-choir-'))
    const inFile = path.join(workDir, 'input')
    const wavFile = path.join(workDir, 'lead.wav')
    const outFile = path.join(workDir, 'choir.mp3')
    await fs.writeFile(inFile, vocalBuffer)

    // Pass 1 — decode whatever arrived (mp3/m4a/webm/wav) to a known-rate WAV
    // so the asetrate math below is exact (ffmpeg-static ships no ffprobe).
    await execFileAsync(ffmpegPath, [
      '-v', 'error', '-y', '-i', inFile,
      '-ac', '2', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', wavFile,
    ])

    // Pass 2 — the harmony stack in one filter graph.
    const offsets = CHOIR_PRESETS[mode][voices]
    const n = offsets.length + 1 // harmonies + unshifted lead
    const splitOuts = Array.from({ length: n }, (_, i) => `s${i}`)
    const chains: string[] = [
      `[0:a]asplit=${n}${splitOuts.map((l) => `[${l}]`).join('')}`,
      `[s0]volume=${LEAD_GAIN}[lead]`,
      ...offsets.map((st, i) => harmonyChain(`s${i + 1}`, `h${i}`, st)),
      `[lead]${offsets.map((_, i) => `[h${i}]`).join('')}amix=inputs=${n}:normalize=0,alimiter=limit=0.891[mix]`,
    ]
    await execFileAsync(ffmpegPath, [
      '-v', 'error', '-y', '-i', wavFile,
      '-filter_complex', chains.join(';'),
      '-map', '[mix]', '-c:a', 'libmp3lame', '-b:a', '256k', outFile,
    ], { timeout: 45000 })

    // amix attenuates the sum, so the stack lands quiet — bring it to the
    // app-wide loudness target (falls back to the raw mix on failure).
    const mixBuffer = await normalizeLoudness(await fs.readFile(outFile), 'mp3', '[choir]')

    // ── Persist as a saved track ─────────────────────────────────────────────
    const swapId = crypto.randomUUID()
    const swapPath = `${user.id}/${swapId}.mp3`
    const { error: uploadError } = await supabaseAdmin.storage
      .from('voice-swaps')
      .upload(swapPath, mixBuffer, { contentType: 'audio/mpeg', upsert: true })
    if (uploadError) {
      if (chargedUserId) await refundCredits(chargedUserId)
      return NextResponse.json({ error: `Storage upload failed: ${uploadError.message}` }, { status: 500 })
    }

    const { error: insertError } = await insertSwapRow({
      id: swapId,
      user_id: user.id,
      song_name: title,
      voice_used: `Your voice ×${voices} · ${CHOIR_MODE_LABELS[mode].label}`,
      result_path: swapPath,
      kind: 'choir',
    })
    if (insertError) {
      await supabaseAdmin.storage.from('voice-swaps').remove([swapPath]).catch(() => {})
      if (chargedUserId) await refundCredits(chargedUserId)
      console.error('[choir] row insert failed:', insertError.message)
      return NextResponse.json({ error: `Could not save the harmony: ${insertError.message}` }, { status: 500 })
    }

    console.log(`[choir] built ${voices}-voice ${mode} stack → swap ${swapId} (${mixBuffer.length} bytes)`)
    return NextResponse.json({
      swapId,
      url: `/api/voice-swaps/${swapId}/result.mp3`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[choir] failed:', msg)
    if (chargedUserId) await refundCredits(chargedUserId)
    return NextResponse.json({ error: msg }, { status: 500 })
  } finally {
    if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
