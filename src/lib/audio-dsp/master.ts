// Mastering for Voice Swap (2026-10-09): every swap comes out as loud as the
// song that was uploaded, like a finished release. Our mixes were ~6 dB
// quieter than the originals (−13.7 vs −7.8 LUFS on Pehla Pyaar), which made
// them sound smaller and duller side by side.
//
//   • lufs()      — integrated loudness (ITU-R BS.1770: K-weighting, 400 ms
//                   blocks, −70 LUFS absolute and −10 LU relative gates).
//   • limit()     — look-ahead peak limiter: gain is lowered smoothly over the
//                   5 ms BEFORE a peak (never after it), so nothing passes the
//                   −1 dBFS ceiling; 80 ms release.
//   • masterGain()— the gain that, through the limiter, lands on the target.
//   • LIMITER_WORKLET — the SAME limiter as a real-time AudioWorklet for live
//                   playback (it runs 5 ms behind; offline that delay is
//                   removed, so the saved file equals what was heard).
// The saved file = limit(premaster × gain); the player = premaster → gain →
// worklet. Both use these constants.

export const MASTER_CEILING_DB = -1
export const MASTER_LOOKAHEAD_S = 0.005
export const MASTER_RELEASE_S = 0.08
// Target = the uploaded song's loudness, kept to a sensible range (and never
// bought with heavy limiting — see MASTER_MAX_AVG_CUT_DB).
export const MASTER_TARGET_MIN = -16
export const MASTER_TARGET_MAX = -7
export const MASTER_TARGET_FALLBACK = -9
const MAX_GAIN_DB = 24

function biquad(x: Float32Array, out: Float32Array, b: readonly number[], a: readonly number[]) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; out[i] = v
  }
}
// K-weighting: the BS.1770 high shelf (+4 dB above ~1.7 kHz) and high-pass
// (~38 Hz), as RBJ biquads at the actual sample rate.
function kWeights(sr: number) {
  const shelf = () => {
    const A = 10 ** (4 / 40), w = (2 * Math.PI * 1681.97) / sr, al = Math.sin(w) / (2 * 0.7072), c = Math.cos(w), s = 2 * Math.sqrt(A) * al
    const b = [A * ((A + 1) + (A - 1) * c + s), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - s)]
    const a = [(A + 1) - (A - 1) * c + s, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - s]
    return [b.map((v) => v / a[0]), a.map((v) => v / a[0])] as const
  }
  const hp = () => {
    const w = (2 * Math.PI * 38.13) / sr, al = Math.sin(w) / (2 * 0.5003), c = Math.cos(w)
    const b = [(1 + c) / 2, -(1 + c), (1 + c) / 2], a = [1 + al, -2 * c, 1 - al]
    return [b.map((v) => v / a[0]), a.map((v) => v / a[0])] as const
  }
  return [shelf(), hp()]
}

// Integrated loudness in LUFS (−Infinity for silence).
export function lufs(channels: Float32Array[], sr: number, scratch?: Float32Array): number {
  const n = channels[0]?.length ?? 0
  const blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr)
  if (n < blk) return -Infinity
  const nb = Math.floor((n - blk) / hop) + 1
  // Per-hop energy, summed over channels, then 4 hops make a 400 ms block.
  const hops = new Float64Array(Math.ceil(n / hop))
  const k = scratch && scratch.length >= n ? scratch.subarray(0, n) : new Float32Array(n)
  const [[b1, a1], [b2, a2]] = kWeights(sr)
  for (const ch of channels) {
    biquad(ch, k, b1, a1); biquad(k, k, b2, a2)
    for (let i = 0; i < n; i++) hops[Math.floor(i / hop)] += k[i] * k[i]
  }
  return gatedLoudness(hops, nb, Math.round(blk / hop), blk)
}

