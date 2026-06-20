import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// GET copies both stems into Supabase (2 downloads + 2 uploads) before
// returning, so allow more time than a pure status check.
export const maxDuration = 60

// MVSEP "Male/Female separation" — splits a vocals-only track into separate
// male and female vocal stems. We submit the vocal stem by URL and poll by job
// hash, mirroring /api/karaoke-split's create+poll shape.
//
// URL-submitted ("remote") jobs use a confirmed THREE-STAGE flow (verified live):
//   1. POST /separation/create (url)        -> returns a short create hash
//   2. GET  /separation/get-remote?hash=..  -> on 'done' yields a LONG result hash
//   3. GET  /separation/get?hash=<long>     -> on 'done' yields data.files[]
// The route's GET is stateless/polled, so it resolves hops 2+3 internally on
// each call using the short create hash the client holds.
//
// Confirmed params from a real job:
//   sep_type=57  -> MVSep Male/Female separation
//   add_opt1=2   -> MelRoformer (2025.01), the best checkpoint
//   add_opt2=0   -> direct from mixture (input is already vocals-only)
//   output_format=0 -> mp3 (320 kbps)
const MVSEP_CREATE_URL = 'https://mvsep.com/api/separation/create'
const MVSEP_GET_REMOTE_URL = 'https://mvsep.com/api/separation/get-remote'
const MVSEP_GET_URL = 'https://mvsep.com/api/separation/get'
const SEP_TYPE = '57'
const ADD_OPT1 = '2'
const ADD_OPT2 = '0'
const OUTPUT_FORMAT = '0'

// MVSEP statuses that mean "still working" — keep polling.
const IN_PROGRESS = new Set(['waiting', 'processing', 'distributing', 'merging'])

// MVSEP reports success as boolean true on get/get-remote but as the STRING
// "true" on create. Accept both; reject anything else.
function isSuccess(v: unknown): boolean {
  return v === true || v === 'true'
}

// Safe stringify: error/response objects may have circular refs.
function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

// Token lives in env only. Trim defends against a stray trailing space/newline.
function getToken(): string {
  return (process.env.MVSEP_API_TOKEN ?? '').trim()
}

// Shape of a MVSEP status/result payload (only the fields we read).
interface MvsepFile { type?: string; url?: string }
interface MvsepPayload {
  success?: boolean | string
  status?: string
  data?: { hash?: string; files?: MvsepFile[] }
}

// GET a MVSEP endpoint and parse JSON. Never logs the body (can contain a large
// `peaks` array). Returns ok=false / json=null on transport or parse failure.
async function fetchMvsep(url: string): Promise<{ ok: boolean; json: MvsepPayload | null }> {
  const res = await fetch(url)
  let json: unknown = null
  try { json = await res.json() } catch { /* parse failure handled by caller */ }
  return { ok: res.ok, json: (json as MvsepPayload | null) }
}

// We read ONLY type + url and ignore everything else (especially the large
// `peaks` waveform array, which we never log or store).
function pickStem(files: MvsepFile[], type: 'Male' | 'Female'): string {
  const f = files.find((x) => x?.type === type)
  return typeof f?.url === 'string' ? f.url : ''
}

// ── Supabase persistence ──────────────────────────────────────────────────
// MVSEP output URLs have no documented retention, so we copy both stems into
// the audio-uploads bucket (same upload + signed-URL pattern as upload-stem)
// and hand callers durable signed URLs instead of the ephemeral MVSEP ones.
const BUCKET = 'audio-uploads'
const SIGNED_URL_TTL = 21600 // 6 hours, matching upload-stem

// Returns a signed URL if the object already exists, else null. createSignedUrl
// errors for a missing object, so it doubles as an existence probe.
async function existingSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

// Download one MVSEP stem and upload it to Supabase; returns a signed URL.
async function persistStem(mvsepUrl: string, path: string): Promise<string> {
  const res = await fetch(mvsepUrl)
  if (!res.ok) throw new Error(`download failed (http ${res.status})`)
  const buffer = Buffer.from(await res.arrayBuffer())
  const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buffer, { contentType: 'audio/mpeg', upsert: true })
  if (up.error) throw new Error(`upload failed: ${up.error.message}`)
  const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
  if (signed.error || !signed.data?.signedUrl) throw new Error(`sign failed: ${signed.error?.message ?? 'unknown'}`)
  return signed.data.signedUrl
}

// Copy the mapped MVSEP stems into Supabase, returning durable signed URLs.
// Idempotent: if both already exist (a re-poll), reuse them with no re-download.
// Soft-fallback: on ANY failure, return the MVSEP URLs so the caller still gets
// a usable (if ephemeral) result rather than nothing. Keyed by the create hash;
// no userId folder yet (tier-gating is a later step).
async function persistStems(createHash: string, maleUrl: string, femaleUrl: string): Promise<{ male: string; female: string }> {
  const malePath = `gender-split/${createHash}-male.mp3`
  const femalePath = `gender-split/${createHash}-female.mp3`
  try {
    const [existMale, existFemale] = await Promise.all([
      maleUrl ? existingSignedUrl(malePath) : Promise.resolve(''),
      femaleUrl ? existingSignedUrl(femalePath) : Promise.resolve(''),
    ])
    // Reuse if every present stem is already persisted (idempotent re-poll).
    if ((!maleUrl || existMale) && (!femaleUrl || existFemale)) {
      console.log(`[gender-split] reused persisted stems (no re-download) for ${createHash}`)
      return { male: existMale || '', female: existFemale || '' }
    }
    const [male, female] = await Promise.all([
      maleUrl ? persistStem(maleUrl, malePath) : Promise.resolve(''),
      femaleUrl ? persistStem(femaleUrl, femalePath) : Promise.resolve(''),
    ])
    console.log(`[gender-split] persisted stems to Supabase for ${createHash}`)
    return { male, female }
  } catch (err) {
    console.error('[gender-split] persistence failed, returning MVSEP URLs:', err instanceof Error ? err.message : String(err))
    return { male: maleUrl, female: femaleUrl }
  }
}

