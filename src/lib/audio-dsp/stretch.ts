// Offline pitch / formant shifting with Signalsmith Stretch (MIT, vendored WASM
// core — see src/lib/vendor/signalsmith-stretch). Used by Voice Swap's Key
// change (music), Voice character (formants) and Add harmony (shifted copies).
//
// Runs the C core directly instead of the library's AudioWorklet node: in an
// OfflineAudioContext the worklet renders silence until its WASM has compiled,
// which would shift the result in time. Here the whole buffer is processed in
// blocks, and the output is trimmed so it lines up sample-for-sample with the
// input (measured 2026-10-04 on a 2-minute vocal: 0 samples off at 0 st,
// identity residual −99 dB, ~100–180× faster than real time in Node).

import createStretchModule, { type StretchWasmModule } from '@/lib/vendor/signalsmith-stretch/stretch-wasm.mjs'

export interface ShiftOptions {
  semitones?: number           // pitch shift
  formantSemitones?: number    // formant (voice character) shift
  formantCompensation?: boolean // keep formants in place when the pitch moves
  formantBaseHz?: number       // rough voice F0 for formant analysis; 0 = track it
  tonalityHz?: number          // tonality limit (library default 8000)
}

const BLOCK = 16384

let modulePromise: Promise<StretchWasmModule> | null = null
function stretchModule(): Promise<StretchWasmModule> {
  if (!modulePromise) modulePromise = createStretchModule()
  return modulePromise
}

// Returns new channel arrays, same length as the input, time-aligned.
export async function shiftAudio(channels: Float32Array[], sampleRate: number, o: ShiftOptions): Promise<Float32Array[]> {
  const M = await stretchModule()
  const ch = channels.length
  const N = channels[0]?.length ?? 0
  if (ch === 0 || N === 0) return channels.map((c) => c.slice())

  M._presetDefault(ch, sampleRate)
  M._reset()
  const inLat = M._inputLatency()
  const outLat = M._outputLatency()
  const L = Math.max(BLOCK, inLat, outLat)
  const ptr = M._setBuffers(ch, L)
  M._setTransposeSemitones(o.semitones ?? 0, (o.tonalityHz ?? 8000) / sampleRate)
  M._setFormantSemitones(o.formantSemitones ?? 0, !!o.formantCompensation)
  M._setFormantBase((o.formantBaseHz ?? 0) / sampleRate)

  // Views are re-made per block: WASM memory can move if it ever grows.
  const view = (c: number, out: boolean) => new Float32Array(M.HEAP8.buffer, ptr + L * 4 * (out ? ch + c : c), L)
  const fill = (c: number, from: number, n: number) => {
    const v = view(c, false)
    const end = Math.min(N, from + n)
    if (from < end) v.set(channels[c].subarray(from, end))
    v.fill(0, Math.max(0, end - from), n)
  }

  // Pre-roll the first inLat samples, then feed the rest plus inLat+outLat of
  // silence. After the pre-roll, output sample k is input sample k − outLat.
  for (let c = 0; c < ch; c++) fill(c, 0, inLat)
  M._seek(inLat, 1)
  const out = channels.map(() => new Float32Array(N))
  const total = N + inLat + outLat
  let pos = inLat, k = 0
  while (pos < total) {
    const n = Math.min(L, total - pos)
    for (let c = 0; c < ch; c++) fill(c, pos, n)
    M._process(n, n)
    const s0 = Math.max(k, outLat), s1 = Math.min(k + n, outLat + N)
    if (s1 > s0) for (let c = 0; c < ch; c++) out[c].set(view(c, true).subarray(s0 - k, s1 - k), s0 - outLat)
    k += n
    pos += n
  }
  return out
}
