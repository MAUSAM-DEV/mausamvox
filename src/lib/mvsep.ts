// MVSEP API (mvsep.com) — create a separation, then poll it in two hops:
//   1. POST /separation/create            -> short hash
//   2. GET  /separation/get-remote?hash=.. -> on 'done', a LONG result hash
//   3. GET  /separation/get?hash=<long>    -> on 'done', data.files[]
// Same rules as api/gender-split (which predates this helper and keeps its
// own copy): "not ready yet" replies right after create are normal and only
// fail after a grace window. The token never leaves the server or the logs.

export const MVSEP_CREATE_URL = 'https://mvsep.com/api/separation/create'
const MVSEP_GET_REMOTE_URL = 'https://mvsep.com/api/separation/get-remote'
const MVSEP_GET_URL = 'https://mvsep.com/api/separation/get'

const IN_PROGRESS = new Set(['waiting', 'processing', 'distributing', 'merging'])
const TRANSIENT_STATUSES = new Set(['not_found', 'not-found', 'queued', 'pending'])
const TRANSIENT_MSG_FRAGMENTS = ['being downloaded', 'please wait', 'not ready', 'try again']

export interface MvsepFile { type?: string; url?: string; download?: string }
interface MvsepPayload {
  success?: boolean | string
  status?: string
  data?: { hash?: string; files?: MvsepFile[]; message?: string }
}

export function mvsepToken(): string {
  return (process.env.MVSEP_API_TOKEN ?? '').trim()
}

const isSuccess = (v: unknown) => v === true || v === 'true'
function isTransient(p: MvsepPayload | null): boolean {
  if (TRANSIENT_STATUSES.has(String(p?.status ?? '').toLowerCase())) return true
  const m = String(p?.data?.message ?? '').toLowerCase()
  return TRANSIENT_MSG_FRAGMENTS.some((f) => m.includes(f))
}
async function getJson(url: string): Promise<{ ok: boolean; json: MvsepPayload | null }> {
  const res = await fetch(url, { cache: 'no-store' })
  let json: unknown = null
  try { json = await res.json() } catch { /* handled by caller */ }
  return { ok: res.ok, json: json as MvsepPayload | null }
}

// Start a job on a remote file. Returns the short hash, or an error message.
export async function mvsepCreate(fields: Record<string, string>): Promise<{ hash: string } | { error: string }> {
  const token = mvsepToken()
  if (!token) return { error: 'MVSEP API token not configured' }
  const form = new FormData()
  form.append('api_token', token)
  form.append('remote_type', 'direct')
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  const res = await fetch(MVSEP_CREATE_URL, { method: 'POST', body: form })
  let json: MvsepPayload | null = null
  try { json = (await res.json()) as MvsepPayload } catch { /* below */ }
  const hash = json?.data?.hash
  if (!res.ok || !isSuccess(json?.success) || !hash) return { error: `MVSEP create: ${json?.data?.message ?? `http ${res.status}`}` }
  return { hash }
}

export type MvsepPoll =
  | { state: 'processing' }
  | { state: 'failed'; error: string }
  | { state: 'done'; files: MvsepFile[] }

// One poll of both hops. `elapsedMs` (since create) bounds "not ready" replies.
export async function mvsepPoll(createHash: string, elapsedMs: number, graceMs = 180_000): Promise<MvsepPoll> {
  const token = mvsepToken()
  if (!token) return { state: 'failed', error: 'MVSEP API token not configured' }
  const notReady = (hop: string, why: string): MvsepPoll =>
    elapsedMs <= graceMs ? { state: 'processing' } : { state: 'failed', error: `MVSEP ${hop}: still not ready (${why})` }

  const remote = await getJson(`${MVSEP_GET_REMOTE_URL}?${new URLSearchParams({ hash: createHash, api_token: token })}`)
  if (!remote.ok || !isSuccess(remote.json?.success)) {
    const why = remote.json?.data?.message ?? String(remote.json?.status ?? 'error')
    return remote.ok && isTransient(remote.json) ? notReady('get-remote', why) : { state: 'failed', error: `MVSEP get-remote: ${why}` }
  }
  if (IN_PROGRESS.has(remote.json?.status ?? '')) return { state: 'processing' }
  if (remote.json?.status !== 'done') {
    return isTransient(remote.json) ? notReady('get-remote', String(remote.json?.status)) : { state: 'failed', error: `MVSEP get-remote status: ${String(remote.json?.status)}` }
  }
  const longHash = remote.json?.data?.hash
  if (!longHash) return { state: 'failed', error: 'MVSEP get-remote: no result hash' }

  const result = await getJson(`${MVSEP_GET_URL}?${new URLSearchParams({ hash: longHash, api_token: token })}`)
  if (!result.ok || !isSuccess(result.json?.success)) {
    const why = result.json?.data?.message ?? String(result.json?.status ?? 'error')
    return result.ok && isTransient(result.json) ? notReady('get', why) : { state: 'failed', error: `MVSEP get: ${why}` }
  }
  if (IN_PROGRESS.has(result.json?.status ?? '')) return { state: 'processing' }
  if (result.json?.status === 'done') return { state: 'done', files: Array.isArray(result.json.data?.files) ? result.json.data!.files! : [] }
  return { state: 'failed', error: `Unexpected MVSEP status: ${String(result.json?.status)}` }
}

// File of a finished job whose type (or download name) contains `word`.
export function mvsepFile(files: MvsepFile[], word: string): string {
  const w = word.toLowerCase()
  const f = files.find((x) => String(x?.type ?? '').toLowerCase().includes(w)) ?? files.find((x) => String(x?.download ?? '').toLowerCase().includes(w))
  return typeof f?.url === 'string' ? f.url : ''
}
