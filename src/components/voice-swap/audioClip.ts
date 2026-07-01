// Shared browser audio helpers: WAV/MP3 encoding (extracted from ResultStep so
// the Fine-tune preview pipeline can reuse them) plus a decode→trim→encode clip
// helper used to build a short preview render without sending the full song.
import { Mp3Encoder } from '@breezystack/lamejs'

// ---------------------------------------------------------------------------
// WAV encoder — pure 16-bit PCM, no external dependencies
// ---------------------------------------------------------------------------
export function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = Math.min(buffer.numberOfChannels, 2)
  const numFrames = buffer.length
  const sampleRate = buffer.sampleRate
  const dataLen = numFrames * numCh * 2
  const ab = new ArrayBuffer(44 + dataLen)
  const v = new DataView(ab)
  const s = (off: number, str: string) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)) }

  s(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); s(8, 'WAVE')
  s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, numCh, true); v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * numCh * 2, true); v.setUint16(32, numCh * 2, true)
  v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, dataLen, true)

  let pos = 44
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]))
      v.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
      pos += 2
    }
  }
  return new Blob([ab], { type: 'audio/wav' })
}

// ---------------------------------------------------------------------------
// MP3 encoder — uses @breezystack/lamejs (maintained lamejs fork), 192 kbps
// ---------------------------------------------------------------------------
export function encodeMp3(buffer: AudioBuffer): Blob {
  const numCh = Math.min(buffer.numberOfChannels, 2)
  const encoder = new Mp3Encoder(numCh, buffer.sampleRate, 192)
  const toInt16 = (ch: Float32Array): Int16Array => {
    const out = new Int16Array(ch.length)
    for (let i = 0; i < ch.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(ch[i] * 32768)))
    return out
  }
  const left = toInt16(buffer.getChannelData(0))
  const right = numCh > 1 ? toInt16(buffer.getChannelData(1)) : undefined
  const CHUNK = 1152
  const chunks: Uint8Array<ArrayBuffer>[] = []
  const push = (raw: Uint8Array) => {
    if (raw.length > 0) chunks.push(raw.slice() as Uint8Array<ArrayBuffer>)
  }
  for (let i = 0; i < left.length; i += CHUNK) {
    const l = left.subarray(i, i + CHUNK)
    push(right ? encoder.encodeBuffer(l, right.subarray(i, i + CHUNK)) : encoder.encodeBuffer(l))
  }
  push(encoder.flush())
  return new Blob(chunks, { type: 'audio/mpeg' })
}

// ---------------------------------------------------------------------------
// Synthetic reverb impulse response — an exponentially-decaying stereo noise
// buffer, generated in code so the Reverb polish control needs no bundled
// asset or fetch. `seconds` sets the tail length, `decay` shapes how fast it
// dies out (higher = tighter "room" feel rather than a long cathedral tail).
// ---------------------------------------------------------------------------
export function createReverbImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.max(1, Math.round(ctx.sampleRate * seconds))
  const buf = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay)
    }
  }
  return buf
}

// ---------------------------------------------------------------------------
// Decode an audio URL, keep a `seconds`-long window starting at `startSeconds`,
// and re-encode as MP3. Used to build a short preview clip so a tuning render
// processes ~12 s instead of the whole song (faster + cheaper). `startSeconds`
// lets the caller skip music-only intros and preview any part of the track; the
// window is clamped so start + length never runs past the decoded length.
// Returns an MP3 Blob.
// ---------------------------------------------------------------------------
export async function trimAudioToClip(
  url: string,
  seconds: number,
  startSeconds = 0,
): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Could not fetch source audio (${res.status})`)
  const arr = await res.arrayBuffer()

  const ctx = new AudioContext()
  try {
    const decoded = await ctx.decodeAudioData(arr)
    const sr = decoded.sampleRate
    const numCh = Math.min(decoded.numberOfChannels, 2)
    const total = decoded.length
    const wantFrames = Math.ceil(seconds * sr)
    // Clamp the start so a full-length window still fits inside the track; never
    // let start + length exceed the decoded length.
    const startFrame = Math.max(0, Math.min(Math.floor(startSeconds * sr), Math.max(0, total - wantFrames)))
    const frames = Math.min(wantFrames, total - startFrame)
    const clip = ctx.createBuffer(numCh, frames, sr)
    for (let c = 0; c < numCh; c++) {
      clip.copyToChannel(decoded.getChannelData(c).subarray(startFrame, startFrame + frames), c)
    }
    return encodeMp3(clip)
  } finally {
    await ctx.close()
  }
}