// Starts a Male/Female split job. Returns immediately with the MVSEP create
// hash — MVSEP runs behind a queue, so the client polls GET below.
//
// This stage is ADDITIVE and OPTIONAL: callers must treat any failure as
// "no gender split — behave as today". This route never blocks the flow.
export async function POST(req: NextRequest) {
  try {
    let body: { vocalsUrl?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { vocalsUrl } = body
    if (!vocalsUrl) {
      return NextResponse.json({ error: 'vocalsUrl is required' }, { status: 400 })
    }

    const token = getToken()
    if (!token) {
      return NextResponse.json({ error: 'MVSEP API token not configured' }, { status: 500 })
    }

    // MVSEP create takes multipart form data. Provide the audio by URL.
    const form = new FormData()
    form.append('api_token', token)
    form.append('url', vocalsUrl)
    form.append('remote_type', 'direct')
    form.append('sep_type', SEP_TYPE)
    form.append('add_opt1', ADD_OPT1)
    form.append('add_opt2', ADD_OPT2)
    form.append('output_format', OUTPUT_FORMAT)

    const res = await fetch(MVSEP_CREATE_URL, { method: 'POST', body: form })

    let json: unknown = null
    try { json = await res.json() } catch { /* handled below */ }

    const data = json as MvsepPayload | null
    const hash = data?.data?.hash

    if (!res.ok || !isSuccess(data?.success) || !hash) {
      // Don't log the full body (can be large); surface a concise error.
      console.error(`[gender-split] create failed (http ${res.status})`)
      return NextResponse.json(
        { error: `MVSEP create failed: ${safeStringify(data?.data ?? json)}` },
        { status: 502 }
      )
    }

    console.log(`[gender-split] started job ${hash}`)
    return NextResponse.json({ hash, status: 'starting' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[gender-split] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Polled by the client with the create (short) hash. Resolves the two-hop chain
// on each call and normalizes into processing / succeeded / failed. On success
// maps the stems by f.type (NOT array order). Any failure at either hop returns
// failed/empty so the caller falls back to no gender split.
export async function GET(req: NextRequest) {
  try {
    const createHash = req.nextUrl.searchParams.get('hash')
    if (!createHash) {
      return NextResponse.json({ error: 'hash is required' }, { status: 400 })
    }

    const token = getToken()
    if (!token) {
      return NextResponse.json({ error: 'MVSEP API token not configured' }, { status: 500 })
    }

    // ── Hop 1: resolve the remote job → the long result hash ──────────────
    const remoteUrl = `${MVSEP_GET_REMOTE_URL}?${new URLSearchParams({ hash: createHash, api_token: token })}`
    const remote = await fetchMvsep(remoteUrl)

    if (!remote.ok || !isSuccess(remote.json?.success)) {
      return NextResponse.json({ status: 'failed', error: 'MVSEP get-remote failed' })
    }
    if (IN_PROGRESS.has(remote.json?.status ?? '')) {
      return NextResponse.json({ status: 'processing' })
    }
    if (remote.json?.status !== 'done') {
      return NextResponse.json({ status: 'failed', error: `MVSEP get-remote status: ${String(remote.json?.status)}` })
    }
    const longHash = remote.json?.data?.hash
    if (!longHash) {
      return NextResponse.json({ status: 'failed', error: 'get-remote done but no result hash' })
    }

    // ── Hop 2: poll the actual separation result ──────────────────────────
    const resultUrl = `${MVSEP_GET_URL}?${new URLSearchParams({ hash: longHash, api_token: token })}`
    const result = await fetchMvsep(resultUrl)

    if (!result.ok || !isSuccess(result.json?.success)) {
      return NextResponse.json({ status: 'failed', error: 'MVSEP get failed' })
    }
    if (IN_PROGRESS.has(result.json?.status ?? '')) {
      return NextResponse.json({ status: 'processing' })
    }
    if (result.json?.status === 'done') {
      const files = Array.isArray(result.json?.data?.files) ? result.json!.data!.files! : []
      const maleVocalsUrl = pickStem(files, 'Male')
      const femaleVocalsUrl = pickStem(files, 'Female')

      // Parse-miss: a 'done' job with neither stem means an unexpected shape —
      // report failed so the caller falls back to no gender split.
      if (!maleVocalsUrl && !femaleVocalsUrl) {
        return NextResponse.json({ status: 'failed', error: 'Could not parse male/female stems from output' })
      }

      // Copy to durable Supabase URLs (soft-fallback to MVSEP URLs on failure).
      const durable = await persistStems(createHash, maleVocalsUrl, femaleVocalsUrl)
      return NextResponse.json({ status: 'succeeded', maleVocalsUrl: durable.male, femaleVocalsUrl: durable.female })
    }

    return NextResponse.json({ status: 'failed', error: `Unexpected MVSEP status: ${String(result.json?.status)}` })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[gender-split] poll error:', msg)
    return NextResponse.json({ status: 'failed', error: msg })
  }
}
