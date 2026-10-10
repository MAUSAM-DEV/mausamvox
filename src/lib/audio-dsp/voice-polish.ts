// Studio voice for Voice Swap (2026-10-09): a de-esser plus the "air" the
// voice engine loses. NO compression: measured on the founder's voice, the
// 2:1 voice compressor of "Q i" moved it toward the original singer (speaker
// similarity lead +0.149 → +0.112, whole song) — identity comes first.
//   1. De-esser: the 5 kHz+ band is turned down only while it's loud next to
//      the whole voice (harsh "s"), up to −9 dB.
//   2. Air: the converted voice is ~9 dB short above 6 kHz and ~20 dB short
//      above 14 kHz next to the original singer (measured). Two shelves
//      (+1.5 dB at 5 kHz, +6 dB at 10 kHz) plus soft harmonics made from the
//      2.5–7 kHz band and kept above 9 kHz, mixed in until the voice's share
//      above 10 kHz matches the ORIGINAL lead's (song-tuned target).
//   3. Back to the input's loudness (sung parts), so Level means the same.
// Pure maths on Float32Arrays (runs in the DSP worker). Arrays are reused so a
// 5-minute song stays at a few full-length buffers.

export const DEFAULT_AIR_TARGET_DB = -25 // Pehla Pyaar's original lead measured −24.9

type Coefs = [number, number, number, number, number] // b0 b1 b2 a1 a2 (a0 = 1)
type Kind = 'lowpass' | 'highpass' | 'highshelf'

function coefs(kind: Kind, f0: number, sr: number, gainDb = 0, q = Math.SQRT1_2): Coefs {
  const A = 10 ** (gainDb / 40), w = (2 * Math.PI * f0) / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w)
  let b: number[], a: number[]
  if (kind === 'highshelf') {
    const s = 2 * Math.sqrt(A) * al
    b = [A * ((A + 1) + (A - 1) * c + s), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - s)]
    a = [(A + 1) - (A - 1) * c + s, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - s]
  } else if (kind === 'lowpass') {
    b = [(1 - c) / 2, 1 - c, (1 - c) / 2]; a = [1 + al, -2 * c, 1 - al]
  } else {
    b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]; a = [1 + al, -2 * c, 1 - al]
  }
  return [b[0] / a[0], b[1] / a[0], b[2] / a[0], a[1] / a[0], a[2] / a[0]]
}

// One biquad, src → dst (may be the same array), forward or backward.
function filt(src: Float32Array, dst: Float32Array, [b0, b1, b2, a1, a2]: Coefs, reverse = false) {
  const n = src.length
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let k = 0; k < n; k++) {
    const i = reverse ? n - 1 - k : k
    const x = src[i]
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1; x1 = x; y2 = y1; y1 = y
    dst[i] = y
  }
}
// 4th-order Butterworth high-pass as two biquads.
const BW4 = [0.5412, 1.3066]
function highpass4(src: Float32Array, dst: Float32Array, hz: number, sr: number, zeroPhase = false) {
  filt(src, dst, coefs('highpass', hz, sr, 0, BW4[0])); filt(dst, dst, coefs('highpass', hz, sr, 0, BW4[1]))
  if (zeroPhase) { filt(dst, dst, coefs('highpass', hz, sr, 0, BW4[0]), true); filt(dst, dst, coefs('highpass', hz, sr, 0, BW4[1]), true) }
}

// Centred moving RMS over `ms` (window [j+h−n+1, j+h], h = n/2) — one pass.
function envelope(s: Float32Array, ms: number, sr: number, out = new Float32Array(s.length)): Float32Array {
  const n = Math.max(1, Math.round((sr * ms) / 1000)), h = n >> 1, N = s.length
  let acc = 0
  for (let i = 0; i < N + h; i++) {
    if (i < N) acc += s[i] * s[i]
    if (i - n >= 0 && i - n < N) acc -= s[i - n] * s[i - n]
    const j = i - h
    if (j >= 0 && j < N) out[j] = Math.sqrt(Math.max(acc, 0) / n + 1e-12)
  }
  return out
}
// Percentile of a big array from an evenly spaced sample (exact enough here).
function percentile(a: Float32Array, p: number, pick: (v: number) => boolean = () => true): number {
  const stride = Math.max(1, Math.floor(a.length / 200000)), v: number[] = []
  for (let i = 0; i < a.length; i += stride) if (pick(a[i])) v.push(a[i])
  if (!v.length) return 0
  v.sort((x, y) => x - y)
  return v[Math.min(v.length - 1, Math.floor((p / 100) * (v.length - 1)))]
}
const coef = (ms: number, sr: number) => Math.exp(-1 / ((sr * ms) / 1000))

function deEss(s: Float32Array, sr: number, thr = 0.36, ratio = 3, maxCutDb = 9): Float32Array {
  const hi = new Float32Array(s.length); highpass4(s, hi, 5000, sr, true)
  const eh = envelope(hi, 5, sr), ef = envelope(s, 20, sr)
  const floor = 10 ** (-maxCutDb / 20), a = coef(1, sr), r = coef(40, sr)
  let c = 1
  for (let i = 0; i < s.length; i++) {
    const q = eh[i] / ef[i]
    const g = q > thr ? Math.max(floor, (thr / q) ** (1 - 1 / ratio)) : 1
    c = g < c ? a * c + (1 - a) * g : r * c + (1 - r) * g
    hi[i] = s[i] - hi[i] + hi[i] * c // reuse: low band + turned-down high band
  }
  return hi
}