// BS.1770 gating over per-hop K-weighted energies (`per` hops = one block).
function gatedLoudness(hops: Float64Array, nb: number, per: number, blk: number): number {
  const z = new Float64Array(nb)
  for (let j = 0; j < nb; j++) { let e = 0; for (let q = 0; q < per; q++) e += hops[j + q] ?? 0; z[j] = e / blk }
  const L = (e: number) => -0.691 + 10 * Math.log10(e)
  let s1 = 0, c1 = 0
  for (let j = 0; j < nb; j++) if (L(z[j]) > -70) { s1 += z[j]; c1++ }
  if (!c1) return -Infinity
  const rel = L(s1 / c1) - 10
  let s2 = 0, c2 = 0
  for (let j = 0; j < nb; j++) if (L(z[j]) > -70 && L(z[j]) > rel) { s2 += z[j]; c2++ }
  return L(s2 / c2)
}

// Look-ahead limiter (offline). Returns new arrays = input × gain, limited.
export function limit(channels: Float32Array[], sr: number, gain: number, out?: Float32Array[]): Float32Array[] {
  const n = channels[0].length, ceil = 10 ** (MASTER_CEILING_DB / 20), W = Math.max(1, Math.round(MASTER_LOOKAHEAD_S * sr))
  // r = gain needed at each sample; m = smallest r over the next W samples;
  // s = m averaged over the last W samples (a ramp down that ends AT the peak).
  const r = new Float32Array(n)
  for (let i = 0; i < n; i++) { let p = 0; for (const c of channels) p = Math.max(p, Math.abs(c[i] * gain)); r[i] = p > ceil ? ceil / p : 1 }
  const m = new Float32Array(n), dq = new Int32Array(n + 1)
  let head = 0, tail = 0
  for (let j = 0; j < n + W; j++) {
    if (j < n) { while (tail > head && r[dq[tail - 1]] >= r[j]) tail--; dq[tail++] = j }
    const i = j - W
    if (i >= 0) { while (dq[head] < i) head++; m[i] = r[dq[head]] }
  }
  const res = out ?? channels.map(() => new Float32Array(n))
  const rel = 1 - Math.exp(-1 / (MASTER_RELEASE_S * sr))
  // Before the start counts as m[0] (not 1): a song that starts loud is
  // limited from its very first sample.
  let acc = W * m[0], g = 1
  for (let i = 0; i < n; i++) {
    acc += m[i] - (i >= W ? m[i - W] : m[0])
    const s = acc / W
    g = s < g ? s : g + (s - g) * rel
    const gg = gain * Math.min(g, s)
    for (let c = 0; c < channels.length; c++) res[c][i] = channels[c][i] * gg
  }
  return res
}

// Most the limiter may cut, on average over the loud parts, to reach the
// target. Without it a dense mix chasing a loud original was squashed: on
// Pehla Pyaar (−7.8 LUFS) +20 dB of gain with a 13 dB average cut — blunt,
// and less like the founder (2026-10-09). At the cap such songs land ~1 dB
// quieter than the original instead (−9.2 LUFS there), clean.
export const MASTER_MAX_AVG_CUT_DB = 1

