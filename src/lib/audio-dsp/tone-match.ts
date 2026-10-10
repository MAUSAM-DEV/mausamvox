// Tone tools for Voice Swap (2026-10-10 sound study: the swap was bassier and
// duller than the original — a key change pushed the kick/bass into 20–45 Hz,
// +8–11 dB; the founder preferred the tone-matched version by ear).
//
//   • powerSpectrum — average power spectrum of the loud parts (both channels).
//   • alignLag      — delay between two recordings of the same drums (Demucs's
//                     MP3 stems sit 1105 samples late — the encoder delay).
//   • subShelfDb    — the low-shelf cut that brings a key-shifted bed's deep sub
//                     (20–45 Hz) back to the original music's level.
//   • toneMatchDb   — a 10-band EQ (octaves 31.5 Hz…16 kHz, ±6 dB) that gives
//                     the swap the original song's tone balance.
//   • applyFilters  — the same biquads offline (RBJ formulas = Web Audio's).
// Pure number-crunching on Float32Arrays — runs in the DSP worker.

export const TONE_EQ_CENTERS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]
export const TONE_EQ_Q = 1.41 // one octave
export const TONE_EQ_MAX_DB = 6
export const SUB_SHELF_HZ = 45
const SUB_MAX_CUT_DB = 18

export type Filter = { type: 'peaking' | 'lowshelf'; freq: number; gainDb: number; q?: number }

function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let j = 0; j < len / 2; j++) {
        const a = i + j, b = a + len / 2
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
}

// Average power per FFT bin (N/2 bins, bin k = k·sr/N Hz) over the loudest 70%
// of frames; at most ~600 frames, spread over the song, so it stays quick.
export function powerSpectrum(channels: Float32Array[], N = 8192): Float64Array {
  const n = channels[0]?.length ?? 0
  const out = new Float64Array(N / 2)
  if (n < N) return out
  const hop = Math.max(N / 2, Math.floor((n - N) / 600))
  const starts: number[] = [], energy: number[] = []
  for (let s = 0; s + N <= n; s += hop) {
    let e = 0
    for (const ch of channels) for (let i = s; i < s + N; i += 16) e += ch[i] * ch[i]
    starts.push(s); energy.push(e)
  }
  const thr = [...energy].sort((a, b) => a - b)[Math.floor(energy.length * 0.3)]
  const win = new Float64Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)
  const re = new Float64Array(N), im = new Float64Array(N)
  let frames = 0
  for (let f = 0; f < starts.length; f++) {
    if (energy[f] < thr) continue
    frames++
    for (const ch of channels) {
      for (let i = 0; i < N; i++) { re[i] = ch[starts[f] + i] * win[i]; im[i] = 0 }
      fft(re, im)
      for (let k = 0; k < N / 2; k++) out[k] += re[k] * re[k] + im[k] * im[k]
    }
  }
  if (frames) for (let k = 0; k < N / 2; k++) out[k] /= frames
  return out
}

// Biquad coefficients (normalised, a0 = 1) — the RBJ cookbook, as Web Audio's
// BiquadFilterNode computes them (lowshelf: slope 1; peaking: Q).
export function coeffs(f: Filter, sr: number): { b: number[]; a: number[] } {
  const A = 10 ** (f.gainDb / 40), w = (2 * Math.PI * f.freq) / sr, c = Math.cos(w), s = Math.sin(w)
  let b: number[], a: number[]
  if (f.type === 'peaking') {
    const al = s / (2 * (f.q ?? TONE_EQ_Q))
    b = [1 + al * A, -2 * c, 1 - al * A]; a = [1 + al / A, -2 * c, 1 - al / A]
  } else {
    const al = (s / 2) * Math.SQRT2, sq = 2 * Math.sqrt(A) * al
    b = [A * ((A + 1) - (A - 1) * c + sq), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sq)]
    a = [(A + 1) + (A - 1) * c + sq, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sq]
  }
  return { b: b.map((v) => v / a[0]), a: a.map((v) => v / a[0]) }
}
// |H(f)|² of a filter chain at frequency hz.
function power(filters: Filter[], hz: number, sr: number): number {
  let p = 1
  const w = (2 * Math.PI * hz) / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w)
  for (const f of filters) {
    if (f.gainDb === 0) continue
    const { b, a } = coeffs(f, sr)
    const nr = b[0] + b[1] * c1 + b[2] * c2, ni = -(b[1] * s1 + b[2] * s2)
    const dr = 1 + a[1] * c1 + a[2] * c2, di = -(a[1] * s1 + a[2] * s2)
    p *= (nr * nr + ni * ni) / (dr * dr + di * di)
  }
  return p
}
export function applyFilters(channels: Float32Array[], sr: number, filters: Filter[]): Float32Array[] {
  const active = filters.filter((f) => f.gainDb !== 0 && f.freq < sr * 0.45).map((f) => coeffs(f, sr))
  return channels.map((x) => {
    let y = x
    for (const { b, a } of active) {
      const o = new Float32Array(y.length)
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0
      for (let i = 0; i < y.length; i++) {
        const v = b[0] * y[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
        x2 = x1; x1 = y[i]; y2 = y1; y1 = v; o[i] = v
      }
      y = o
    }
    return y === x ? x.slice() : y
  })
}

// Share (dB of the total) of [lo, hi) Hz in a spectrum, after `filters`.
function share(spec: Float64Array, sr: number, lo: number, hi: number, filters: Filter[] = []): number {
  const N = spec.length * 2
  let band = 0, total = 0
  for (let k = 1; k < spec.length; k++) {
    const hz = (k * sr) / N, p = spec[k] * (filters.length ? power(filters, hz, sr) : 1)
    total += p
    if (hz >= lo && hz < hi) band += p
  }
  return 10 * Math.log10(Math.max(band, 1e-30) / Math.max(total, 1e-30))
}

// Low-shelf (at SUB_SHELF_HZ) cut, in dB (≤ 0), that brings the bed's 20–45 Hz
// share down to the reference's. 0 when the bed has no more sub than that.
export function subShelfDb(bedSpec: Float64Array, refSpec: Float64Array, sr: number): number {
  const want = share(refSpec, sr, 20, SUB_SHELF_HZ)
  const at = (g: number) => share(bedSpec, sr, 20, SUB_SHELF_HZ, [{ type: 'lowshelf', freq: SUB_SHELF_HZ, gainDb: g }])
  if (at(0) <= want + 0.5) return 0
  let lo = -SUB_MAX_CUT_DB, hi = 0
  if (at(lo) > want) return lo
  for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (at(mid) > want) hi = mid; else lo = mid }
  return Math.round(hi * 10) / 10
}

