// Main-thread side of dsp.worker.ts: one shared worker, promise per request.
// If a worker can't be created, the same functions run on the page instead
// (slower to respond, same result).

import type { ShiftOptions } from '@/lib/audio-dsp/stretch'
import type { KeyEstimate } from '@/lib/audio-dsp/key-detect'
import type { HarmonyMode, HarmonyVoices } from '@/lib/audio-dsp/harmony-mode'

type ShiftReq = { op: 'shift'; channels: Float32Array[]; sampleRate: number; options: ShiftOptions }
type KeyReq = { op: 'key'; mono: Float32Array; sampleRate: number }
type DoublesReq = { op: 'doubles'; channels: Float32Array[]; sampleRate: number; lead: Float32Array }
type PitchStatsReq = { op: 'pitchStats'; mono: Float32Array; sampleRate: number }
type HarmonyReq = { op: 'harmony'; mono: Float32Array; sampleRate: number; voices: HarmonyVoices; key: KeyEstimate | null; formantSemitones: number }
export type DspRequest = (ShiftReq | KeyReq | HarmonyReq | DoublesReq | PitchStatsReq) & { id: number }
export type DspResponse =
  | { id: number; ok: true; channels?: Float32Array[]; key?: KeyEstimate; mode?: HarmonyMode; stats?: { medianMidi: number; voicedSeconds: number } }
  | { id: number; ok: false; error: string }

let worker: Worker | null = null
let workerFailed = false
let nextId = 1
const pending = new Map<number, { resolve: (r: DspResponse) => void; reject: (e: Error) => void }>()

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker
  try {
    worker = new Worker(new URL('./dsp.worker.ts', import.meta.url))
    worker.onmessage = (e: MessageEvent<DspResponse>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data)
      else p.reject(new Error(e.data.error))
    }
    worker.onerror = (e) => {
      // A crashed worker fails everything in flight; later calls run inline.
      console.error('[dsp] worker error:', e.message)
      workerFailed = true
      worker?.terminate()
      worker = null
      pending.forEach((p) => p.reject(new Error('Audio processing failed')))
      pending.clear()
    }
  } catch (err) {
    console.warn('[dsp] no worker — processing on the page:', err)
    workerFailed = true
    worker = null
  }
  return worker
}

async function runInline(req: DspRequest): Promise<DspResponse> {
  if (req.op === 'shift') {
    const { shiftAudio } = await import('@/lib/audio-dsp/stretch')
    return { id: req.id, ok: true, channels: await shiftAudio(req.channels, req.sampleRate, req.options) }
  }
  if (req.op === 'doubles') {
    const { removeDoubles } = await import('@/lib/audio-dsp/doubles')
    return { id: req.id, ok: true, channels: removeDoubles(req.channels, req.sampleRate, req.lead) }
  }
  if (req.op === 'pitchStats') {
    const { pitchStats } = await import('@/lib/audio-dsp/pitch-track')
    return { id: req.id, ok: true, stats: pitchStats(req.mono, req.sampleRate) }
  }
  if (req.op === 'key') {
    const { detectKey } = await import('@/lib/audio-dsp/key-detect')
    return { id: req.id, ok: true, key: detectKey(req.mono, req.sampleRate) }
  }
  const { renderHarmony } = await import('@/lib/audio-dsp/harmony')
  const { stem, mode } = await renderHarmony(req.mono, req.sampleRate, req.voices, req.key, req.formantSemitones)
  return { id: req.id, ok: true, channels: [stem], mode }
}

function call(req: ShiftReq | KeyReq | HarmonyReq | DoublesReq | PitchStatsReq, transfer: Transferable[]): Promise<DspResponse> {
  const full = { ...req, id: nextId++ } as DspRequest
  const w = getWorker()
  if (!w) return runInline(full)
  return new Promise((resolve, reject) => {
    pending.set(full.id, { resolve, reject })
    w.postMessage(full, transfer)
  })
}

// Inputs are transferred (the caller's arrays become unusable) — pass copies.
export async function dspShift(channels: Float32Array[], sampleRate: number, options: ShiftOptions): Promise<Float32Array[]> {
  const r = await call({ op: 'shift', channels, sampleRate, options }, channels.map((c) => c.buffer))
  return (r.ok && r.channels) || []
}

// Backing vocals with the lead's same-note doubles removed (doubles.ts).
export async function dspRemoveDoubles(channels: Float32Array[], sampleRate: number, lead: Float32Array): Promise<Float32Array[]> {
  const r = await call({ op: 'doubles', channels, sampleRate, lead }, [...channels.map((c) => c.buffer), lead.buffer])
  if (!r.ok || !r.channels?.length) throw new Error('Backing clean-up failed')
  return r.channels
}

// Median sung note + seconds of clear pitch (Auto Song Key).
export async function dspPitchStats(mono: Float32Array, sampleRate: number): Promise<{ medianMidi: number; voicedSeconds: number }> {
  const r = await call({ op: 'pitchStats', mono, sampleRate }, [mono.buffer])
  if (!r.ok || !r.stats) throw new Error('Pitch analysis failed')
  return r.stats
}

export async function dspKey(mono: Float32Array, sampleRate: number): Promise<KeyEstimate> {
  const r = await call({ op: 'key', mono, sampleRate }, [mono.buffer])
  if (!r.ok || !r.key) throw new Error('Key detection failed')
  return r.key
}

export async function dspHarmony(
  mono: Float32Array, sampleRate: number, voices: HarmonyVoices, key: KeyEstimate | null, formantSemitones: number,
): Promise<{ stem: Float32Array; mode: HarmonyMode }> {
  const r = await call({ op: 'harmony', mono, sampleRate, voices, key, formantSemitones }, [mono.buffer])
  if (!r.ok || !r.channels?.[0] || !r.mode) throw new Error('Harmony failed')
  return { stem: r.channels[0], mode: r.mode }
}