// The gain search runs on a LIGHT COPY of the pre-master (2026-10-10): built
// once, per group of k samples (k = 6 at 44.1/48 kHz) it keeps the K-weighted
// energy (summed — loudness only needs energy per 100 ms hop) and the peak
// (max — what the limiter reacts to). Each search pass then walks the limiter's
// gain envelope over the light copy instead of limiting and re-filtering the
// whole stereo song: the slowest search (a loud song hitting the cut cap, ~16
// passes) went from 5.6 s to 0.6 s on a Mac for 4½ min. Measured on four mixes
// × six targets, the gain lands within 0.08 dB of the full search (resulting
// loudness within 0.03 LU, cut within 0.04 dB). The saved file is still
// limit() on the full audio at this gain.
type LightCopy = {
  k: number; m: number; hk: number; nb: number; per: number; blk: number
  energy: Float64Array // K-weighted energy per group, both channels
  peakW: Float32Array  // largest |sample| in the look-ahead window starting at each group
  peak: number         // largest |sample| in the song
  cutIdx: Int32Array; cutSum: Float32Array // every 64th sample: its group and Σ|x| over channels
}
function lightCopy(premaster: Float32Array[], sr: number): LightCopy | null {
  const n = premaster[0]?.length ?? 0, blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr)
  if (n < blk) return null
  const k = [6, 5, 4, 3, 2].find((d) => hop % d === 0) ?? 1 // groups never straddle a hop
  const m = Math.ceil(n / k), energy = new Float64Array(m), p = new Float32Array(m), kx = new Float32Array(n)
  const [[b1, a1], [b2, a2]] = kWeights(sr)
  for (const ch of premaster) {
    biquad(ch, kx, b1, a1); biquad(kx, kx, b2, a2)
    for (let i = 0; i < n; i++) {
      const j = (i / k) | 0
      energy[j] += kx[i] * kx[i]
      const v = Math.abs(ch[i]); if (v > p[j]) p[j] = v
    }
  }
  // Peak over [j, j+W] (a sliding maximum; it doesn't depend on the gain).
  const W = Math.max(1, Math.round((MASTER_LOOKAHEAD_S * sr) / k)), peakW = new Float32Array(m), dq = new Int32Array(m + 1)
  let head = 0, tail = 0, peak = 0
  for (let j = m - 1; j >= 0; j--) {
    while (tail > head && p[dq[tail - 1]] <= p[j]) tail--
    dq[tail++] = j
    while (dq[head] > j + W) head++
    peakW[j] = p[dq[head]]
    if (p[j] > peak) peak = p[j]
  }
  const nc = Math.ceil(n / 64), cutIdx = new Int32Array(nc), cutSum = new Float32Array(nc)
  for (let q = 0; q < nc; q++) { const i = q * 64; let a = 0; for (const ch of premaster) a += Math.abs(ch[i]); cutIdx[q] = (i / k) | 0; cutSum[q] = a }
  return { k, m, hk: hop / k, nb: Math.floor((n - blk) / hop) + 1, per: Math.round(blk / hop), blk, energy, peakW, peak, cutIdx, cutSum }
}

// Linear gain that brings `premaster` (through the limiter) to `targetLufs` —
// or, if that would cut more than MASTER_MAX_AVG_CUT_DB, the most gain that doesn't.
export function masterGain(premaster: Float32Array[], sr: number, targetLufs: number): number {
  const c = lightCopy(premaster, sr)
  if (!c) return 1
  const { k, m, hk, nb, per, blk, energy, peakW } = c
  const ceil = 10 ** (MASTER_CEILING_DB / 20), W = Math.max(1, Math.round((MASTER_LOOKAHEAD_S * sr) / k))
  const rel = 1 - Math.exp(-1 / ((MASTER_RELEASE_S * sr) / k))
  const env = new Float32Array(m), hops = new Float64Array(Math.ceil(m / hk) + 1)
  // limit()'s gain envelope at linear gain g → env; returns the loudness.
  const pass = (g: number): number => {
    hops.fill(0)
    const mAt = (j: number) => (peakW[j] * g > ceil ? ceil / (peakW[j] * g) : 1)
    const m0 = mAt(0)
    let acc = W * m0, ge = 1
    for (let j = 0; j < m; j++) {
      acc += mAt(j) - (j >= W ? mAt(j - W) : m0)
      const s = acc / W
      ge = s < ge ? s : ge + (s - ge) * rel
      const v = Math.min(ge, s)
      env[j] = v
      hops[(j / hk) | 0] += energy[j] * v * v * g * g
    }
    return gatedLoudness(hops, nb, per, blk)
  }
  // Average limiter cut (dB, positive) over the loud parts, at gain gDb.
  const cutAt = (gDb: number): number => {
    const g = 10 ** (gDb / 20)
    pass(g)
    let sum = 0, cnt = 0
    for (let q = 0; q < c.cutIdx.length; q++) {
      if (c.cutSum[q] * g < 0.05) continue
      sum += 20 * Math.log10(Math.max(env[c.cutIdx[q]], 1e-9)); cnt++
    }
    return cnt ? -sum / cnt : 0
  }
  hops.fill(0)
  for (let j = 0; j < m; j++) hops[(j / hk) | 0] += energy[j]
  const start = gatedLoudness(hops, nb, per, blk) // unlimited
  if (!Number.isFinite(start)) return 1
  // Secant steps: the limiter makes loudness grow less than 1 dB per dB of
  // gain, so the slope is measured as we go (kept within 0.2…1).
  let gDb = Math.min(MAX_GAIN_DB, targetLufs - start), prev: [number, number] | null = null
  for (let it = 0; it < 8; it++) {
    const got = pass(10 ** (gDb / 20))
    if (!Number.isFinite(got) || Math.abs(targetLufs - got) < 0.05) break
    const slope = prev && gDb !== prev[0] ? Math.max(0.2, Math.min(1, (got - prev[1]) / (gDb - prev[0]))) : 1
    prev = [gDb, got]
    gDb = Math.min(MAX_GAIN_DB, gDb + (targetLufs - got) / slope)
  }
  if (cutAt(gDb) <= MASTER_MAX_AVG_CUT_DB) return 10 ** (gDb / 20)
  // Too much limiting: back off. Below the gain where the peak just touches
  // the ceiling nothing is cut, so the answer lies between the two.
  let lo = Math.min(gDb, MASTER_CEILING_DB - 20 * Math.log10(Math.max(c.peak, 1e-9))), hi = gDb
  for (let it = 0; it < 7; it++) {
    const mid = (lo + hi) / 2
    if (cutAt(mid) > MASTER_MAX_AVG_CUT_DB) hi = mid; else lo = mid
  }
  return 10 ** (lo / 20)
}

