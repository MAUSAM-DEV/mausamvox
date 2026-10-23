import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { convertSample } from '@/lib/sample-convert'
import { downloadWithRetry, withTimeout } from '@/lib/storage-transfer'

export const maxDuration = 60

// Voice Lab upload of a recording the browser can't read (2026-10-23): iPhone Voice Memos
// "lossless" files are Apple Lossless (ALAC) in .m4a, which Chrome and Firefox can't decode —
// the panel saw 0:00. The browser stores the file as-is under <user>/incoming/ (presign
// `incoming`), then this route turns it into a lossless 16-bit mono WAV at its own sample rate
// (max 48 kHz) that every browser and every engine reads, stores it as the voice sample, deletes
// the original and returns the length + waveform for the panel.
//   POST { path } → { path, mime, durationSec, peaks, previewUrl }
// Vercel logs: search "[voice-lab/convert-sample]".

const BUCKET = 'voice-samples'
const BUCKET_LIMIT_BYTES = 50 * 1024 * 1024 // the voice-samples bucket's file size limit
const PREVIEW_URL_TTL = 60 * 60 // only for the panel's player right now — never stored
// Storage transfers can stall silently on Vercel (the first "Wife English" conversion hung until
// the 60 s kill, 2026-10-23): time-limited, the download retried once with a fresh link.
const DOWNLOAD_ATTEMPTS = 2
const DOWNLOAD_TIMEOUT_MS = 15_000
const UPLOAD_TIMEOUT_MS = 20_000
const STORAGE_BUSY_MSG = 'Our file storage didn’t respond in time — a temporary hiccup. Please choose the file again in a minute.'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!rateLimit(user.id, 'convert-sample', { max: 10, windowMs: 10 * 60_000 }).allowed) {
    return NextResponse.json({ error: 'Too many uploads — wait a few minutes and try again.' }, { status: 429 })
  }
  let body: { path?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  const incoming = body.path ?? ''
  if (!incoming.startsWith(`${user.id}/incoming/`) || incoming.includes('..')) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
  }

  const started = Date.now()
  try {
    let original: Buffer
    try {
      original = await downloadWithRetry(
        async () => (await supabaseAdmin.storage.from(BUCKET).createSignedUrl(incoming, 300)).data?.signedUrl ?? null,
        { attempts: DOWNLOAD_ATTEMPTS, timeoutMs: DOWNLOAD_TIMEOUT_MS, logTag: '[voice-lab/convert-sample]' },
      )
    } catch (err) {
      console.error('[voice-lab/convert-sample] download gave up:', err instanceof Error ? err.message : String(err))
      return NextResponse.json({ error: STORAGE_BUSY_MSG }, { status: 503 })
    }
    const c = await convertSample(original)
    if ('error' in c) {
      console.warn(`[voice-lab/convert-sample] ${incoming}: ${c.log}`)
      return NextResponse.json({ error: c.error }, { status: 422 })
    }
    const { wav, rate, durationSec, peaks, codec } = c
    if (wav.length > BUCKET_LIMIT_BYTES) {
      const maxMin = Math.floor(BUCKET_LIMIT_BYTES / 2 / rate / 60)
      return NextResponse.json({ error: `This recording is ${Math.round(durationSec / 60)} minutes long — the most we can take is ${maxMin} minutes. Trim it and try again.` }, { status: 413 })
    }

    const stored = `${user.id}/${Date.now()}-sample.wav`
    const { error: upErr } = await withTimeout(
      supabaseAdmin.storage.from(BUCKET).upload(stored, wav, { contentType: 'audio/wav', upsert: false }),
      UPLOAD_TIMEOUT_MS,
      'WAV upload',
    ).catch((err: Error) => ({ error: { message: err.message } }))
    if (upErr) {
      console.error('[voice-lab/convert-sample] upload failed:', upErr.message)
      return NextResponse.json({ error: STORAGE_BUSY_MSG }, { status: 503 })
    }
    const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(stored, PREVIEW_URL_TTL)
    console.log(`[voice-lab/convert-sample] ${codec} → WAV mono ${rate} Hz, ${durationSec.toFixed(1)} s, ${(wav.length / 1e6).toFixed(1)} MB in ${Date.now() - started} ms (${stored})`)
    return NextResponse.json({ path: stored, mime: 'audio/wav', durationSec, peaks, previewUrl: signed?.signedUrl ?? null })
  } finally {
    const { error } = await supabaseAdmin.storage.from(BUCKET).remove([incoming])
    if (error) console.warn('[voice-lab/convert-sample] could not delete the original:', error.message)
  }
}
