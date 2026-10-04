// Frame-by-frame sung pitch (YIN-style) for Add harmony: which note is being
// sung right now decides whether the harmony a 3rd above is 3 or 4 semitones.
// Only the note NAME matters there, so an octave slip is harmless.

import { decimateMono } from './key-detect'

export interface PitchTrack {
  midi: Float32Array  // MIDI note number per frame (fractional), NaN = not singing
  hopSeconds: number
}

const TARGET_SR = 11025
const FRAME = 512          // ~46 ms
const HOP = 256            // ~23 ms
const F_MIN = 70, F_MAX = 1000
const YIN_THRESHOLD = 0.2  // lower = stricter voicing
const SILENCE_RMS = 0.005  // ~ −46 dBFS

export function trackPitch(mono: Float32Array, sampleRate: number): PitchTrack {
  const { y, rate } = decimateMono(mono, sampleRate, TARGET_SR)
  const tauMin = Math.max(2, Math.floor(rate / F_MAX))
  const tauMax = Math.min(FRAME - 1, Math.ceil(rate / F_MIN))
  const frames = Math.max(0, Math.floor((y.length - FRAME - tauMax) / HOP) + 1)
  const midi = new Float32Array(frames).fill(NaN)
  const d = new Float64Array(tauMax + 1)
  for (let f = 0; f < frames; f++) {
    const off = f * HOP
    let e = 0
    for (let i = 0; i < FRAME; i++) e += y[off + i] * y[off + i]
    if (Math.sqrt(e / FRAME) < SILENCE_RMS) continue
    // Difference function and its cumulative-mean normalisation.
    d[0] = 1
    let run = 0, best = -1
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0
      for (let i = 0; i < FRAME; i++) { const v = y[off + i] - y[off + i + tau]; s += v * v }
      run += s
      d[tau] = run > 0 ? (s * tau) / run : 1
    }
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < YIN_THRESHOLD) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++
        best = tau
        break
      }
    }
    if (best < 0) continue
    // Parabolic interpolation for a sub-sample period.
    let t = best
    if (best > tauMin && best < tauMax) {
      const a = d[best - 1], b = d[best], c = d[best + 1], den = a - 2 * b + c
      if (den !== 0) t = best + (0.5 * (a - c)) / den
    }
    midi[f] = 12 * Math.log2(rate / t / 440) + 69
  }
  return { midi, hopSeconds: HOP / rate }
}

// Median sung note (MIDI) and seconds of clear pitch — for the Auto Song Key.
export function pitchStats(mono: Float32Array, sampleRate: number): { medianMidi: number; voicedSeconds: number } {
  const { midi, hopSeconds } = trackPitch(mono, sampleRate)
  const v = Array.from(midi).filter((m) => !Number.isNaN(m)).sort((a, b) => a - b)
  return { medianMidi: v.length ? v[Math.floor(v.length / 2)] : NaN, voicedSeconds: v.length * hopSeconds }
}
