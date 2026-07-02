import { NextRequest, NextResponse } from 'next/server'
import { ADMIN_EMAILS } from '@/lib/admin'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

// Gender-split is a PREMIUM feature. Cost is a placeholder — change here only.
const GENDER_SPLIT_COST = 250

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

// MVSEP "not ready yet" signals that must NOT be treated as fatal. Right after
// create, get-remote frequently returns success:false with a message like
// "Your audio file is being downloaded, please wait a while..." (MVSEP is still
// fetching the remote input we handed it), or a not_found/queued status before
// the job is registered. These resolve to a real status on a later poll, so we
// keep polling within a grace window rather than failing the whole duet split.
const TRANSIENT_STATUSES = new Set(['not_found', 'not-found', 'queued', 'pending'])
const TRANSIENT_MSG_FRAGMENTS = ['being downloaded', 'please wait', 'not ready', 'try again']
// How long to tolerate a transient "not ready" response before giving up. MVSEP
// input downloads are quick (a few MB), so this only bounds a genuinely stuck
// job; real separation work reports IN_PROGRESS and is unaffected by this cap.
const TRANSIENT_GRACE_MS = 180_000 // 3 min (client polls ~5 min overall)

// MVSEP reports success as boolean true on get/get-remote but as the STRING
// "true" on create. Accept both; reject anything else.
function isSuccess(v: unknown): boolean {
  return v === true || v === 'true'
}

// True when a (parsed) MVSEP payload is a transient "still getting ready"
// response rather than a real failure. Matched case-insensitively.
function isTransient(payload: MvsepPayload | null): boolean {
  const status = String(payload?.status ?? '').toLowerCase()
  if (TRANSIENT_STATUSES.has(status)) return true
  const message = String(payload?.data?.message ?? '').toLowerCase()
  return TRANSIENT_MSG_FRAGMENTS.some((f) => message.includes(f))
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
  // message: MVSEP's human-readable reason on a rejection (e.g. "File or File
  // Hash not found"). Present on failure payloads; read for error surfacing.
  data?: { hash?: string; files?: MvsepFile[]; message?: string }
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

// Copy the mapped MVSEP stems into Supabase, returning durable signed URLs
// plus their storage paths so callers (voice-convert, cache restore) can
// re-sign fresh URLs later. Idempotent: if both already exist (a re-poll),
// reuse them with no re-download. Soft-fallback: on ANY failure, return the
// MVSEP URLs with EMPTY paths so the caller still gets a usable (if ephemeral)
// result rather than nothing. Keyed by the create hash; no userId folder yet
// (tier-gating is a later step).
async function persistStems(
  createHash: string,
  maleUrl: string,
  femaleUrl: string,
): Promise<{ male: string; female: string; malePath: string; femalePath: string }> {
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
      return {
        male: existMale || '',
        female: existFemale || '',
        malePath: existMale ? malePath : '',
        femalePath: existFemale ? femalePath : '',
      }
    }
    const [male, female] = await Promise.all([
      maleUrl ? persistStem(maleUrl, malePath) : Promise.resolve(''),
      femaleUrl ? persistStem(femaleUrl, femalePath) : Promise.resolve(''),
    ])
    console.log(`[gender-split] persisted stems to Supabase for ${createHash}`)
    return { male, female, malePath: male ? malePath : '', femalePath: female ? femalePath : '' }
  } catch (err) {
    console.error('[gender-split] persistence failed, returning MVSEP URLs:', err instanceof Error ? err.message : String(err))
    return { male: maleUrl, female: femaleUrl, malePath: '', femalePath: '' }
  }
}

// Best-effort refund of GENDER_SPLIT_COST after a charge whose MVSEP job never
// started. Re-reads the CURRENT balance first (rather than the pre-debit value)
// so a concurrent legitimate top-up isn't clobbered. Never throws: a failed
// refund is logged but must not mask the original error to the caller.
async function refundCredits(userId: string): Promise<void> {
  try {
    const { data: current, error: readError } = await supabaseAdmin
      .from('users')
      .select('credits_remaining')
      .eq('id', userId)
      .single()
    if (readError || !current) {
      console.error('[gender-split] refund read failed:', readError?.message ?? 'user not found')
      return
    }
    const { error: refundError } = await supabaseAdmin
      .from('users')
      .update({ credits_remaining: current.credits_remaining + GENDER_SPLIT_COST })
      .eq('id', userId)
    if (refundError) {
      console.error('[gender-split] refund failed:', refundError.message)
    }
  } catch (err) {
    console.error('[gender-split] refund threw:', err instanceof Error ? err.message : String(err))
  }
}