export const clampTarget = (l: number) => (Number.isFinite(l) ? Math.max(MASTER_TARGET_MIN, Math.min(MASTER_TARGET_MAX, l)) : MASTER_TARGET_FALLBACK)

// Real-time twin of limit() (gain is applied BEFORE this node). Output runs W
// samples behind the input; otherwise the same maths sample for sample.
export const LIMITER_WORKLET = `
class MvxLimiter extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = options.processorOptions || {}
    this.ceil = Math.pow(10, o.ceilingDb / 20)
    this.W = Math.max(1, Math.round(o.lookaheadS * sampleRate))
    this.rel = 1 - Math.exp(-1 / (o.releaseS * sampleRate))
    const W = this.W
    this.delay = [new Float32Array(W + 1), new Float32Array(W + 1)]
    this.dqI = new Float64Array(W + 2); this.dqV = new Float32Array(W + 2); this.head = 0; this.size = 0
    this.mRing = new Float32Array(W); this.acc = 0
    this.g = 1; this.n = 0
  }
  process(inputs, outputs) {
    const inp = inputs[0], out = outputs[0]
    if (!out || !out.length) return true
    const frames = out[0].length, W = this.W, cap = W + 2
    for (let k = 0; k < frames; k++) {
      const n = this.n++
      let p = 0
      for (let c = 0; c < 2; c++) { const ch = inp && inp[Math.min(c, inp.length - 1)]; const v = ch ? ch[k] : 0; this.delay[c][n % (W + 1)] = v; const a = Math.abs(v); if (a > p) p = a }
      const r = p > this.ceil ? this.ceil / p : 1
      // sliding minimum of r over [n−W, n] (monotone deque in a ring)
      while (this.size > 0 && this.dqV[(this.head + this.size - 1) % cap] >= r) this.size--
      this.dqI[(this.head + this.size) % cap] = n; this.dqV[(this.head + this.size) % cap] = r; this.size++
      while (this.dqI[this.head] < n - W) { this.head = (this.head + 1) % cap; this.size-- }
      const m = this.dqV[this.head]
      if (n < W) { for (let c = 0; c < out.length; c++) out[c][k] = 0; continue }
      // First output (n = W): fill the past with this value, like limit().
      if (n === W) { this.mRing.fill(m); this.acc = W * m }
      else { const slot = n % W; this.acc += m - this.mRing[slot]; this.mRing[slot] = m }
      const s = this.acc / W
      this.g = s < this.g ? s : this.g + (s - this.g) * this.rel
      const gg = Math.min(this.g, s)
      const d = (n - W) % (W + 1)
      for (let c = 0; c < out.length; c++) out[c][k] = this.delay[Math.min(c, 1)][d] * gg
    }
    return true
  }
}
registerProcessor('mvx-limiter', MvxLimiter)
`
