// MP3 encoding straight from float samples (2026-10-10). Byte-for-byte the
// same file the save used to make via encodeWav → encodeMp3FromWav: samples
// are clamped and turned into 16-bit PCM exactly the way encodeWav writes
// them, then fed to lamejs in the same 1152-frame chunks. Skipping the WAV
// step lets the save encode in a background thread (mp3.worker.ts).
import { Mp3Encoder } from '@breezystack/lamejs'

export function encodeMp3Pcm(channels: Float32Array[], sampleRate: number, kbps: number): Uint8Array {
  const numCh = Math.min(channels.length, 2)
  // encodeWav: setInt16(sample < 0 ? sample * 0x8000 : sample * 0x7FFF) — an
  // Int16Array store converts the same way (truncates toward zero).
  const pcm = (ch: Float32Array): Int16Array => {
    const out = new Int16Array(ch.length)
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]))
      out[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
    }
    return out
  }
  const left = pcm(channels[0])
  const right = numCh > 1 ? pcm(channels[1]) : undefined
  const encoder = new Mp3Encoder(numCh, sampleRate, kbps)
  const CHUNK = 1152
  const chunks: Uint8Array[] = []
  let total = 0
  const push = (raw: Uint8Array) => { if (raw.length > 0) { const c = raw.slice(); chunks.push(c); total += c.length } }
  for (let i = 0; i < left.length; i += CHUNK) {
    const l = left.subarray(i, i + CHUNK)
    push(right ? encoder.encodeBuffer(l, right.subarray(i, i + CHUNK)) : encoder.encodeBuffer(l))
  }
  push(encoder.flush())
  const out = new Uint8Array(total)
  let o = 0
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}