// Energy above `hz` vs 300–3000 Hz on the sung parts (loudest 40% of 50 ms
// windows), in dB. The original lead's value is the air target.
export function airShare(s: Float32Array, sr: number, hz = 10000): number {
  const e = envelope(s, 50, sr), thr = percentile(e, 60)
  const hi = new Float32Array(s.length); highpass4(s, hi, hz, sr)
  const mid = new Float32Array(s.length); filt(s, mid, coefs('highpass', 300, sr)); filt(mid, mid, coefs('lowpass', 3000, sr))
  let a = 0, b = 0
  for (let i = 0; i < s.length; i++) if (e[i] > thr) { a += hi[i] * hi[i]; b += mid[i] * mid[i] }
  return b > 0 && a > 0 ? 10 * Math.log10(a / b) : -120
}

function addAir(s: Float32Array, sr: number, targetDb: number, maxGain = 12): Float32Array {
  const x = new Float32Array(s.length)
  filt(s, x, coefs('highshelf', 5000, sr, 1.5)); filt(x, x, coefs('highshelf', 10000, sr, 6))
  // Harmonics from the 2.5–7 kHz band, kept above 9 kHz.
  const air = new Float32Array(s.length)
  highpass4(x, air, 2500, sr); filt(air, air, coefs('lowpass', 7000, sr))
  let pk = 1e-9
  for (let i = 0; i < air.length; i++) pk = Math.max(pk, Math.abs(air[i]))
  for (let i = 0; i < air.length; i++) { const v = air[i]; air[i] = (Math.tanh((3 * v) / pk) * pk) / 3 + 0.15 * Math.abs(v) }
  highpass4(air, air, 9000, sr); highpass4(air, air, 9000, sr)
  // How much: the filters are linear, so the 10 kHz+ and 300–3000 Hz energies
  // of x + g·air are quadratics in g — work them out once, then solve for g.
  const mask = envelope(x, 50, sr), thr = percentile(mask, 60)
  const hp300 = coefs('highpass', 300, sr), lp3k = coefs('lowpass', 3000, sr)
  const band = new Float32Array(s.length), bandAir = new Float32Array(s.length)
  let Hxx = 0, Hxa = 0, Haa = 0, Mxx = 0, Mxa = 0, Maa = 0
  highpass4(x, band, 10000, sr); highpass4(air, bandAir, 10000, sr)
  for (let i = 0; i < x.length; i++) if (mask[i] > thr) { Hxx += band[i] * band[i]; Hxa += band[i] * bandAir[i]; Haa += bandAir[i] * bandAir[i] }
  filt(x, band, hp300); filt(band, band, lp3k); filt(air, bandAir, hp300); filt(bandAir, bandAir, lp3k)
  for (let i = 0; i < x.length; i++) if (mask[i] > thr) { Mxx += band[i] * band[i]; Mxa += band[i] * bandAir[i]; Maa += bandAir[i] * bandAir[i] }
  const share = (g: number) => 10 * Math.log10((Hxx + 2 * g * Hxa + g * g * Haa) / Math.max(1e-20, Mxx + 2 * g * Mxa + g * g * Maa))
  let lo = 0, hi = maxGain
  if (share(0) >= targetDb) hi = 0 // already bright enough: shelves only
  else for (let it = 0; it < 30; it++) { const g = (lo + hi) / 2; if (share(g) < targetDb) lo = g; else hi = g }
  const g = (lo + hi) / 2
  for (let i = 0; i < x.length; i++) x[i] += g * air[i]
  return x
}

function activeRms(s: Float32Array, sr: number): number {
  const e = envelope(s, 50, sr), thr = percentile(e, 50)
  let a = 0, n = 0
  for (let i = 0; i < s.length; i++) if (e[i] > thr) { a += s[i] * s[i]; n++ }
  return n ? Math.sqrt(a / n) : 0
}

// How sharp the "s" sounds are (2026-10-10): the loud end (95th percentile)
// of the 5 kHz+ envelope next to the whole voice's, on the sung parts, in dB.
// The original lead's value is the sibilance target.
export function sibilance(s: Float32Array, sr: number): number {
  const hi = new Float32Array(s.length); highpass4(s, hi, 5000, sr, true)
  const eh = envelope(hi, 5, sr), ef = envelope(s, 20, sr), gate = percentile(ef, 50)
  const q = new Float32Array(s.length)
  for (let i = 0; i < s.length; i++) q[i] = ef[i] > gate ? 20 * Math.log10(Math.max(eh[i], 1e-9) / Math.max(ef[i], 1e-9)) : -200
  return percentile(q, 95, (v) => v > -199)
}

// The whole chain. `airTargetDb` = airShare() of the song's original lead;
// `sibTargetDb` = its sibilance(): when our voice's "s" sounds are sharper,
// a second de-ess pass (threshold found by bisection) brings them down to it.
export function polishVoice(mono: Float32Array, sr: number, airTargetDb = DEFAULT_AIR_TARGET_DB, sibTargetDb?: number): Float32Array {
  let y = addAir(deEss(mono, sr), sr, airTargetDb)
  if (sibTargetDb !== undefined && Number.isFinite(sibTargetDb) && sibilance(y, sr) > sibTargetDb + 0.5) {
    let lo = 0.1, hi = 0.36, best = deEss(y, sr, lo)
    for (let it = 0; it < 5; it++) {
      const mid = (lo + hi) / 2, z = deEss(y, sr, mid)
      if (sibilance(z, sr) > sibTargetDb + 0.5) hi = mid; else { lo = mid; best = z }
    }
    y = best
  }
  const k = activeRms(mono, sr) / Math.max(1e-9, activeRms(y, sr))
  for (let i = 0; i < y.length; i++) y[i] *= k
  return y
}
