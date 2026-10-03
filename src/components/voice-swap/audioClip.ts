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
// MP3 encoder — uses @breezystack/lamejs (maintained lamejs fork)
// ---------------------------------------------------------------------------
// Bitrate the app SAVES tracks at (full mix + music-only backing). 320 kbps:
// same top end as 192 but ~10 dB less coding noise (measured 2026-10-03).
export const SAVED_MP3_KBPS = 320

export function encodeMp3(buffer: AudioBuffer, kbps = 192): Blob {
  const numCh = Math.min(buffer.numberOfChannels, 2)
  const encoder = new Mp3Encoder(numCh, buffer.sampleRate, kbps)
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

// Encodes a 16-bit PCM WAV (the format encodeWav writes — our own finished mix)
// straight to MP3: the PCM samples go to the encoder as-is. Skips the browser
// decodeAudioData round-trip, which resampled the mix to the device's sample
// rate (often 48 kHz) before encoding. Throws on anything but 16-bit PCM.
export function encodeMp3FromWav(wav: ArrayBuffer, kbps = SAVED_MP3_KBPS): Blob {
  const v = new DataView(wav)
  const tag = (off: number) => String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file')
  let pos = 12, numCh = 0, sampleRate = 0, bits = 0, dataOff = -1, dataLen = 0
  while (pos + 8 <= wav.byteLength) {
    const id = tag(pos), size = v.getUint32(pos + 4, true)
    if (id === 'fmt ') {
      if (v.getUint16(pos + 8, true) !== 1) throw new Error('WAV is not PCM')
      numCh = v.getUint16(pos + 10, true); sampleRate = v.getUint32(pos + 12, true); bits = v.getUint16(pos + 22, true)
    } else if (id === 'data') {
      dataOff = pos + 8; dataLen = Math.min(size, wav.byteLength - dataOff); break
    }
    pos += 8 + size + (size % 2)
  }
  if (bits !== 16 || dataOff < 0 || numCh < 1) throw new Error('WAV must be 16-bit PCM')
  const outCh = Math.min(numCh, 2)
  const frames = Math.floor(dataLen / (numCh * 2))
  const left = new Int16Array(frames)
  const right = outCh > 1 ? new Int16Array(frames) : undefined
  for (let i = 0, o = dataOff; i < frames; i++, o += numCh * 2) {
    left[i] = v.getInt16(o, true)
    if (right) right[i] = v.getInt16(o + 2, true)
  }
  const encoder = new Mp3Encoder(outCh, sampleRate, kbps)
  const CHUNK = 1152
  const chunks: Uint8Array<ArrayBuffer>[] = []
  const push = (raw: Uint8Array) => {
    if (raw.length > 0) chunks.push(raw.slice() as Uint8Array<ArrayBuffer>)
  }
  for (let i = 0; i < frames; i += CHUNK) {
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
