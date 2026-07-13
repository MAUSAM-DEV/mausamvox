import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import JSZip from 'jszip'
import ffmpegPath from 'ffmpeg-static'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { denoiseVocal } from '@/lib/denoise'

const execFileAsync = promisify(execFile)

export const maxDuration = 60

// ZIP layout that replicate/train-rvc-model requires (verified against the
// model's live OpenAPI schema): `dataset/<rvc_name>/split_<i>.wav`.
// The inner folder name becomes the trained model's name in the output zip;
// it's otherwise arbitrary, so we use a stable constant.
const DATASET_FOLDER = 'dataset'
const DATASET_NAME = 'model'

// Each clip is this many seconds long. 10 s is the RVC sweet spot:
// long enough to capture voice character, short enough for many clips.
const CLIP_SECONDS = 10

// Clips shorter than this are dropped — too little data for a training sample.
const MIN_CLIP_SECONDS = 2

// Signed URL TTL for the dataset ZIP (7 days). Training jobs can queue for
// hours; the URL must stay valid until Replicate fetches the input.
const DATASET_URL_TTL = 7 * 24 * 60 * 60

export async function POST(req: NextRequest) {
  console.log('[prepare-dataset] handler entered')
  try {
    if (!adminConfigured) {
      console.error('[prepare-dataset] SUPABASE_SERVICE_ROLE_KEY is not configured')
      return NextResponse.json(
        { error: 'Server configuration error: service role key is missing.' },
        { status: 500 }
      )
    }

    // ── 1. Authenticate ──────────────────────────────────────────────────────
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) {
      // Unwrap the FULL underlying error — the UI only sees "fetch failed", which
      // hides the real reason (HTTP/2 stream error, DNS, TLS, timeout) and which
      // host was being reached. Walk the .cause chain so e.g. ENHANCE_YOUR_CALM
      // / ECONNRESET / ENOTFOUND is visible in the server log.
      const causeChain: string[] = []
      let c: unknown = (authError as { cause?: unknown }).cause
      while (c instanceof Error && causeChain.length < 5) {
        const code = (c as { code?: string }).code
        causeChain.push(`${c.name}: ${c.message}${code ? ` (${code})` : ''}`)
        c = (c as { cause?: unknown }).cause
      }
      console.error(
        '[prepare-dataset] AUTH FAILED —',
        'name:', authError.name,
        '| message:', authError.message,
        '| status:', (authError as { status?: number }).status ?? 'n/a',
        '| causeChain:', causeChain.length ? causeChain.join(' <- ') : 'none',
        '| supabaseUrl:', process.env.NEXT_PUBLIC_SUPABASE_URL
      )
      return NextResponse.json({ error: 'Auth error: ' + authError.message }, { status: 401 })
    }
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }
    console.log('[prepare-dataset] user:', user.id)

    // ── 2. Parse body ────────────────────────────────────────────────────────
    let body: { audioUrl?: string; voiceCloneId?: string; denoise?: boolean }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { audioUrl, voiceCloneId } = body
    // Optional vocal cleanup, default ON (matches the Voice Lab toggle) —
    // users disable it for already-clean studio recordings.
    const denoise = body.denoise !== false
    if (!voiceCloneId) {
      return NextResponse.json({ error: 'voiceCloneId is required' }, { status: 400 })
    }

    // ── 3. Verify ownership of the voice clone ───────────────────────────────
    const { data: clone, error: cloneError } = await supabaseAdmin
      .from('voice_clones')
      .select('id, user_id, sample_path')
      .eq('id', voiceCloneId)
      .eq('user_id', user.id)
      .single()

    if (cloneError || !clone) {
      console.error('[prepare-dataset] clone not found or wrong owner:', cloneError?.message)
      return NextResponse.json({ error: 'Voice clone not found' }, { status: 404 })
    }
    console.log('[prepare-dataset] clone verified:', voiceCloneId)

    // ── 4. Download the audio ────────────────────────────────────────────────
    // Sign a FRESH URL from the durable sample_path (the source of truth). The
    // stored sample_url was removed because it expired; audioUrl, if still sent by
    // an older client, is only a last-resort fallback when sample_path is missing.
    let fetchUrl: string | undefined = audioUrl
    if (clone.sample_path) {
      const { data: fresh } = await supabaseAdmin.storage
        .from('voice-samples')
        .createSignedUrl(clone.sample_path, 300) // 5-min TTL, only needed for this download
      if (fresh?.signedUrl) fetchUrl = fresh.signedUrl
    }
    if (!fetchUrl) {
      return NextResponse.json({ error: 'No sample available to prepare (missing sample_path)' }, { status: 400 })
    }

    console.log('[prepare-dataset] downloading audio')
    const audioRes = await fetch(fetchUrl)
    if (!audioRes.ok) {
      return NextResponse.json(
        { error: `Failed to download audio: HTTP ${audioRes.status}` },
        { status: 502 }
      )
    }
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer())
    console.log('[prepare-dataset] downloaded', audioBuffer.length, 'bytes')

    // ── 5. Optional vocal cleanup, then split into clips ─────────────────────
    // Cleanup runs BEFORE splitting so every training clip benefits. On success
    // denoiseVocal returns cleaned WAV (which splitAudio splits natively); on
    // any ffmpeg failure it returns the ORIGINAL buffer and the pipeline
    // proceeds exactly as with cleanup off — dataset prep never breaks on this.
    let prepared: Buffer = audioBuffer
    if (denoise) {
      prepared = await denoiseVocal(audioBuffer, '[prepare-dataset]')
    } else {
      console.log('[prepare-dataset] denoise disabled by user — using raw sample')
    }
    const clips = await splitAudio(prepared)
    console.log('[prepare-dataset] clips:', clips.length)

    // ── 6. Package into ZIP ──────────────────────────────────────────────────
    const zip = new JSZip()
    clips.forEach((clip, i) => {
      // train-rvc-model globs dataset/<rvc_name>/split_<i>.wav (0-indexed).
      const zipPath = `${DATASET_FOLDER}/${DATASET_NAME}/split_${i}.wav`
      zip.file(zipPath, clip)
    })

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
    console.log('[prepare-dataset] zip size:', zipBuffer.length, 'bytes')

    // ── 7. Upload ZIP to Supabase storage (with retry) ───────────────────────
    // Stored alongside the original sample, keyed by voiceCloneId for easy lookup.
    // Large uploads can transiently fail with "fetch failed" if Supabase resets
    // the connection (e.g. HTTP/2 flood-control under load). Retry with backoff
    // so a single blip doesn't fail the whole run — but bail immediately on a
    // deterministic 4xx (mime/size) rejection, which retrying can't fix.
    const zipPath = `${user.id}/${voiceCloneId}-dataset.zip`
    const UPLOAD_BACKOFF_MS = [0, 5000, 15000] // attempt 1 immediate, then back off
    let uploadError: { message: string } | null = null

    for (let attempt = 0; attempt < UPLOAD_BACKOFF_MS.length; attempt++) {
      if (UPLOAD_BACKOFF_MS[attempt] > 0) {
        console.log(`[prepare-dataset] retrying ZIP upload (attempt ${attempt + 1}/${UPLOAD_BACKOFF_MS.length}) after ${UPLOAD_BACKOFF_MS[attempt]}ms`)
        await new Promise((r) => setTimeout(r, UPLOAD_BACKOFF_MS[attempt]))
      }

      const { error } = await supabaseAdmin.storage
        .from('voice-samples')
        .upload(zipPath, zipBuffer, { contentType: 'application/zip', upsert: true })

      if (!error) { uploadError = null; break }
      uploadError = error

      // Surface status + cause: a bare "fetch failed" often masks a real HTTP
      // rejection (415 mime, 413 size). Those are not worth retrying.
      const status = (error as { statusCode?: number | string }).statusCode
      const cause = (error as { cause?: { code?: string; message?: string } }).cause
      console.error(
        `[prepare-dataset] ZIP upload attempt ${attempt + 1} failed —`,
        'message:', error.message,
        '| statusCode:', status ?? 'n/a',
        '| cause:', cause?.code ?? cause?.message ?? 'none'
      )
      const code = Number(status)
      if (code >= 400 && code < 500) break // deterministic rejection — stop retrying
    }

    if (uploadError) {
      return NextResponse.json(
        { error: `ZIP upload failed: ${uploadError.message}` },
        { status: 500 }
      )
    }
    console.log('[prepare-dataset] ZIP uploaded to:', zipPath)

    // ── 8. Create a long-lived signed URL for the training job ────────────────
    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from('voice-samples')
      .createSignedUrl(zipPath, DATASET_URL_TTL)

    if (signError || !signed?.signedUrl) {
      console.error('[prepare-dataset] signed URL failed:', signError?.message)
      return NextResponse.json(
        { error: 'Could not generate signed URL for dataset ZIP' },
        { status: 500 }
      )
    }

    const datasetZipUrl = signed.signedUrl

    // ── 9. Persist the ZIP URL on the voice_clones row ───────────────────────
    const { error: updateError } = await supabaseAdmin
      .from('voice_clones')
      .update({ dataset_zip_url: datasetZipUrl })
      .eq('id', voiceCloneId)

    if (updateError) {
      console.error('[prepare-dataset] DB update failed:', updateError.message)
      return NextResponse.json(
        { error: `Database update failed: ${updateError.message}` },
        { status: 500 }
      )
    }

    console.log('[prepare-dataset] done — clips:', clips.length, 'zip bytes:', zipBuffer.length)
    return NextResponse.json({
      datasetZipUrl,
      clipCount: clips.length,
      zipBytes: zipBuffer.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[prepare-dataset] unhandled error:', msg)
    if (stack) console.error('[prepare-dataset] stack:', stack)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── Audio splitting ──────────────────────────────────────────────────────────

async function splitAudio(buffer: Buffer): Promise<Buffer[]> {
  if (isWav(buffer)) {
    return splitWav(buffer, CLIP_SECONDS, MIN_CLIP_SECONDS)
  }
  // Non-WAV audio (mp3/m4a/webm): convert to WAV with ffmpeg first, then run
  // the SAME splitter as native WAV uploads. These formats were previously
  // packaged as one giant clip, starving training of samples (weak clones).
  // Fallback: if conversion fails (bad file, missing binary on the platform),
  // degrade to the old single-clip packaging so dataset prep never breaks.
  try {
    const wav = await convertToWav(buffer)
    console.log('[prepare-dataset] non-WAV audio converted to WAV for splitting')
    return splitWav(wav, CLIP_SECONDS, MIN_CLIP_SECONDS)
  } catch (err) {
    console.error(
      '[prepare-dataset] ffmpeg conversion FAILED — falling back to single clip (training will be starved):',
      err instanceof Error ? err.message : String(err)
    )
    return [buffer]
  }
}

// Decode any ffmpeg-supported input (mp3/m4a/webm/…) to 16-bit PCM WAV,
// mono 44.1 kHz — a clean, standard training input (the RVC pipeline resamples
// anyway, and voice recordings are effectively mono). Uses temp files rather
// than pipes because m4a (mp4 container) can't reliably stream via stdin.
async function convertToWav(input: Buffer): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg binary not available on this platform')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvox-dataset-'))
  const inFile = path.join(dir, 'input')
  const outFile = path.join(dir, 'output.wav')
  try {
    await fs.writeFile(inFile, input)
    // -bitexact keeps the WAV header minimal (fmt chunk at the standard offset
    // splitWav reads from); -v error surfaces real failures in the log.
    await execFileAsync(ffmpegPath, [
      '-v', 'error', '-y',
      '-i', inFile,
      '-ac', '1',
      '-ar', '44100',
      '-c:a', 'pcm_s16le',
      '-bitexact',
      outFile,
    ])
    return await fs.readFile(outFile)
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// WAV magic: "RIFF" at offset 0, "WAVE" at offset 8
function isWav(buf: Buffer): boolean {
  return (
    buf.length > 44 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WAVE'
  )
}

function splitWav(buf: Buffer, clipSeconds: number, minSeconds: number): Buffer[] {
  // Find the 'data' chunk by scanning chunk IDs. The header is not always
  // exactly 44 bytes — optional chunks (LIST, JUNK, etc.) can push data further.
  let scanPos = 12 // start after "RIFF<size>WAVE"
  let dataOffset = -1
  let dataSize = 0

  while (scanPos + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', scanPos, scanPos + 4)
    const chunkSize = buf.readUInt32LE(scanPos + 4)
    if (chunkId === 'data') {
      dataOffset = scanPos + 8
      dataSize = Math.min(chunkSize, buf.length - dataOffset)
      break
    }
    // Chunks must be even-byte aligned
    scanPos += 8 + chunkSize + (chunkSize % 2)
  }

  if (dataOffset === -1) {
    console.warn('[prepare-dataset] WAV data chunk not found — packaging as single clip')
    return [buf]
  }

  // Read format fields from the 'fmt ' chunk (standard PCM: always at offset 20)
  const numChannels = buf.readUInt16LE(22)
  const sampleRate = buf.readUInt32LE(24)
  const bitsPerSample = buf.readUInt16LE(34)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const bytesPerSecond = sampleRate * blockAlign
  const bytesPerClip = Math.floor(clipSeconds * bytesPerSecond)
  const minBytes = Math.floor(minSeconds * bytesPerSecond)

  // The header template: everything before the 'data' chunk
  const headerTemplate = buf.slice(0, dataOffset - 8) // exclude "data<size>"

  const audioData = buf.slice(dataOffset, dataOffset + dataSize)
  const clips: Buffer[] = []
  let offset = 0

  while (offset < audioData.length) {
    const rawClip = audioData.slice(offset, offset + bytesPerClip)
    // Align to block boundary so we don't cut mid-sample
    const alignedLength = Math.floor(rawClip.length / blockAlign) * blockAlign
    if (alignedLength === 0) break

    const clipData = rawClip.slice(0, alignedLength)
    clips.push(buildWav(headerTemplate, clipData))
    offset += bytesPerClip
  }

  // Drop trailing clip if it's below the minimum duration threshold
  if (clips.length > 1) {
    const lastClipDataLen = audioData.length - (clips.length - 1) * bytesPerClip
    if (lastClipDataLen < minBytes) {
      clips.pop()
    }
  }

  return clips.length > 0 ? clips : [buf]
}

// Rebuild a valid WAV file from a header template and new PCM data.
// Updates the RIFF chunk size and the data chunk size in place.
function buildWav(header: Buffer, pcmData: Buffer): Buffer {
  // Clone the header so we don't mutate the template
  const hdr = Buffer.from(header)

  // "data" chunk identifier + 4-byte size
  const dataHeader = Buffer.allocUnsafe(8)
  dataHeader.write('data', 0, 'ascii')
  dataHeader.writeUInt32LE(pcmData.length, 4)

  // RIFF chunk size = total file size - 8 ("RIFF" + size field itself)
  const riffSize = hdr.length - 8 + dataHeader.length + pcmData.length
  hdr.writeUInt32LE(riffSize, 4)

  return Buffer.concat([hdr, dataHeader, pcmData])
}
