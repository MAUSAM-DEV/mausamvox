// Client-side helpers for the presign → direct-PUT upload flow into the
// `audio-uploads` bucket (Voice Swap, Stem Studio, Choir, Instruments).
//
// Why this exists — three production failures traced to the bucket itself,
// all reproduced against the live project (2026-09-27):
//   1. Size: the bucket's file_size_limit is 50 MiB (and the project-wide
//      global limit caps it there on the current plan) while the UI promised
//      75 MB → Storage answers HTTP 400 {"statusCode":"413","EntityTooLarge"}.
//   2. MIME: the bucket allow-list is exact-match. Browsers report WAV as
//      audio/wav OR audio/x-wav / audio/wave, and MediaRecorder reports
//      "audio/webm;codecs=opus" → HTTP 400 {"statusCode":"415"}. That killed
//      every Choir/Instruments mic recording before the API route ran.
//   3. The UI only ever showed "Storage upload failed (400)".
//
// So: send a canonical base MIME type, compress oversize WAVs to MP3 in the
// browser, and turn Storage's JSON errors into messages with the real limit.
import { Mp3Encoder } from '@breezystack/lamejs'

// Used only if /api/upload-stem/presign couldn't read the bucket's limit.
export const STORAGE_FALLBACK_MAX_BYTES = 50 * 1024 * 1024

// 320 kbps CBR = 40,000 bytes/s → a 75 MB CD-quality WAV (~7.4 min) lands at
// ~17 MB. Highest standard MP3 bitrate; only applied to WAVs that are too big
// to upload as-is (smaller files are never touched).
const COMPRESS_KBPS = 320
const LAME_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]

export function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Strip codec parameters and fold vendor aliases onto the types the bucket
// allows — "audio/webm;codecs=opus" → "audio/webm", "audio/x-wav" → "audio/wav".
export function canonicalAudioMime(filename: string, reportedType: string): string {
  const base = (reportedType || '').split(';')[0].trim().toLowerCase()
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const t = base || ({ mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', webm: 'audio/webm', ogg: 'audio/ogg' } as Record<string, string>)[ext] || 'audio/mpeg'
  if (t === 'audio/x-wav' || t === 'audio/wave' || t === 'audio/vnd.wave') return 'audio/wav'
  if (t === 'audio/mp3') return 'audio/mpeg'
  if (t === 'audio/x-m4a' || t === 'audio/aac') return 'audio/mp4'
  if (t === 'video/webm') return 'audio/webm' // some browsers label audio-only webm as video
  return t
}

export function isWav(file: File): boolean {
  return file.name.toLowerCase().endsWith('.wav') || canonicalAudioMime(file.name, file.type) === 'audio/wav'
}

// PUT to the presigned URL; on failure, surface what Storage actually said.
export async function putToStorage(
  uploadUrl: string,
  body: Blob,
  mime: string,
  maxBytes: number,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': mime, 'x-upsert': 'false' },
  })
  if (res.ok) return

  let code = ''
  let message = ''
  try {
    const j = await res.json()
    code = String(j.statusCode ?? j.code ?? '')
    message = String(j.message ?? '')
  } catch { /* non-JSON body */ }

  if (code === '413' || code === 'EntityTooLarge' || res.status === 413) {
    throw new Error(`File is too large to upload (${formatMB(body.size)}) — the maximum is ${formatMB(maxBytes)}.`)
  }
  if (code === '415' || code === 'InvalidMimeType' || res.status === 415) {
    throw new Error(`This audio format (${mime}) can't be uploaded — please use MP3, WAV or M4A.`)
  }
  throw new Error(`Storage upload failed (${res.status}${message ? `: ${message}` : ''})`)
}

type Presign = { uploadUrl: string; path: string; maxBytes?: number }

async function presignFor(file: File): Promise<Presign> {
  const res = await fetch('/api/upload-stem/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, contentType: canonicalAudioMime(file.name, file.type) }),
  })
  // Check ok before .json() — a cold-start timeout returns HTML, not JSON.
  if (!res.ok) {
    let msg = `Failed to get upload URL (${res.status})`
    try { const e = await res.json(); msg = e.error ?? msg } catch { /* HTML body — use status */ }
    throw new Error(msg)
  }
  return res.json()
}

