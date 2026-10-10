// Main-thread side of dsp.worker.ts: one shared worker, promise per request.
// If a worker can't be created, the same functions run on the page instead
// (slower to respond, same result).

import type { ShiftOptions } from '@/lib/audio-dsp/stretch'
import type { KeyEstimate } from '@/lib/audio-dsp/key-detect'
import type { HarmonyMode, HarmonyVoices } from '@/lib/audio-dsp/harmony-mode'
import type { Filter } from '@/lib/audio-dsp/tone-match'

type ShiftReq = { op: 'shift'; channels: Float32Array[]; sampleRate: number; options: ShiftOptions }
type KeyReq = { op: 'key'; mono: Float32Array; sampleRate: number }
type DoublesReq = { op: 'doubles'; channels: Float32Array[]; sampleRate: number; lead: Float32Array }
type PitchStatsReq = { op: 'pitchStats'; mono: Float32Array; sampleRate: number }
type HarmonyReq = { op: 'harmony'; mono: Float32Array; sampleRate: number; voices: HarmonyVoices; key: KeyEstimate | null; formantSemitones: number }
type PolishReq = { op: 'polish'; mono: Float32Array; sampleRate: number; airTargetDb: number }
type AirShareReq = { op: 'airShare'; mono: Float32Array; sampleRate: number }
type LufsReq = { op: 'lufs'; channels: Float32Array[]; sampleRate: number }
type MasterReq = { op: 'master'; channels: Float32Array[]; sampleRate: number; targetLufs: number; gain?: number }
type SpectrumReq = { op: 'spectrum'; channels: Float32Array[]; sampleRate: number }
type FiltersReq = { op: 'filters'; channels: Float32Array[]; sampleRate: number; filters: Filter[] }
type AlignReq = { op: 'align'; channels: Float32Array[]; sampleRate: number; other: Float32Array[] }
// Mastering step times inside the worker: the gain search, then the limiter.
export type MasterMs = { search: number; limit: number }
type AnyReq = ShiftReq | KeyReq | HarmonyReq | DoublesReq | PitchStatsReq | PolishReq | AirShareReq | LufsReq | MasterReq | SpectrumReq | FiltersReq | AlignReq
export type DspRequest = AnyReq & { id: number }
export type DspResponse =
  | { id: number; ok: true; channels?: Float32Array[]; key?: KeyEstimate; mode?: HarmonyMode; stats?: { medianMidi: number; voicedSeconds: number }; value?: number; ms?: MasterMs; nums?: number[] }
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
  if (req.op === 'polish') {
    const { polishVoice } = await import('@/lib/audio-dsp/voice-polish')
    return { id: req.id, ok: true, channels: [polishVoice(req.mono, req.sampleRate, req.airTargetDb)] }
  }
  if (req.op === 'airShare') {
    const { airShare } = await import('@/lib/audio-dsp/voice-polish')
    return { id: req.id, ok: true, value: airShare(req.mono, req.sampleRate) }
  }
  if (req.op === 'lufs') {
    const { lufs } = await import('@/lib/audio-dsp/master')
    return { id: req.id, ok: true, value: lufs(req.channels, req.sampleRate) }
  }
  if (req.op === 'spectrum' || req.op === 'filters' || req.op === 'align') {
    const t = await import('@/lib/audio-dsp/tone-match')
    if (req.op === 'spectrum') return { id: req.id, ok: true, channels: [Float32Array.from(t.powerSpectrum(req.channels))] }
    if (req.op === 'filters') return { id: req.id, ok: true, channels: t.applyFilters(req.channels, req.sampleRate, req.filters) }
    const a = t.alignLag(req.channels, req.other, req.sampleRate)
    return { id: req.id, ok: true, nums: a ? [a.lag, a.gain] : [] }
  }
  if (req.op === 'master') {
    const { masterGain, limit } = await import('@/lib/audio-dsp/master')
    const t0 = performance.now()
    const gain = req.gain ?? masterGain(req.channels, req.sampleRate, req.targetLufs)
    const t1 = performance.now()
    const channels = limit(req.channels, req.sampleRate, gain)
    return { id: req.id, ok: true, value: gain, channels, ms: { search: t1 - t0, limit: performance.now() - t1 } }
  }
  const { renderHarmony } = await import('@/lib/audio-dsp/harmony')
  const { stem, mode } = await renderHarmony(req.mono, req.sampleRate, req.voices, req.key, req.formantSemitones)
  return { id: req.id, ok: true, channels: [stem], mode }
}

function call(req: AnyReq, transfer: Transferable[]): Promise<DspResponse> {
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

// Studio voice (voice-polish.ts): de-ess + gentle compression + air tuned to
// `airTargetDb` (the original lead's airShare).
export async function dspPolishVoice(mono: Float32Array, sampleRate: number, airTargetDb: number): Promise<Float32Array> {
  const r = await call({ op: 'polish', mono, sampleRate, airTargetDb }, [mono.buffer])
  if (!r.ok || !r.channels?.[0]) throw new Error('Voice polish failed')
  return r.channels[0]
}

export async function dspAirShare(mono: Float32Array, sampleRate: number): Promise<number> {
  const r = await call({ op: 'airShare', mono, sampleRate }, [mono.buffer])
  if (!r.ok || typeof r.value !== 'number') throw new Error('Air analysis failed')
  return r.value
}

export async function dspLufs(channels: Float32Array[], sampleRate: number): Promise<number> {
  const r = await call({ op: 'lufs', channels, sampleRate }, channels.map((c) => c.buffer))
  if (!r.ok || typeof r.value !== 'number') throw new Error('Loudness analysis failed')
  return r.value
}

// Mastering (master.ts): finds the gain for `targetLufs` (or uses `gain`) and
// returns it with the limited audio (+ how long the search and limiter took).
export async function dspMaster(channels: Float32Array[], sampleRate: number, targetLufs: number, gain?: number): Promise<{ gain: number; channels: Float32Array[]; ms: MasterMs }> {
  const r = await call({ op: 'master', channels, sampleRate, targetLufs, gain }, channels.map((c) => c.buffer))
  if (!r.ok || typeof r.value !== 'number' || !r.channels?.length) throw new Error('Mastering failed')
  return { gain: r.value, channels: r.channels, ms: r.ms ?? { search: NaN, limit: NaN } }
}

// Tone tools (audio-dsp/tone-match.ts): average power spectrum of the loud
// parts (bin k = k·sr/8192 Hz), a biquad chain applied offline, and the
// delay + gain that line `other` up with `channels` (null = no clear match).
export async function dspSpectrum(channels: Float32Array[], sampleRate: number): Promise<Float64Array> {
  const r = await call({ op: 'spectrum', channels, sampleRate }, channels.map((c) => c.buffer))
  if (!r.ok || !r.channels?.[0]) throw new Error('Spectrum failed')
  return Float64Array.from(r.channels[0])
}
export async function dspFilters(channels: Float32Array[], sampleRate: number, filters: Filter[]): Promise<Float32Array[]> {
  const r = await call({ op: 'filters', channels, sampleRate, filters }, channels.map((c) => c.buffer))
  if (!r.ok || !r.channels?.length) throw new Error('Filtering failed')
  return r.channels
}
export async function dspAlign(channels: Float32Array[], other: Float32Array[], sampleRate: number): Promise<{ lag: number; gain: number } | null> {
  const r = await call({ op: 'align', channels, sampleRate, other }, [...channels, ...other].map((c) => c.buffer))
  if (!r.ok) throw new Error('Alignment failed')
  return r.nums && r.nums.length === 2 ? { lag: r.nums[0], gain: r.nums[1] } : null
}