// 10-band EQ (dB per TONE_EQ_CENTERS band) that moves the mix's octave-band
// balance to the reference's. Solved on the spectra (no re-filtering).
export function toneMatchDb(mixSpec: Float64Array, refSpec: Float64Array, sr: number): number[] {
  const usable = TONE_EQ_CENTERS.map((c) => c < sr * 0.45)
  const bands = (spec: Float64Array, filters: Filter[]) => TONE_EQ_CENTERS.map((c) => share(spec, sr, c / Math.SQRT2, c * Math.SQRT2, filters))
  const want = bands(refSpec, [])
  let g = TONE_EQ_CENTERS.map(() => 0)
  const toFilters = (gains: number[]) => gains.map((gainDb, i): Filter => ({ type: 'peaking', freq: TONE_EQ_CENTERS[i], gainDb: usable[i] ? gainDb : 0 }))
  for (let it = 0; it < 8; it++) {
    const have = bands(mixSpec, toFilters(g))
    g = g.map((v, i) => (usable[i] ? Math.max(-TONE_EQ_MAX_DB, Math.min(TONE_EQ_MAX_DB, v + 0.8 * (want[i] - have[i]))) : 0))
  }
  return g.map((v) => Math.round(v * 10) / 10)
}
export const toneEqFilters = (gains: number[]): Filter[] =>
  TONE_EQ_CENTERS.map((freq, i) => ({ type: 'peaking', freq, gainDb: gains[i] ?? 0, q: TONE_EQ_Q }))

// Delay (samples) to apply to `x` so it lines up with `ref` (positive = x is
// early), from the cross-correlation of first differences over 20 s, plus the
// least-squares gain of the aligned x in ref. null when there's no clear match.
export function alignLag(ref: Float32Array[], x: Float32Array[], sr: number, maxLag = 4000): { lag: number; gain: number } | null {
  const n = Math.min(ref[0].length, x[0].length)
  const len = Math.min(n - 2, Math.round(20 * sr)), s0 = Math.max(1, Math.min(Math.floor(n * 0.35), n - len - 1))
  if (len < sr) return null
  let N = 1; while (N < len + maxLag) N <<= 1
  const mono = (chs: Float32Array[], i: number) => chs.reduce((a, c) => a + c[i], 0)
  const ar = new Float64Array(N), ai = new Float64Array(N), br = new Float64Array(N), bi = new Float64Array(N)
  for (let i = 1; i < len; i++) { ar[i] = mono(ref, s0 + i) - mono(ref, s0 + i - 1); br[i] = mono(x, s0 + i) - mono(x, s0 + i - 1) }
  fft(ar, ai); fft(br, bi)
  for (let k = 0; k < N; k++) { const r = ar[k] * br[k] + ai[k] * bi[k], m = ai[k] * br[k] - ar[k] * bi[k]; ar[k] = r; ai[k] = m }
  fft(ar, ai, true)
  let best = 0, bv = -Infinity, sum = 0
  for (let lag = -maxLag; lag <= maxLag; lag++) { const v = ar[(lag + N) % N]; sum += Math.abs(v); if (v > bv) { bv = v; best = lag } }
  if (!(bv > 8 * (sum / (2 * maxLag + 1)))) return null // no clear peak
  let num = 0, den = 0
  for (let c = 0; c < Math.min(ref.length, x.length); c++) for (let i = Math.max(0, best); i < Math.min(n, n + best); i += 4) { const xv = x[c][i - best]; num += ref[c][i] * xv; den += xv * xv }
  return den > 0 ? { lag: best, gain: num / den } : null
}