// The whole upload: presign (which also returns the bucket's real limit) →
// if over the limit, compress a WAV to MP3 (anything else: clear error) →
// re-presign so the stored path carries .mp3 → PUT. Files under the limit are
// uploaded byte-for-byte untouched. Returns the durable storage path.
export async function uploadAudioToStorage(
  file: File,
  opts: { onCompressProgress?: (pct: number | null) => void } = {},
): Promise<{ path: string; uploadedName: string; compressed: boolean }> {
  let presign = await presignFor(file)
  const maxBytes = presign.maxBytes ?? STORAGE_FALLBACK_MAX_BYTES

  let upload = file
  if (file.size > maxBytes) {
    if (!isWav(file)) {
      throw new Error(`File is ${formatMB(file.size)} — the upload limit for MP3/M4A is ${formatMB(maxBytes)}. Try a shorter file or a lower bitrate.`)
    }
    opts.onCompressProgress?.(0)
    try {
      upload = await compressWavToMp3(file, (f) => opts.onCompressProgress?.(Math.round(f * 100)))
    } catch (err) {
      console.error('[upload] WAV compression failed:', err)
      throw new Error(`This WAV is ${formatMB(file.size)} (limit ${formatMB(maxBytes)}) and couldn't be compressed in your browser. Please convert it to MP3 and upload that.`)
    } finally {
      opts.onCompressProgress?.(null)
    }
    console.log(`[upload] compressed ${file.name} ${formatMB(file.size)} → ${upload.name} ${formatMB(upload.size)}`)
    if (upload.size > maxBytes) {
      throw new Error(`Even compressed, this file is ${formatMB(upload.size)} — the limit is ${formatMB(maxBytes)}. Try a shorter file.`)
    }
    // Downstream tools (Demucs, ffmpeg) must not see MP3 bytes behind .wav.
    presign = await presignFor(upload)
  }

  await putToStorage(presign.uploadUrl, upload, canonicalAudioMime(upload.name, upload.type), maxBytes)
  return { path: presign.path, uploadedName: upload.name, compressed: upload !== file }
}

// Sample rate from a WAV header (walks the RIFF chunks to "fmt "). Lets us
// decode at the file's own rate instead of resampling to the device's rate.
function wavSampleRate(buf: ArrayBuffer): number | null {
  const v = new DataView(buf)
  if (buf.byteLength < 44) return null
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let o = 12
  while (o + 8 <= buf.byteLength) {
    const size = v.getUint32(o + 4, true)
    if (tag(o) === 'fmt ' && o + 16 <= buf.byteLength) return v.getUint32(o + 12, true)
    o += 8 + size + (size % 2)
  }
  return null
}

// WAV → 320 kbps MP3, in the browser. Decodes with Web Audio (handles 16/24/
// 32-bit + float WAVs), then encodes in chunks, yielding to the event loop so
// the page stays responsive and progress (0..1) can render.
export async function compressWavToMp3(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<File> {
  const raw = await file.arrayBuffer()
  const headerRate = wavSampleRate(raw)
  const rate = headerRate && LAME_RATES.includes(headerRate)
    ? headerRate
    : headerRate && headerRate > 48000 ? 48000 : 44100

  const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
  const audio = await new Ctx(2, 1, rate).decodeAudioData(raw)

  const numCh = Math.min(audio.numberOfChannels, 2)
  const left = audio.getChannelData(0)
  const right = numCh > 1 ? audio.getChannelData(1) : null
  const encoder = new Mp3Encoder(numCh, rate, COMPRESS_KBPS)

  const FRAME = 1152
  const YIELD_EVERY = FRAME * 200 // ~5 s of audio per slice
  const l16 = new Int16Array(FRAME)
  const r16 = new Int16Array(FRAME)
  const out: Uint8Array<ArrayBuffer>[] = []
  const toI16 = (src: Float32Array, dst: Int16Array, from: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const s = src[from + i]
      dst[i] = s <= -1 ? -32768 : s >= 1 ? 32767 : Math.round(s * 32767)
    }
  }

  for (let i = 0; i < left.length; i += FRAME) {
    const n = Math.min(FRAME, left.length - i)
    toI16(left, l16, i, n)
    let mp3: Uint8Array
    if (right) {
      toI16(right, r16, i, n)
      mp3 = encoder.encodeBuffer(l16.subarray(0, n), r16.subarray(0, n))
    } else {
      mp3 = encoder.encodeBuffer(l16.subarray(0, n))
    }
    if (mp3.length) out.push(mp3.slice() as Uint8Array<ArrayBuffer>)
    if (i % YIELD_EVERY === 0) {
      onProgress?.(i / left.length)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  const tail = encoder.flush()
  if (tail.length) out.push(tail.slice() as Uint8Array<ArrayBuffer>)
  onProgress?.(1)

  const name = file.name.replace(/\.wav$/i, '') + '.mp3'
  return new File(out, name, { type: 'audio/mpeg' })
}
