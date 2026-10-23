import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import ffmpegPath from 'ffmpeg-static'

const execFileAsync = promisify(execFile)

// Any recording ffmpeg can read → a lossless 16-bit mono WAV at its own sample rate (max 48 kHz),
// with its length and a 160-bar waveform. Used by /api/voice-lab/convert-sample for uploads the
// browser can't read (iPhone Voice Memos lossless = Apple Lossless / ALAC, FLAC, AIFF, …).
// Mono: every engine reads voice samples as mono anyway (dataset prep downmixes too).

const PEAK_BUCKETS = 160
const MAX_RATE = 48000

export type ConvertedSample = { wav: Buffer; rate: number; durationSec: number; peaks: number[]; codec: string }
export type ConvertFailure = { error: string; log: string }

export async function convertSample(input: Buffer): Promise<ConvertedSample | ConvertFailure> {
  if (!ffmpegPath) return { error: 'Audio conversion is not available right now.', log: 'no ffmpeg binary' }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvox-sample-'))
  const inFile = path.join(dir, 'input'), outFile = path.join(dir, 'output.wav')
  try {
    // temp files, not pipes: an .m4a (mp4 container) can't reliably stream via stdin
    await fs.writeFile(inFile, input)
    // What's inside (ffmpeg with no output prints the streams and exits non-zero)
    const probe = await execFileAsync(ffmpegPath, ['-hide_banner', '-i', inFile]).then((r) => r.stderr, (e: { stderr?: string }) => e.stderr ?? '')
    const audio = probe.match(/Stream #[^\n]*Audio: ([^\n]*)/)
    if (!audio) return { error: 'We couldn’t find any audio in this file — is it a voice recording?', log: 'no audio stream' }
    const codec = audio[1].trim().slice(0, 80)
    const rate = Math.min(Number(audio[1].match(/(\d+) Hz/)?.[1]) || 44100, MAX_RATE)
    try {
      await execFileAsync(ffmpegPath, ['-v', 'error', '-y', '-i', inFile, '-vn', '-ac', '1', '-ar', String(rate), '-c:a', 'pcm_s16le', '-bitexact', outFile])
    } catch (err) {
      return { error: 'We couldn’t read this recording — try exporting it as WAV, MP3 or M4A.', log: `ffmpeg failed (${codec}): ${((err as { stderr?: string }).stderr ?? String(err)).slice(0, 300)}` }
    }
    const wav = await fs.readFile(outFile)
    const pcm = pcmOf(wav)
    return { wav, rate, durationSec: pcm.length / 2 / rate, peaks: peaksOf(pcm), codec }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// The PCM bytes of a WAV (finds the 'data' chunk; the header isn't always 44 bytes).
function pcmOf(wav: Buffer): Buffer {
  let pos = 12
  while (pos + 8 <= wav.length) {
    const id = wav.toString('ascii', pos, pos + 4), size = wav.readUInt32LE(pos + 4)
    if (id === 'data') return wav.subarray(pos + 8, Math.min(wav.length, pos + 8 + size))
    pos += 8 + size + (size % 2)
  }
  return Buffer.alloc(0)
}

// Loudest |sample| per bar, 0–1 — what the upload panel's waveform draws.
function peaksOf(pcm: Buffer): number[] {
  const n = Math.floor(pcm.length / 2), size = Math.floor(n / PEAK_BUCKETS)
  if (size <= 0) return []
  const peaks: number[] = []
  for (let b = 0; b < PEAK_BUCKETS; b++) {
    let max = 0
    for (let i = b * size; i < (b + 1) * size; i++) { const v = Math.abs(pcm.readInt16LE(i * 2)); if (v > max) max = v }
    peaks.push(Number((max / 32768).toFixed(3)))
  }
  return peaks
}
