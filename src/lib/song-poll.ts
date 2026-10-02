// Client-side polling for Song Studio's Replicate engines (acestep / minimax):
// resilient to transient failures and resumable across reloads.
//
// Production 2026-10-02: ONE status poll failed in the browser ("Failed to
// fetch" — the request never reached Vercel) and the old loop gave up, while
// the MiniMax job went on to SUCCEED 56 s later. Nothing polled again, so the
// song was never saved — and for a paying user the up-front charge would have
// stuck with no refund (refunds only run when the job FAILS). Now: transient
// failures retry with backoff, and the job id is kept in localStorage until
// the job truly ends, so reopening Song Studio resumes and saves the song.

export const POLL_INTERVAL_MS = 4000
export const POLL_CEILING_MS = 6 * 60 * 1000 // generation is ~30s-2min; 6 min is generous

const PENDING_KEY = 'mvox_song_pending'
const PENDING_MAX_AGE_MS = 60 * 60 * 1000 // Replicate keeps outputs ~1 h
export const MAX_POLL_FAILURES = 8 // consecutive; backoff 8s→15s cap ≈ 1.5 min of outage

// targetSeconds: MiniMax target length (null/absent = Auto). Sent on every
// poll so the server-side persist can trim an over-long song.
export type PendingSong = { predictionId: string; title: string; style: string; startedAt: number; targetSeconds?: number | null }

// Several jobs can be in flight ("Make 2 versions"), so storage holds a LIST
// keyed by predictionId. The pre-list format (one object) is still read.
function readAll(): PendingSong[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as PendingSong | PendingSong[]
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}
function writeAll(list: PendingSong[]) {
  try {
    if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list))
    else localStorage.removeItem(PENDING_KEY)
  } catch { /* private mode etc. */ }
}
export function savePending(p: PendingSong) {
  writeAll([...readAll().filter((x) => x.predictionId !== p.predictionId), p])
}
// One job (by id), or all of them when no id is given.
export function clearPending(predictionId?: string) {
  writeAll(predictionId ? readAll().filter((x) => x.predictionId !== predictionId) : [])
}
// Still-resumable jobs (≤1 h old); expired/invalid entries are purged.
export function loadPending(): PendingSong[] {
  const all = readAll()
  const live = all.filter((p) => p?.predictionId && typeof p.startedAt === 'number' && Date.now() - p.startedAt <= PENDING_MAX_AGE_MS)
  if (live.length !== all.length) writeAll(live)
  return live
}

// fetch() rejects with a TypeError on network failure — "Failed to fetch"
// (Chrome), "Load failed" (Safari), "NetworkError…" (Firefox).
export const isNetworkError = (err: unknown) => err instanceof TypeError

// Thrown when the job may still be running server-side: the pending entry is
// KEPT so the next visit resumes it.
export class ResumableError extends Error {}
export const LOST_CONNECTION_MSG =
  'Lost connection while your song was generating — it’s still being made. ' +
  'Reopen Song Studio in a minute and it will pick up where it left off; the finished song is saved to Saved Tracks.'

type PollDeps = {
  fetchFn?: (url: string) => Promise<Response>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

export async function pollUntilDone(p: PendingSong, deps: PollDeps = {}): Promise<{ swapId: string; url: string }> {
  const fetchFn = deps.fetchFn ?? ((url: string) => fetch(url))
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = deps.now ?? Date.now

  const qs = new URLSearchParams({ id: p.predictionId, title: p.title, style: p.style })
  if (p.targetSeconds) qs.set('target', String(p.targetSeconds))
  const deadline = p.startedAt + POLL_CEILING_MS
  let failures = 0
  for (;;) {
    if (now() > deadline) {
      throw new ResumableError('This is taking longer than usual. Reopen Song Studio in a few minutes — if the song finished, it will be saved to Saved Tracks.')
    }
    await sleep(failures === 0 ? POLL_INTERVAL_MS : Math.min(15000, POLL_INTERVAL_MS * 2 ** failures))

    let res: Response
    try {
      res = await fetchFn(`/api/song-studio?${qs}`)
    } catch (err) {
      if (!isNetworkError(err)) throw err
      if (++failures >= MAX_POLL_FAILURES) throw new ResumableError(LOST_CONNECTION_MSG)
      continue
    }
    const poll = await res.json().catch(() => ({} as Record<string, unknown>))

    if (res.status === 401) {
      throw new ResumableError('You were signed out while your song was generating. Sign in again and reopen Song Studio — the song will be saved then.')
    }
    // 5xx / 429 / 408: transient (a 504 or a storage/download hiccup while
    // saving). The GET is idempotent, so retrying re-attempts the save.
    if (res.status >= 500 || res.status === 429 || res.status === 408) {
      if (++failures >= MAX_POLL_FAILURES) {
        throw new ResumableError(`Your song couldn’t be saved yet (${String(poll.error ?? `server error ${res.status}`)}). Reopen Song Studio in a minute to retry — you won’t be charged twice.`)
      }
      continue
    }
    if (!res.ok) throw new Error(String(poll.error ?? `Status check failed (${res.status})`))

    failures = 0
    if (poll.status === 'succeeded') return { swapId: String(poll.swapId), url: String(poll.url) }
    if (poll.status === 'failed' || poll.status === 'canceled') {
      // Server message first (e.g. "This song couldn't be created — try
      // changing the lyrics or style."), then the refund note.
      throw new Error(`${String(poll.error ?? 'The song couldn’t be generated.')}${poll.refunded ? ' Your credits were refunded.' : ''}`)
    }
    // starting / processing — keep polling
  }
}
