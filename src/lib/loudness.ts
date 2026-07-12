import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import ffmpegPath from 'ffmpeg-static'

// Shared loudness normalization for ALL generated audio (Song Studio, Choir,
// Instruments) so every track the app produces plays at the same level as the
// rest of the app. EBU R128 loudnorm, streaming-standard target — tune the
// three constants below and every feature follows.
//
// Two-pass: pass 1 measures the file, pass 2 applies a linear (non-pumping)
// gain to hit the target exactly. If measurement parsing fails (e.g. silence
// → -inf), it falls back to single-pass dynamic loudnorm; if ffmpeg fails
// entirely, the ORIGINAL buffer is returned — a quiet track beats a failed
// generation the user already paid for. This function never throws.
export const LOUDNESS_TARGET_LUFS = -14 // integrated loudness (Spotify/YouTube ballpark)
export const LOUDNESS_TRUE_PEAK_DB = -1 // true-peak ceiling
export const LOUDNESS_LRA = 11 // loudness range

const OUTPUT_SAMPLE_RATE = 44100
const FFMPEG_TIMEOUT_MS = 45000

const execFileAsync = promisify(execFile)

const BASE_FILTER = `loudnorm=I=${LOUDNESS_TARGET_LUFS}:TP=${LOUDNESS_TRUE_PEAK_DB}:LRA=${LOUDNESS_LRA}`

// Pass 1 prints its measurements as a JSON block on stderr; grab the last {...}.
function parseMeasurement(stderr: string): string | null {
  const blocks = stderr.match(/\{[^{}]*\}/g)
  if (!blocks || blocks.length === 0) return null
  try {
    const m = JSON.parse(blocks[blocks.length - 1]) as Record<string, string>
    const i = parseFloat(m.input_i)
    const tp = parseFloat(m.input_tp)
    const lra = parseFloat(m.input_lra)
    const thresh = parseFloat(m.input_thresh)
    const offset = parseFloat(m.target_offset)
    if (![i, tp, lra, thresh, offset].every(Number.isFinite)) return null // silence measures -inf
    return `${BASE_FILTER}:measured_I=${i}:measured_TP=${tp}:measured_LRA=${lra}:measured_thresh=${thresh}:offset=${offset}:linear=true`
  } catch {
    return null
  }
}

export async function normalizeLoudness(
  input: Buffer,
  format: 'mp3' | 'wav',
  logTag: string
): Promise<Buffer> {
  if (!ffmpegPath) {
    console.warn(`${logTag} loudnorm skipped: ffmpeg unavailable on this platform`)
    return input
  }
  let workDir: string | null = null
  try {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvox-loudnorm-'))
    const inFile = path.join(workDir, 'in')
    const outFile = path.join(workDir, `out.${format}`)
    await fs.writeFile(inFile, input)

    // Pass 1 — measure only (loudnorm prints stats at info level, so no -v error).
    let filter = BASE_FILTER
    try {
      const { stderr } = await execFileAsync(ffmpegPath, [
        '-hide_banner', '-nostats', '-y', '-i', inFile,
        '-af', `${BASE_FILTER}:print_format=json`,
        '-f', 'null', '-',
      ], { timeout: FFMPEG_TIMEOUT_MS })
      filter = parseMeasurement(stderr) ?? BASE_FILTER
    } catch (err) {
      console.warn(`${logTag} loudnorm measure pass failed, using single-pass:`, err instanceof Error ? err.message : String(err))
    }

    // Pass 2 — apply. loudnorm internally upsamples to 192 kHz; pin the
    // output rate back to normal.
    const codecArgs = format === 'mp3'
      ? ['-c:a', 'libmp3lame', '-b:a', '256k']
      : ['-c:a', 'pcm_s16le']
    await execFileAsync(ffmpegPath, [
      '-v', 'error', '-y', '-i', inFile,
      '-af', filter,
      '-ar', String(OUTPUT_SAMPLE_RATE),
      ...codecArgs, outFile,
    ], { timeout: FFMPEG_TIMEOUT_MS })

    const out = await fs.readFile(outFile)
    if (out.length === 0) throw new Error('loudnorm produced an empty file')
    return out
  } catch (err) {
    console.warn(`${logTag} loudness normalization failed — using un-normalized audio:`, err instanceof Error ? err.message : String(err))
    return input
  } finally {
    if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
