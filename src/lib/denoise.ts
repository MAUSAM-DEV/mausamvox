import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import ffmpegPath from 'ffmpeg-static'

// Shared ffmpeg-only vocal cleanup (no model, no API cost): a light chain that
// removes low-frequency rumble/hum and steady background noise from a voice
// recording WITHOUT audibly damaging the voice itself. Built for the clone-
// training input path (cleaner training samples = better clones); reusable for
// other vocal inputs.
//
// Chain: highpass (rumble/hum below the voice) → afftdn (FFT denoiser at a
// conservative strength, with adaptive noise tracking so it follows changing
// room noise). Output is 16-bit PCM WAV, mono 44.1 kHz — the same shape
// prepare-dataset's clip splitter expects, whatever the input format was.
//
// This function NEVER throws: on any ffmpeg failure (bad file, missing binary,
// timeout) it returns the ORIGINAL buffer, so the caller's pipeline proceeds
// exactly as if cleanup was off.

// ── Tunable settings ──────────────────────────────────────────────────────────
// Cut everything below this — traffic rumble, desk thumps, mains hum harmonics
// live down here; male vocal fundamentals start ~85 Hz, so 80 is voice-safe.
export const DENOISE_HIGHPASS_HZ = 80
// afftdn noise-reduction amount in dB. 12 is ffmpeg's default and deliberately
// conservative — enough to tame fans/hiss, low risk of watery vocal artifacts.
export const DENOISE_STRENGTH_DB = 12
// afftdn noise-floor estimate in dBFS (ffmpeg default). With tracking enabled
// below this is only the starting point.
export const DENOISE_FLOOR_DB = -50
// tn=1: continuously track the noise profile instead of trusting one estimate —
// phone recordings rarely have stationary noise.
const DENOISE_FILTER = `highpass=f=${DENOISE_HIGHPASS_HZ},afftdn=nr=${DENOISE_STRENGTH_DB}:nf=${DENOISE_FLOOR_DB}:tn=1`

const OUTPUT_SAMPLE_RATE = 44100
const FFMPEG_TIMEOUT_MS = 45000

const execFileAsync = promisify(execFile)

export async function denoiseVocal(input: Buffer, logTag: string): Promise<Buffer> {
  if (!ffmpegPath) {
    console.warn(`${logTag} denoise skipped: ffmpeg unavailable on this platform`)
    return input
  }
  let workDir: string | null = null
  try {
    workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvox-denoise-'))
    // Temp files, not pipes: m4a (mp4 container) can't reliably stream via stdin.
    const inFile = path.join(workDir, 'in')
    const outFile = path.join(workDir, 'out.wav')
    await fs.writeFile(inFile, input)

    // -bitexact keeps the WAV header minimal (fmt chunk at the standard offset
    // the dataset splitter reads from) — same flags as its convertToWav.
    await execFileAsync(ffmpegPath, [
      '-v', 'error', '-y',
      '-i', inFile,
      '-af', DENOISE_FILTER,
      '-ac', '1',
      '-ar', String(OUTPUT_SAMPLE_RATE),
      '-c:a', 'pcm_s16le',
      '-bitexact',
      outFile,
    ], { timeout: FFMPEG_TIMEOUT_MS })

    const out = await fs.readFile(outFile)
    if (out.length === 0) throw new Error('denoise produced an empty file')
    console.log(`${logTag} denoise applied (${DENOISE_FILTER}): ${input.length} → ${out.length} bytes`)
    return out
  } catch (err) {
    console.warn(`${logTag} denoise failed — using original audio:`, err instanceof Error ? err.message : String(err))
    return input
  } finally {
    if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}
