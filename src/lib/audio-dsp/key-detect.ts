// Song key (tonic + major/minor) from the music stems, for Voice Swap's Add
// harmony: in a clearly MAJOR key the harmony follows the scale (thirds and
// fifths); in a minor key — or when the key isn't clear — it uses octaves only,
// which can't clash with any chord.
//
// Method: a pitch-class profile (chroma) of the whole song — FFT magnitudes
// folded onto the 12 note names — correlated with the Krumhansl–Kessler key
// profiles for all 24 keys. Pure maths, runs in a worker and in Node tests.

export type KeyMode = 'major' | 'minor'
export interface KeyEstimate {
  tonic: number          // 0 = C … 11 = B
  mode: KeyMode
  score: number          // correlation of the best key (−1…1)
  margin: number         // best score minus the best key of the OTHER mode
  runnerUpMargin: number // best score minus the second-best key overall
}

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
export const keyName = (k: { tonic: number; mode: KeyMode }) => `${NOTE_NAMES[((k.tonic % 12) + 12) % 12]} ${k.mode}`

// Krumhansl & Kessler (1982) probe-tone profiles, tonic first.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

const TARGET_SR = 11025
const FRAME = 8192            // ~0.74 s at 11 kHz → 1.35 Hz bins (low notes resolve)
const HOP = 4096
const F_LO = 55, F_HI = 2000  // A1 … ~B6
const MAX_SECONDS = 300

// In-place radix-2 complex FFT (re, im of length 2^k). Inverse: swap re/im in and out.
export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr
        re[b] = re[a] - tr; im[b] = im[a] - ti
        re[a] += tr; im[a] += ti
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr; cr = ncr
      }
    }
  }
}

export function decimateMono(x: Float32Array, sampleRate: number, targetRate: number): { y: Float32Array; rate: number } {
  const f = Math.max(1, Math.round(sampleRate / targetRate))
  const n = Math.floor(x.length / f)
  const y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let k = 0; k < f; k++) s += x[i * f + k]
    y[i] = s / f
  }
  return { y, rate: sampleRate / f }
}

// 12-bin chroma of a mono signal (each frame normalised so loud and quiet
// passages count equally; near-silent frames skipped).
export function chroma(mono: Float32Array, sampleRate: number): number[] {
  const { y, rate } = decimateMono(mono.subarray(0, Math.min(mono.length, MAX_SECONDS * sampleRate)), sampleRate, TARGET_SR)
  const win = new Float64Array(FRAME)
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME)
  const binPc = new Int8Array(FRAME / 2).fill(-1)
  for (let b = 1; b < FRAME / 2; b++) {
    const f = (b * rate) / FRAME
    if (f >= F_LO && f <= F_HI) binPc[b] = ((Math.round(12 * Math.log2(f / 440) + 69) % 12) + 12) % 12
  }
  const total = new Array(12).fill(0)
  const re = new Float64Array(FRAME), im = new Float64Array(FRAME)
  let frames = 0
  for (let off = 0; off + FRAME <= y.length; off += HOP) {
    let energy = 0
    for (let i = 0; i < FRAME; i++) { const v = y[off + i]; re[i] = v * win[i]; im[i] = 0; energy += v * v }
    if (energy / FRAME < 1e-6) continue // ~ −60 dBFS: silence
    fft(re, im)
    const c = new Array(12).fill(0)
    for (let b = 1; b < FRAME / 2; b++) if (binPc[b] >= 0) c[binPc[b]] += Math.hypot(re[b], im[b])
    const sum = c.reduce((a, v) => a + v, 0)
    if (sum <= 0) continue
    for (let p = 0; p < 12; p++) total[p] += c[p] / sum
    frames++
  }
  return frames ? total.map((v) => v / frames) : total
}

function pearson(a: number[], b: number[]): number {
  const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2 }
  return da && db ? num / Math.sqrt(da * db) : 0
}

export function keyFromChroma(c: number[]): KeyEstimate {
  const scores: { tonic: number; mode: KeyMode; score: number }[] = []
  for (let t = 0; t < 12; t++) {
    const rot = c.map((_, i) => c[(i + t) % 12]) // rot[0] = the candidate tonic
    scores.push({ tonic: t, mode: 'major', score: pearson(rot, MAJOR) })
    scores.push({ tonic: t, mode: 'minor', score: pearson(rot, MINOR) })
  }
  scores.sort((a, b) => b.score - a.score)
  const best = scores[0]
  const otherMode = scores.find((s) => s.mode !== best.mode)!
  return { ...best, margin: best.score - otherMode.score, runnerUpMargin: best.score - scores[1].score }
}

export function detectKey(mono: Float32Array, sampleRate: number): KeyEstimate {
  return keyFromChroma(chroma(mono, sampleRate))
}
