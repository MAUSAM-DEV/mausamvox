import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

// MVSEP "Male/Female separation" — splits a vocals-only track into separate
// male and female vocal stems. We submit the vocal stem by URL (no file upload)
// and poll by job hash, mirroring /api/karaoke-split's create+poll shape.
//
// Confirmed params from a real job:
//   sep_type=57  -> MVSep Male/Female separation
//   add_opt1=2   -> MelRoformer (2025.01), the best checkpoint
//   add_opt2=0   -> direct from mixture (input is already vocals-only)
//   output_format=0 -> mp3 (320 kbps)
const MVSEP_CREATE_URL = 'https://mvsep.com/api/separation/create'
const MVSEP_GET_URL = 'https://mvsep.com/api/separation/get'
const SEP_TYPE = '57'
const ADD_OPT1 = '2'
const ADD_OPT2 = '0'
const OUTPUT_FORMAT = '0'

// Safe stringify: error/response objects may have circular refs.
function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

// Token lives in env only. Trim defends against a stray trailing space/newline.
function getToken(): string {
  return (process.env.MVSEP_API_TOKEN ?? '').trim()
}

// Starts a Male/Female split job. Returns immediately with the MVSEP job hash —
// MVSEP runs behind a queue, so the client polls GET below.
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

    const data = (json as { success?: boolean; data?: { hash?: string } } | null)
    const hash = data?.data?.hash

    if (!res.ok || !data?.success || !hash) {
      // Don't log the full body (can be large); surface a concise error.
      console.error(`[gender-split] create failed (http ${res.status})`)
      return NextResponse.json(
        { error: `MVSEP create failed: ${safeStringify((data as { data?: unknown } | null)?.data ?? json)}` },
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

// MVSEP file entry — we read ONLY type + url and ignore everything else
// (especially the large `peaks` waveform array, which we never log or store).
interface MvsepFile { type?: string; url?: string }

function pickStem(files: MvsepFile[], type: 'Male' | 'Female'): string {
  const f = files.find((x) => x?.type === type)
  return typeof f?.url === 'string' ? f.url : ''
}

// Polled by the client to check on a job started via POST above.
// Normalizes MVSEP status into starting/processing/succeeded/failed and, on
// success, maps the stems by f.type (NOT array order).
export async function GET(req: NextRequest) {
  try {
    const hash = req.nextUrl.searchParams.get('hash')
    if (!hash) {
      return NextResponse.json({ error: 'hash is required' }, { status: 400 })
    }

    const token = getToken()
    if (!token) {
      return NextResponse.json({ error: 'MVSEP API token not configured' }, { status: 500 })
    }

    const url = `${MVSEP_GET_URL}?${new URLSearchParams({ hash, api_token: token })}`
    const res = await fetch(url)

    let json: unknown = null
    try { json = await res.json() } catch { /* handled below */ }

    const payload = json as
      | { success?: boolean; status?: string; data?: { files?: MvsepFile[] } }
      | null

    if (!res.ok || !payload?.success) {
      return NextResponse.json({ status: 'failed', error: `MVSEP get failed (http ${res.status})` })
    }

    switch (payload.status) {
      case 'waiting':
      case 'processing':
      case 'distributing':
      case 'merging':
        return NextResponse.json({ status: 'processing' })

      case 'done': {
        const files = Array.isArray(payload.data?.files) ? payload.data!.files! : []
        const maleVocalsUrl = pickStem(files, 'Male')
        const femaleVocalsUrl = pickStem(files, 'Female')

        // Parse-miss: a 'done' job with neither stem means an unexpected shape —
        // report failed so the caller falls back to no gender split.
        if (!maleVocalsUrl && !femaleVocalsUrl) {
          return NextResponse.json({ status: 'failed', error: 'Could not parse male/female stems from output' })
        }

        return NextResponse.json({ status: 'succeeded', maleVocalsUrl, femaleVocalsUrl })
      }

      case 'failed':
        return NextResponse.json({ status: 'failed', error: 'MVSEP reported job failed' })

      default:
        return NextResponse.json({ status: 'failed', error: `Unexpected MVSEP status: ${String(payload.status)}` })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[gender-split] poll error:', msg)
    return NextResponse.json({ status: 'failed', error: msg })
  }
}
