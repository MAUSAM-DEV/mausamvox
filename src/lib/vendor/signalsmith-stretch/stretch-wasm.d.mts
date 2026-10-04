// Types for the vendored Signalsmith Stretch WASM factory (stretch-wasm.mjs).
// Only the C exports MausamVox calls are listed.
export interface StretchWasmModule {
  HEAP8: Int8Array
  _presetDefault(channels: number, sampleRate: number): void
  _reset(): void
  _inputLatency(): number
  _outputLatency(): number
  _setBuffers(channels: number, length: number): number
  _setTransposeSemitones(semitones: number, tonalityLimit: number): void
  _setFormantSemitones(semitones: number, compensate: boolean): void
  _setFormantBase(baseFreq: number): void
  _seek(inputSamples: number, playbackRate: number): void
  _process(inputSamples: number, outputSamples: number): void
}
declare const createStretchModule: (moduleArg?: Record<string, unknown>) => Promise<StretchWasmModule>
export default createStretchModule
