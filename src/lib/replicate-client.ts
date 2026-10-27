// One Replicate client for every server route (2026-10-27) — with a real backoff on
// "429 Too Many Requests" (and 5xx on reads), and friendly error text for the page.
//
// Why our own retry: replicate@1.4.0 retries a 429 up to 5 times, but its wait is skipped
// (lib/util.js: `Number.isInteger(delay)` is never true — the delay has random jitter), so all
// retries fire instantly into the same throttle. Seen live 2026-10-27: a swap start failed
// with the raw "Request to https://api.replicate.com/… failed with status 429 … less than
// $5.0 in credit" in the user's toast.
//
// replicateFetch waits Retry-After (capped) or 1 s → 2 s → 4 s, within RETRY_BUDGET_MS per
// request; the library's own instant retries of the same request share that budget, so one
// call never waits more than ~RETRY_BUDGET_MS (routes have 15–60 s limits).
import Replicate from 'replicate'

const RETRY_BUDGET_MS = 8_000
const MAX_WAIT_MS = 4_000
const deadlines = new Map<string, number>() // request key → when its retry budget runs out

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function replicateFetch(input: Request | string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (typeof input === 'string' ? 'GET' : input.method) ?? 'GET').toUpperCase()
  const url = typeof input === 'string' ? input : input.url
  const key = `${method} ${url} ${typeof init?.body === 'string' ? init.body.length : ''}`
  const now = Date.now()
  let deadline = deadlines.get(key)
  if (!deadline || deadline < now - 60_000) { deadline = now + RETRY_BUDGET_MS; deadlines.set(key, deadline) }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(input, init)
    const retryable = res.status === 429 || (method === 'GET' && res.status >= 500)
    if (!retryable) { if (res.ok) deadlines.delete(key); return res }
    const after = Number(res.headers.get('Retry-After'))
    const wait = Math.min(MAX_WAIT_MS, Number.isFinite(after) && after > 0 ? after * 1000 : 1000 * 2 ** attempt)
    if (Date.now() + wait > deadline) return res // budget used up — the caller gets the error
    console.warn(`[replicate] ${res.status} on ${method} ${url.replace(/\?.*/, '')} — retrying in ${wait} ms`)
    await sleep(wait)
  }
}

export function replicateClient(): Replicate {
  return new Replicate({ auth: process.env.REPLICATE_API_TOKEN, fetch: replicateFetch })
}

// Words a user may see for an engine failure; the raw error stays in the server log.
export function friendlyEngineError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  if (/\b429\b|too many requests|rate limit|throttl|less than \$?5/i.test(raw)) {
    return 'Our voice engine is very busy right now — please try again in a minute.'
  }
  if (/\b5\d\d\b|timed? ?out|ECONNRESET|fetch failed|network/i.test(raw)) {
    return 'The voice engine had a hiccup — please try again in a minute.'
  }
  return 'Something went wrong with the voice engine — please try again in a minute.'
}