// Starts a Male/Female split job. Returns immediately with the MVSEP create
// hash — MVSEP runs behind a queue, so the client polls GET below.
//
// This stage is ADDITIVE and OPTIONAL: callers must treat any failure as
// "no gender split — behave as today". This route never blocks the flow.
export async function POST(req: NextRequest) {
  // Set to the user's id once credits are debited, so the create-failure paths
  // and the outer catch can refund a charge whose job never started.
  let chargedUserId: string | null = null
  try {
    let body: { vocalsUrl?: string; vocalsPath?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { vocalsUrl, vocalsPath } = body
    if (!vocalsUrl) {
      return NextResponse.json({ error: 'vocalsUrl is required' }, { status: 400 })
    }

    // ── PREMIUM GATE ──────────────────────────────────────────────────────────
    // This is the app's first paid gate. Everything here runs SERVER-SIDE and the
    // user is derived from the verified session cookie — we never trust a userId
    // from the request body. Deduct happens BEFORE the MVSEP create so a free
    // user can't kick off paid work by racing; if the create then fails we refund
    // (see below) so a job that never ran is never charged.
    if (!adminConfigured) {
      console.error('[gender-split] SUPABASE_SERVICE_ROLE_KEY is not configured')
      return NextResponse.json(
        { error: 'Server configuration error: service role key is missing. Contact support.' },
        { status: 500 }
      )
    }

    // 1. Authenticate the caller from the session cookie (anon client).
    const sessionClient = await createClient()
    const { data: { user }, error: authError } = await sessionClient.auth.getUser()
    if (authError) {
      return NextResponse.json({ error: 'Auth error: ' + authError.message }, { status: 401 })
    }
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    // 2. Fetch plan + balance via the service-role client (bypasses RLS).
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('users')
      .select('plan, credits_remaining')
      .eq('id', user.id)
      .single()
    if (profileError || !profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Admin accounts skip all credit gates and the plan gate — treat as unlimited.
    const isAdmin = ADMIN_EMAILS.includes(user.email ?? '')

    if (!isAdmin) {
      // 3. Plan gate — premium tiers are starter | pro | studio; only 'free' is blocked.
      if (profile.plan === 'free') {
        return NextResponse.json({ error: 'Premium feature' }, { status: 403 })
      }

      // 4. Balance gate.
      if (profile.credits_remaining < GENDER_SPLIT_COST) {
        return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 })
      }

      // 5. Deduct BEFORE starting MVSEP work.
      // KNOWN LIMITATION: this read-then-write debit is not atomic, so concurrent
      // requests can race and over/under-spend. Mirrors /api/credits/deduct.
      // Future hardening: move to an atomic Postgres RPC (e.g. a `deduct_credits`
      // SECURITY DEFINER function) so the check-and-decrement is a single statement.
      const { error: debitError } = await supabaseAdmin
        .from('users')
        .update({ credits_remaining: profile.credits_remaining - GENDER_SPLIT_COST })
        .eq('id', user.id)
      if (debitError) {
        console.error('[gender-split] debit failed:', debitError.message)
        return NextResponse.json({ error: 'Failed to deduct credits' }, { status: 500 })
      }
      chargedUserId = user.id
    }
    // ──────────────────────────────────────────────────────────────────────────

    const token = getToken()
    if (!token) {
      if (chargedUserId) await refundCredits(chargedUserId)
      return NextResponse.json({ error: 'MVSEP API token not configured' }, { status: 500 })
    }

    // Re-sign the vocal stem from its durable Supabase path so MVSEP always
    // fetches a fresh URL. A stale client-cached vocalsUrl — the Demucs output
    // expires ~1h, and a duet split often runs well after that (cache restore,
    // manual "Split Duet") — is the main cause of intermittent duet-split
    // failures. Falls back to the supplied URL when no path is provided.
    let effectiveVocalsUrl = vocalsUrl
    if (vocalsPath && !vocalsPath.includes('..')) {
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .createSignedUrl(vocalsPath, SIGNED_URL_TTL)
      if (signErr || !signed?.signedUrl) {
        console.warn('[gender-split] vocalsPath re-sign failed, using supplied URL:', signErr?.message)
      } else {
        effectiveVocalsUrl = signed.signedUrl
      }
    }

    // MVSEP create takes multipart form data. Provide the audio by URL.
    const form = new FormData()
    form.append('api_token', token)
    form.append('url', effectiveVocalsUrl)
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
      // Job never started — refund the charge.
      if (chargedUserId) await refundCredits(chargedUserId)
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
    // If we already debited but the create threw before starting a job, refund.
    if (chargedUserId) await refundCredits(chargedUserId)
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

    // Elapsed-since-job-start (ms), sent by the client poll loop. Lets this
    // stateless route bound how long it tolerates MVSEP's transient "not ready"
    // responses before giving up, so a genuinely stuck job still fails.
    const elapsedMs = Number(req.nextUrl.searchParams.get('elapsedMs') ?? '0') || 0

    // Keep polling while within the grace window; fail with a clear reason once
    // the transient state has persisted past it.
    const transientOrFail = (hop: 'get-remote' | 'get', why: string) => {
      if (elapsedMs <= TRANSIENT_GRACE_MS) {
        console.log(`[gender-split] ${hop} not ready yet (${why}) — still processing, ${Math.round(elapsedMs / 1000)}s elapsed`)
        return NextResponse.json({ status: 'processing' })
      }
      console.error(`[gender-split] ${hop} still not ready after ${Math.round(TRANSIENT_GRACE_MS / 1000)}s grace (${why})`)
      return NextResponse.json({ status: 'failed', error: `MVSEP ${hop}: still not ready after ${Math.round(TRANSIENT_GRACE_MS / 1000)}s (${why})` })
    }

    // ── Hop 1: resolve the remote job → the long result hash ──────────────
    const remoteUrl = `${MVSEP_GET_REMOTE_URL}?${new URLSearchParams({ hash: createHash, api_token: token })}`
    const remote = await fetchMvsep(remoteUrl)

    if (!remote.ok || !isSuccess(remote.json?.success)) {
      // Surface the REAL MVSEP reason instead of a generic string: MVSEP returns
      // a status ('not_found' / 'error' / …) and a data.message we were discarding.
      const why = remote.json?.data?.message ?? String(remote.json?.status ?? `http ${remote.ok ? 200 : 'error'}`)
      // A transient "still downloading the input / job not registered yet" reply
      // isn't a failure — keep polling within the grace window.
      if (remote.ok && isTransient(remote.json)) return transientOrFail('get-remote', why)
      console.error(`[gender-split] get-remote rejected: status=${String(remote.json?.status)} message=${why}`)
      return NextResponse.json({ status: 'failed', error: `MVSEP get-remote: ${why}` })
    }
    if (IN_PROGRESS.has(remote.json?.status ?? '')) {
      return NextResponse.json({ status: 'processing' })
    }
    if (remote.json?.status !== 'done') {
      // success:true but a non-terminal status (e.g. not_found/queued before the
      // job registers) — also transient within the grace window.
      if (isTransient(remote.json)) return transientOrFail('get-remote', `status ${String(remote.json?.status)}`)
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
      // Surface the REAL MVSEP reason instead of a generic string (see get-remote).
      const why = result.json?.data?.message ?? String(result.json?.status ?? `http ${result.ok ? 200 : 'error'}`)
      // Same transient handling as hop 1 — the result hash can briefly report
      // "not ready" before the separation output is available.
      if (result.ok && isTransient(result.json)) return transientOrFail('get', why)
      console.error(`[gender-split] get rejected: status=${String(result.json?.status)} message=${why}`)
      return NextResponse.json({ status: 'failed', error: `MVSEP get: ${why}` })
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

      // TIMING (instrumentation only): MVSEP returns no queue/compute breakdown,
      // so the best signal is the client-supplied elapsedMs = wall-clock since
      // the job was created (queue + compute combined).
      const mvsepTotal = elapsedMs > 0 ? `${(elapsedMs / 1000).toFixed(1)}s` : 'n/a'
      console.log(`[gender-split] TIMING job=${createHash} mvsep-total(wall-clock)=${mvsepTotal} (MVSEP gives no cold-start/compute split)`)

      // Copy to durable Supabase URLs (soft-fallback to MVSEP URLs on failure).
      // Paths are '' on soft-fallback — the client only stores non-empty ones.
      const durable = await persistStems(createHash, maleVocalsUrl, femaleVocalsUrl)
      return NextResponse.json({
        status: 'succeeded',
        maleVocalsUrl: durable.male,
        femaleVocalsUrl: durable.female,
        maleVocalsPath: durable.malePath,
        femaleVocalsPath: durable.femalePath,
      })
    }

    return NextResponse.json({ status: 'failed', error: `Unexpected MVSEP status: ${String(result.json?.status)}` })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[gender-split] poll error:', msg)
    return NextResponse.json({ status: 'failed', error: msg })
  }
}
