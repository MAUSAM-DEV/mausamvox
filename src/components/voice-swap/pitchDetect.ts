// Client-side pitch (F0) detection + octave-based "auto key matching" for swaps.
//
// Why this exists: RVC imposes the target clone's identity well only when the
// source vocal sits within the clone's natural pitch range. When the source is
// roughly an octave (or more) above/below the clone, RVC falls back toward the
// SOURCE timbre and the swap sounds near-original (the bug we traced on
// "Aahista Aahista": a high source stem converted by a lower clone with
// pitch_change_all:0). We estimate the source stem's median F0 and the target
// clone's median F0 (from its reference sample) and, when they differ by close
// to a whole number of octaves, shift the source by that many octaves before
// conversion. Octave shifts preserve pitch class, so the converted vocal still
// fits the song's key/instrumental — but it now lands in the clone's range.
//
// Crucially, anything short of a near-octave gap yields a 0 shift, so swaps that
// already sound correct are left exactly as they were.

// ── F0 estimation tuning ─────────────────────────────────────────────────────
const ANALYSIS_MAX_S = 60      // cap CPU: analyse at most the first 60 s
const DECIMATE = 4             // 44.1k → ~11k: cheaper autocorrelation, ample for F0
const FRAME_S = 0.0928         // ~93 ms analysis window
const HOP_S = 0.0464           // ~46 ms hop
const F0_MIN = 80              // Hz — covers low male
const F0_MAX = 500             // Hz — covers high female
const VOICED_RMS = 0.01        // per-frame RMS gate (~ -40 dBFS)
const AUTOCORR_VOICED = 0.30   // min normalised autocorrelation peak to accept a frame
const MIN_VOICED_FRAMES = 12   // absolute floor: fewer than this → no usable median

// Higher bar for trusting a detection enough to AUTO-SHIFT on it. Separated duet
// half-stems have stripped fundamentals and yield very few voiced frames (~17–33
// observed) which mis-read F0 by an octave; full vocals and clone samples yield
// many (hundreds). Below this, auto key-match defaults to 0 (manual still works).
export const MIN_RELIABLE_VOICED_FRAMES = 150

// ── Auto key-match tuning ────────────────────────────────────────────────────
// Act only when the gap is within OCTAVE_TOLERANCE of a whole number of octaves,
// so ambiguous mid-range gaps (e.g. a fifth) are left alone rather than risk an
// over-correction on a swap that may already be fine.
const OCTAVE_TOLERANCE = 0.35
const MAX_OCTAVES = 2

function toMono(buffer: AudioBuffer): Float32Array {
  const ch = Math.min(buffer.numberOfChannels, 2)
  const a = buffer.getChannelData(0)
  if (ch < 2) return a
  const b = buffer.getChannelData(1)
  const out = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = 0.5 * (a[i] + b[i])
  return out
}

function decimate(x: Float32Array, factor: number): Float32Array {
  const n = Math.floor(x.length / factor)
  const y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < factor; k++) s += x[i * factor + k]
    y[i] = s / factor
  }
  return y
}

// Result of a median-F0 estimate: the pitch plus how many voiced frames backed
// it — voicedFrames is a confidence proxy (see MIN_RELIABLE_VOICED_FRAMES).
export type MedianF0 = { f0: number; voicedFrames: number }

// Estimate the median fundamental frequency (Hz) of a decoded vocal buffer using
// frame-wise autocorrelation. Returns null when there isn't enough voiced
// material to be confident. Pure + synchronous so it's easy to reason about.
export function estimateMedianF0(buffer: AudioBuffer): MedianF0 | null {
  const sr = buffer.sampleRate / DECIMATE
  const x = decimate(toMono(buffer), DECIMATE)
  const frame = Math.round(FRAME_S * sr)
  const hop = Math.round(HOP_S * sr)
  const lagMin = Math.floor(sr / F0_MAX)
  const lagMax = Math.min(Math.floor(sr / F0_MIN), frame - 1)
  const limit = Math.min(x.length, Math.round(ANALYSIS_MAX_S * sr))
  if (lagMax <= lagMin) return null

  const f0s: number[] = []
  for (let off = 0; off + frame <= limit; off += hop) {
    let r0 = 0
    for (let i = 0; i < frame; i++) r0 += x[off + i] * x[off + i]
    if (r0 <= 0 || Math.sqrt(r0 / frame) < VOICED_RMS) continue

    let bestLag = -1
    let bestR = 0
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let s = 0
      for (let i = 0; i + lag < frame; i++) s += x[off + i] * x[off + i + lag]
      const r = s / r0
      if (r > bestR) { bestR = r; bestLag = lag }
    }
    if (bestLag < 0 || bestR < AUTOCORR_VOICED) continue

    // Octave-up guard: harmonic-rich voices can make autocorrelation lock onto a
    // sub-period (reading F0 an octave too high). If double the lag (one octave
    // lower) is also a strong peak, the true fundamental is the lower one.
    const dbl = bestLag * 2
    if (dbl <= lagMax) {
      let s = 0
      for (let i = 0; i + dbl < frame; i++) s += x[off + i] * x[off + i + dbl]
      if (s / r0 >= 0.8 * bestR) bestLag = dbl
    }
    f0s.push(sr / bestLag)
  }

  if (f0s.length < MIN_VOICED_FRAMES) return null
  f0s.sort((a, b) => a - b)
  return { f0: f0s[Math.floor(f0s.length / 2)], voicedFrames: f0s.length }
}

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

// Fetch + decode an audio URL and return its median F0 + voiced-frame count, or
// null on ANY failure (network, decode, too few voiced frames, timeout). Never
// throws — null simply means "don't auto-shift", keeping the swap as today.
export async function detectMedianF0(url: string, timeoutMs = 20000): Promise<MedianF0 | null> {
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return null
  let ctx: AudioContext | null = null
  try {
    const res = await fetchWithTimeout(url, timeoutMs)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    ctx = new AudioCtx()
    const decoded = await ctx.decodeAudioData(buf)
    return estimateMedianF0(decoded)
  } catch {
    return null
  } finally {
    if (ctx) { try { await ctx.close() } catch { /* ignore */ } }
  }
}

// Octave-snapped auto key-match shift, in semitones. Returns 0 when either F0 is
// unknown OR the source/target gap isn't close to a whole octave — so aligned
// swaps (and all failure cases) are left untouched. Positive = shift the source
// UP toward the target; negative = shift DOWN.
export function autoOctaveShiftSemitones(sourceF0: number | null, targetF0: number | null): number {
  if (!sourceF0 || !targetF0 || sourceF0 <= 0 || targetF0 <= 0) return 0
  const oct = Math.log2(targetF0 / sourceF0)
  const nearest = Math.round(oct)
  if (nearest === 0) return 0
  if (Math.abs(oct - nearest) > OCTAVE_TOLERANCE) return 0
  const clamped = Math.max(-MAX_OCTAVES, Math.min(MAX_OCTAVES, nearest))
  return clamped * 12
}
