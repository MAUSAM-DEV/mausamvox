// Shared capture-quality metering for the in-browser mic recorders (Voice Lab
// Quick/Pro Record, Choir, Instruments). Front-end only — nothing here touches
// what gets uploaded or any downstream pipeline; it just watches the live
// input so the user can fix problems (noise, clipping) at the source.

// ── Tunable thresholds ────────────────────────────────────────────────────────
// Ambient RMS (dBFS, mic open + user silent) above this → "too noisy" warning.
export const NOISE_NOISY_DB = -38
// …below this → "nice and quiet". Between the two = workable, no warning.
export const NOISE_QUIET_DB = -48
// How long the pre-record room check samples the ambient level.
export const NOISE_CHECK_MS = 1600
// |sample| at/above this ≈ 0 dBFS → treat as clipping ("too loud, move back").
export const CLIP_PEAK = 0.985
// Keep the clip warning visible this long after the last clipped frame.
export const CLIP_HOLD_MS = 2000
// A frame whose RMS jumps past ratio × the rolling average AND the absolute
// floor below → sudden background spike (door slam, horn). Warn, never cut.
export const SPIKE_RATIO = 4
export const SPIKE_MIN_RMS = 0.3
export const SPIKE_HOLD_MS = 4000

export function rmsToDb(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : -100
}

// One AnalyserNode-based meter per open mic stream. The pre-record wizard
// creates it, then hands it (with the stream) to the page's recorder so the
// during-recording monitor reuses the SAME context — no duplicate graphs.
// Callers own closing it (close the meter wherever the tracks are stopped).
export class MicMeter {
  readonly analyser: AnalyserNode
  private ctx: AudioContext
  private source: MediaStreamAudioSourceNode
  // Explicit <ArrayBuffer> generics: the analyser's getXTimeDomainData
  // signatures reject the default ArrayBufferLike-backed typed arrays.
  private floatData: Float32Array<ArrayBuffer> | null
  private byteData: Uint8Array<ArrayBuffer>
  private closed = false

  constructor(stream: MediaStream) {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.ctx = new Ctx()
    // iOS Safari quirk: an AudioContext can start 'suspended' even when created
    // from a tap handler — resume it explicitly (no-op everywhere else).
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {})
    this.source = this.ctx.createMediaStreamSource(stream)
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.source.connect(this.analyser)
    // Float samples where supported (Safari 14.1+); byte fallback otherwise.
    this.floatData =
      typeof this.analyser.getFloatTimeDomainData === 'function'
        ? new Float32Array(this.analyser.fftSize)
        : null
    this.byteData = new Uint8Array(this.analyser.fftSize)
  }

  // Current input frame: RMS + absolute peak, both 0–1 linear.
  snapshot(): { rms: number; peak: number } {
    if (this.closed) return { rms: 0, peak: 0 }
    let sum = 0
    let peak = 0
    if (this.floatData) {
      this.analyser.getFloatTimeDomainData(this.floatData)
      for (let i = 0; i < this.floatData.length; i++) {
        const v = Math.abs(this.floatData[i])
        if (v > peak) peak = v
        sum += v * v
      }
      return { rms: Math.sqrt(sum / this.floatData.length), peak }
    }
    this.analyser.getByteTimeDomainData(this.byteData)
    for (let i = 0; i < this.byteData.length; i++) {
      const v = Math.abs((this.byteData[i] - 128) / 128)
      if (v > peak) peak = v
      sum += v * v
    }
    return { rms: Math.sqrt(sum / this.byteData.length), peak }
  }

  // Average ambient level (dBFS) over `ms`, sampling every 50 ms. `onLevel`
  // feeds the live meter bar while the check runs. Averages energy (rms²),
  // not dB, so a single cough doesn't dominate a quiet room.
  measureNoiseFloor(ms = NOISE_CHECK_MS, onLevel?: (rms: number) => void): Promise<number> {
    return new Promise((resolve) => {
      const started = Date.now()
      let energy = 0
      let frames = 0
      const tick = setInterval(() => {
        const { rms } = this.snapshot()
        energy += rms * rms
        frames++
        onLevel?.(rms)
        if (Date.now() - started >= ms || this.closed) {
          clearInterval(tick)
          resolve(rmsToDb(frames > 0 ? Math.sqrt(energy / frames) : 0))
        }
      }, 50)
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    try { this.source.disconnect() } catch { /* already gone */ }
    this.ctx.close().catch(() => {})
  }
}
