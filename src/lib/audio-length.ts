// Server-only audio length helpers for Song Studio (bundled ffmpeg — already
// in /api/song-studio's outputFileTracingIncludes).
//
//   measureAudioSeconds — exact length by decoding to the null muxer and
//                         reading the final time= (ffmpeg-static ships no
//                         ffprobe; header estimates can be off for VBR).
//   trimWithFadeOut     — cut to `targetSeconds` with a fade-out at the end.
//                         Only ever SHORTENS: never stretches or slows audio.
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import ffmpegPath from 'ffmpeg-static'

const execFileAsync = promisify(execFile)
const FFMPEG_TIMEOUT_MS = 30000

async function withTemp<T>(buf: Buffer, ext: string, fn: (dir: string, inFile: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvox-len-'))
  try {
    const inFile = path.join(dir, `in.${ext}`)
    await fs.writeFile(inFile, buf)
    return await fn(dir, inFile)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

function lastTime(stderr: string): number | null {
  // Last "time=HH:MM:SS.xx" progress line = total decoded length.
  const re = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g
  let m: RegExpExecArray | null
  let last: RegExpExecArray | null = null
  while ((m = re.exec(stderr)) !== null) last = m
  return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : null
}

// Exact length in seconds, or null if ffmpeg is unavailable / fails (callers
// treat null as "unknown" — never a reason to fail a paid generation).
export async function measureAudioSeconds(buf: Buffer, ext: string): Promise<number | null> {
  if (!ffmpegPath) return null
  try {
    return await withTemp(buf, ext, async (_dir, inFile) => {
      const { stderr } = await execFileAsync(ffmpegPath as string, ['-hide_banner', '-i', inFile, '-f', 'null', '-'], { timeout: FFMPEG_TIMEOUT_MS })
      return lastTime(stderr)
    })
  } catch (err) {
    console.warn('[audio-length] measure failed:', err instanceof Error ? err.message : String(err))
    return null
  }
}

// Cut to targetSeconds with a fadeSeconds fade-out ending exactly at the cut.
// Re-encodes once (mp3 256k / wav pcm). Returns null on failure — the caller
// keeps the untrimmed audio rather than fail the generation.
export async function trimWithFadeOut(
  buf: Buffer, ext: string, targetSeconds: number, fadeSeconds = 2.5,
): Promise<Buffer | null> {
  if (!ffmpegPath || targetSeconds <= fadeSeconds) return null
  try {
    return await withTemp(buf, ext, async (dir, inFile) => {
      const outFile = path.join(dir, `out.${ext}`)
      const codec = ext === 'wav' ? ['-c:a', 'pcm_s16le'] : ['-c:a', 'libmp3lame', '-b:a', '256k']
      await execFileAsync(ffmpegPath as string, [
        '-v', 'error', '-y', '-i', inFile,
        '-t', targetSeconds.toFixed(3),
        '-af', `afade=t=out:st=${(targetSeconds - fadeSeconds).toFixed(3)}:d=${fadeSeconds}`,
        ...codec, outFile,
      ], { timeout: FFMPEG_TIMEOUT_MS })
      return await fs.readFile(outFile)
    })
  } catch (err) {
    console.warn('[audio-length] trim failed, keeping untrimmed audio:', err instanceof Error ? err.message : String(err))
    return null
  }
}
