// Remove the backing vocals' "doubles" — backing singers (often the original
// singer double-tracked) singing the SAME note as the lead. Mixed under a
// swapped lead they sound like a second voice (founder's 2026-10-04 test:
// "Diagnosis 6 still has two voices"); the harmonies and chorus lines on
// OTHER notes are what we want to keep.
//
// How: follow the ORIGINAL lead's pitch (pitch-track.ts) and, wherever it
// sings, turn the backing down by DOUBLE_CUT at that note's harmonics only
// (±45 cents). Everything else in the backing passes untouched — including
// chorus lines where the lead isn't singing. Checked on Pehla Pyaar
// (2026-10-04, where the lead really sings): backing on the lead's notes
// −20.5 → −32.4 dB under the lead, backing overall only −1.7 dB; 4.5 min of
// stereo in 1.6 s (Node); with no lead pitch the backing comes out unchanged
// (error −147 dB).

import { fft } from './key-detect'
import { trackPitch } from './pitch-track'

const N = 2048                // STFT frame (sqrt-Hann, 50% overlap → perfect reconstruction)
const HOP = N / 2
const HOLD_FRAMES = 8         // ~185 ms of pitch-follower gaps bridged
const DOUBLE_CUT = 0.1        // −20 dB on the lead's harmonics
const HALF_WIDTH_CENTS = 45
const MAX_HARMONIC_HZ = 9000

export function removeDoubles(channels: Float32Array[], sampleRate: number, lead: Float32Array): Float32Array[] {
  const len = channels[0]?.length ?? 0
  if (len === 0) return channels
  const { midi, hopSeconds } = trackPitch(lead, sampleRate)
  // The pitch follower misses some moments inside a sung note (~1 in 4 on
  // Pehla Pyaar); a note goes on through them, so use the nearest detected
  // pitch within HOLD_FRAMES (both ways).
  const f0At = (t: number) => {
    const f = Math.round(t / hopSeconds)
    for (let dist = 0; dist <= HOLD_FRAMES; dist++) {
      for (const g of dist === 0 ? [f] : [f - dist, f + dist]) {
        const m = midi[g]
        if (m !== undefined && !Number.isNaN(m)) return 440 * Math.pow(2, (m - 69) / 12)
      }
    }
    return 0
  }
  const win = new Float32Array(N)
  for (let i = 0; i < N; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
  const l = channels[0], r = channels[1] ?? channels[0]
  const outL = new Float32Array(len), outR = new Float32Array(len)
  const re = new Float64Array(N), im = new Float64Array(N), mask = new Float64Array(N)
  const binHz = sampleRate / N
  const lo = Math.pow(2, -HALF_WIDTH_CENTS / 1200), hi = Math.pow(2, HALF_WIDTH_CENTS / 1200)
  for (let off = -HOP; off < len; off += HOP) {
    const f0 = f0At((off + N / 2) / sampleRate)
    // Both channels in one complex FFT (left = real, right = imaginary): a real,
    // symmetric mask treats them identically.
    for (let i = 0; i < N; i++) {
      const k = off + i
      const w = win[i]
      re[i] = k >= 0 && k < len ? l[k] * w : 0
      im[i] = k >= 0 && k < len ? r[k] * w : 0
    }
    if (f0 > 0) {
      mask.fill(1)
      for (let h = 1; h * f0 <= Math.min(MAX_HARMONIC_HZ, sampleRate / 2 - binHz); h++) {
        const fh = h * f0
        const a = Math.max(1, Math.floor(Math.min(fh * lo, fh - 1.5 * binHz) / binHz))
        const b = Math.min(N / 2, Math.ceil(Math.max(fh * hi, fh + 1.5 * binHz) / binHz))
        for (let k = a; k <= b; k++) { mask[k] = DOUBLE_CUT; if (k > 0 && k < N / 2) mask[N - k] = DOUBLE_CUT }
      }
      fft(re, im)
      for (let k = 0; k < N; k++) { re[k] *= mask[k]; im[k] *= mask[k] }
      // inverse FFT via swap trick: ifft(x) = swap(fft(swap(x))) / N
      fft(im, re)
      for (let k = 0; k < N; k++) { re[k] /= N; im[k] /= N }
    }
    for (let i = 0; i < N; i++) {
      const k = off + i
      if (k < 0 || k >= len) continue
      outL[k] += re[i] * win[i]
      outR[k] += im[i] * win[i]
    }
  }
  return channels.length > 1 ? [outL, outR] : [outL]
}
