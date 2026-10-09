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
// Target = the uploaded song's loudness, kept to a sensible range.
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
  const per = Math.round(blk / hop)
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

// Linear gain that brings `premaster` (through the limiter) to `targetLufs`.
export function masterGain(premaster: Float32Array[], sr: number, targetLufs: number): number {
  const n = premaster[0]?.length ?? 0
  const start = lufs(premaster, sr)
  if (!Number.isFinite(start) || n === 0) return 1
  const scratch = new Float32Array(n), buf = premaster.map(() => new Float32Array(n))
  // Secant steps: the limiter makes loudness grow less than 1 dB per dB of
  // gain, so the slope is measured as we go (kept within 0.2…1).
  let gDb = Math.min(MAX_GAIN_DB, targetLufs - start), prev: [number, number] | null = null
  for (let it = 0; it < 8; it++) {
    const got = lufs(limit(premaster, sr, 10 ** (gDb / 20), buf), sr, scratch)
    if (!Number.isFinite(got) || Math.abs(targetLufs - got) < 0.05) break
    const slope = prev && gDb !== prev[0] ? Math.max(0.2, Math.min(1, (got - prev[1]) / (gDb - prev[0]))) : 1
    prev = [gDb, got]
    gDb = Math.min(MAX_GAIN_DB, gDb + (targetLufs - got) / slope)
  }
  return 10 ** (gDb / 20)
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
