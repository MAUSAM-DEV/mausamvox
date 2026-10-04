// Song-matched polish for Voice Swap: set warmth, treble and reverb from how the
// ORIGINAL singer's vocal sounds, instead of one fixed "Studio" preset.
//
// Inputs: the original lead vocal stem and the converted vocal (mono, same
// sample rate, ≥ 22.05 kHz so the 5–10 kHz band exists). Pure maths, no Web
// Audio, so it runs in the browser and in Node tests.
//
//  • Warmth  = how much fuller the original is below 300 Hz than the converted
//              voice (relative to its 300 Hz–3 kHz body), clamped 0…6 dB.
//  • Treble  = the same comparison at 5–10 kHz, clamped −4…+4 dB.
//  • Reverb  = 15% wet, nudged by how loud the original's pauses just after
//              singing are vs the converted voice's (1% per dB), clamped 5…25%.
// Limits keep it tasteful; the Studio preset (warmth +4 dB, 15% reverb) sits
// inside them. Prototype on 3 songs (2026-10-04): warmth 3.2–6.0 dB, treble
// −2.6…+0.9 dB, reverb 16–23%.

export const MATCH_WARMTH_MAX_DB = 6
export const MATCH_TREBLE_LIMIT_DB = 4
export const MATCH_REVERB_MIN = 0.05
export const MATCH_REVERB_MAX = 0.25
export const MATCH_REVERB_BASE = 0.15
export const MATCH_REVERB_PER_DB = 0.01

export interface MatchedPolish {
  warmthDb: number   // 0…6
  trebleDb: number   // −4…+4 (whole dB)
  reverbWet: number  // 0.05…0.25
}

type Coeffs = [number, number, number, number, number] // b0 b1 b2 a1 a2 (a0 normalised)

function biquad(type: 'lp' | 'hp', f0: number, sr: number): Coeffs {
  const w0 = (2 * Math.PI * f0) / sr, c = Math.cos(w0), alpha = Math.sin(w0) / (2 * Math.SQRT1_2)
  const a0 = 1 + alpha
  const b = type === 'lp' ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2]
  return [b[0] / a0, b[1] / a0, b[2] / a0, (-2 * c) / a0, (1 - alpha) / a0]
}

function filter(x: Float32Array, k: Coeffs): Float32Array {
  const y = new Float32Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = k[0] * x[i] + k[1] * x1 + k[2] * x2 - k[3] * y1 - k[4] * y2
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v
  }
  return y
}

// 4th-order edges (two cascaded 2nd-order stages each) so neighbouring bands
// don't leak in and dilute the low/high comparison.
const band = (x: Float32Array, lo: number, hi: number, sr: number) => {
  const hp = biquad('hp', lo, sr), lp = biquad('lp', hi, sr)
  return filter(filter(filter(filter(x, hp), hp), lp), lp)
}

function frameEnergy(x: Float32Array, size: number): Float64Array {
  const n = Math.floor(x.length / size), out = new Float64Array(n)
  for (let f = 0; f < n; f++) {
    let s = 0
    for (let i = f * size; i < (f + 1) * size; i++) s += x[i] * x[i]
    out[f] = s
  }
  return out
}

function percentile(a: ArrayLike<number>, p: number): number {
  const s = Array.from(a).sort((x, y) => x - y)
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * (s.length - 1)))] : 0
}

const db = (v: number) => 10 * Math.log10(v + 1e-12)

// Low (100–300 Hz) and high (5–10 kHz) band levels relative to the 300 Hz–3 kHz
// body, over the louder half of the frames (where the voice is singing).
function tone(x: Float32Array, sr: number): { low: number; high: number } {
  const size = 2048, e = frameEnergy(x, size), gate = percentile(e, 50)
  const lo = frameEnergy(band(x, 100, 300, sr), size), mid = frameEnergy(band(x, 300, 3000, sr), size), hi = frameEnergy(band(x, 5000, Math.min(10000, sr * 0.45), sr), size)
  let L = 0, M = 0, H = 0
  for (let f = 0; f < e.length; f++) if (e[f] > gate) { L += lo[f]; M += mid[f]; H += hi[f] }
  return { low: db(L) - db(M), high: db(H) - db(M) }
}

// Level of the 50–400 ms just after singing, relative to the singing (dB).
function tail(x: Float32Array, sr: number): number | null {
  const size = 256, e = frameEnergy(x, size), d = Array.from(e, (v) => db(v / size))
  const loud = percentile(d, 85), sung = d.map((v) => v > loud - 15), fps = sr / size
  const after = new Array(d.length).fill(false)
  sung.forEach((s, i) => { if (s) for (let j = i + Math.round(0.05 * fps); j < Math.min(d.length, i + Math.round(0.4 * fps)); j++) after[j] = true })
  const gap: number[] = [], sungDb: number[] = []
  d.forEach((v, i) => { if (sung[i]) sungDb.push(v); else if (after[i]) gap.push(v) })
  if (gap.length < 20 || sungDb.length < 20) return null
  return percentile(gap, 50) - percentile(sungDb, 50)
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function matchPolish(original: Float32Array, converted: Float32Array, sampleRate: number): MatchedPolish {
  const o = tone(original, sampleRate), c = tone(converted, sampleRate)
  const to = tail(original, sampleRate), tc = tail(converted, sampleRate)
  const reverbWet = to === null || tc === null ? MATCH_REVERB_BASE : MATCH_REVERB_BASE + (to - tc) * MATCH_REVERB_PER_DB
  return {
    warmthDb: Math.round(clamp(o.low - c.low, 0, MATCH_WARMTH_MAX_DB) * 10) / 10,
    trebleDb: Math.round(clamp(o.high - c.high, -MATCH_TREBLE_LIMIT_DB, MATCH_TREBLE_LIMIT_DB)),
    reverbWet: Math.round(clamp(reverbWet, MATCH_REVERB_MIN, MATCH_REVERB_MAX) * 100) / 100,
  }
}
