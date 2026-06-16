// Shared helpers for the Quick/Pro/Upload recording panels.

export const MIN_DURATION_SEC = 30

export function formatTime(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

// MediaRecorder support (and preferred mime type) varies by browser —
// Chrome/Firefox favor webm/opus, Safari only does mp4/aac.
const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
]

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined
  return RECORDER_MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m))
}

export function extFromMimeType(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mpeg')) return 'mp3'
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

// Encodes mono 32-bit float PCM samples into a 16-bit PCM WAV Blob.
// Used by Pro Record, which needs a real WAV file rather than whatever
// compressed format MediaRecorder happens to produce.
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2
  const blockAlign = bytesPerSample
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)        // fmt chunk size
  view.setUint16(20, 1, true)         // PCM
  view.setUint16(22, 1, true)         // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true) // byte rate
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)        // bits per sample
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

export function concatFloat32(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const result = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

// RMS amplitude (0–1) of a frame, used by Pro Record's level meter.
export function rms(samples: Float32Array): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}
