// Add harmony for Voice Swap: extra voices made from the converted vocal itself
// (pitch-shifted copies, formants kept so they sound like the same singer).
//
//  • Clearly MAJOR key → "scale" harmony: a 3rd above that follows the scale
//    (3 or 4 semitones depending on the note being sung, so every harmony note
//    is in key — a fixed +4 would sing G# over E in C major), and for 4 voices
//    also a 5th above (7, or 6 on the 7th degree) and an octave below. Same
//    layers as the "Option test" clips 5a/5b, but always in key.
//  • Minor key, or a key that isn't clear → "octaves": an octave above (and for
//    4 voices an octave below plus a slightly detuned double — Choir's Octaves
//    preset). Octaves can't clash with any chord.
//
// Each layer with two possible intervals is rendered at both and switched by a
// 20 ms crossfade, following which note is sung (pitch-track.ts).

import { shiftAudio } from './stretch'
import { trackPitch } from './pitch-track'
import type { KeyEstimate } from './key-detect'
import { HARMONY_GAIN, harmonyMode, type HarmonyMode, type HarmonyVoices } from './harmony-mode'

export { harmonyMode, type HarmonyMode, type HarmonyVoices }

const MIN_RUN_FRAMES = 4                  // ~90 ms: ignore quicker note flickers
const CROSSFADE_S = 0.02

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
const inScale = (deg: number) => MAJOR_SCALE.includes(((deg % 12) + 12) % 12)

interface Layer {
  intervals: number[]          // 1 or 2 semitone options
  choice: Uint8Array | null    // per pitch frame: index into intervals (2-option layers)
}

// Per-frame interval choice for "the diatonic interval above the sung note".
// Holds the last choice through rests and out-of-scale notes, and ignores
// changes shorter than MIN_RUN_FRAMES.
function diatonicChoice(midi: Float32Array, tonic: number, small: number, large: number): Uint8Array {
  const raw = new Int8Array(midi.length).fill(-1)
  for (let f = 0; f < midi.length; f++) {
    if (Number.isNaN(midi[f])) continue
    const deg = Math.round(midi[f]) - tonic
    if (!inScale(deg)) continue
    raw[f] = inScale(deg + large) ? 1 : inScale(deg + small) ? 0 : -1
  }
  const out = new Uint8Array(midi.length)
  let cur = raw.find((v) => v >= 0) ?? 1
  for (let f = 0; f < midi.length; ) {
    if (raw[f] < 0 || raw[f] === cur) { out[f++] = cur; continue }
    let end = f
    while (end < midi.length && (raw[end] === raw[f] || raw[end] < 0)) end++
    let run = 0
    for (let g = f; g < end; g++) if (raw[g] === raw[f]) run++
    if (run >= MIN_RUN_FRAMES) cur = raw[f]
    for (; f < end; f++) out[f] = cur
  }
  return out
}

export function planHarmony(midi: Float32Array, voices: HarmonyVoices, mode: HarmonyMode, tonic: number): Layer[] {
  if (mode === 'octaves') {
    return voices === 2
      ? [{ intervals: [12], choice: null }]
      : [{ intervals: [12], choice: null }, { intervals: [-12], choice: null }, { intervals: [0.35], choice: null }]
  }
  const layers: Layer[] = [{ intervals: [3, 4], choice: diatonicChoice(midi, tonic, 3, 4) }]
  if (voices === 4) {
    layers.push({ intervals: [6, 7], choice: diatonicChoice(midi, tonic, 6, 7) })
    layers.push({ intervals: [-12], choice: null })
  }
  return layers
}

export interface HarmonyResult {
  stem: Float32Array   // the added voices only (lead not included), mono
  mode: HarmonyMode
}

// vocal: the converted lead (mono). tonic/mode: the song's key AFTER any key
// change. formantSemitones: the Voice character setting, so the harmony voices
// share the lead's character.
export async function renderHarmony(
  vocal: Float32Array, sampleRate: number, voices: HarmonyVoices, key: KeyEstimate | null, formantSemitones = 0,
): Promise<HarmonyResult> {
  const mode = harmonyMode(key)
  const track = mode === 'scale' ? trackPitch(vocal, sampleRate) : null
  const layers = planHarmony(track?.midi ?? new Float32Array(0), voices, mode, key?.tonic ?? 0)
  const stem = new Float32Array(vocal.length)
  const shift = async (st: number) => (await shiftAudio([vocal], sampleRate, { semitones: st, formantCompensation: true, formantSemitones }))[0]
  const slew = 1 / Math.max(1, CROSSFADE_S * sampleRate)
  for (const layer of layers) {
    if (layer.intervals.length === 1 || !layer.choice || !track) {
      const y = await shift(layer.intervals[layer.intervals.length - 1])
      for (let i = 0; i < stem.length; i++) stem[i] += HARMONY_GAIN * y[i]
      continue
    }
    const [a, b] = await Promise.all(layer.intervals.map(shift))
    // Pitch frame f covers [f·hop, f·hop + frame); use its centre (~half a hop later).
    const hopS = track.hopSeconds
    let w = layer.choice[0]
    for (let i = 0; i < stem.length; i++) {
      const f = Math.min(layer.choice.length - 1, Math.max(0, Math.floor((i / sampleRate - hopS) / hopS)))
      const target = layer.choice.length ? layer.choice[f] : 1
      w = target > w ? Math.min(target, w + slew) : Math.max(target, w - slew)
      stem[i] += HARMONY_GAIN * ((1 - w) * a[i] + w * b[i])
    }
  }
  return { stem, mode }
}
