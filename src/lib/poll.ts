// Waiting on background work (splits, conversions, transcriptions) without
// giving up on ONE bad answer. 2026-10-09: a single failed status check ended
// the lead/backing split's wait; the split finished two minutes later unseen
// and the swap silently used a worse input. Rules for every wait in the app:
//   • a dropped connection or a 5xx/429/408 reply is retried — only
//     MAX_POLL_ERRORS of them IN A ROW count as lost contact;
//   • only the job itself saying "failed", or the overall time limit, ends it;
//   • the caller shows the user what happened (never a silent fallback).

export const MAX_POLL_ERRORS = 12

export class PollError extends Error {}

export type PollStep<R> = { done: R } | { failed: string } | 'wait'

const transientStatus = (s: number) => s >= 500 || s === 429 || s === 408

// fetch that retries a dropped connection or a transient server reply
// (with backoff). Other HTTP errors are returned to the caller as-is.
export async function fetchRetry(url: string, init?: RequestInit, tries = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, init)
      if (!transientStatus(res.status) || i >= tries - 1) return res
    } catch (err) {
      if (i >= tries - 1) throw err
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
  }
}

// Polls `url()` every `intervalMs` until `read` says done/failed. `read` gets
// the parsed JSON (also for a non-OK reply that isn't transient — e.g. a route
// answering 502 with { status: 'failed' }). Resolves with the result, or with
// null if `cancelled()` turns true; throws PollError with a plain message.
export async function pollUntil<R, T = Record<string, unknown>>(opts: {
  url: () => string
  intervalMs: number
  maxWaitMs: number
  read: (data: T, ok: boolean) => PollStep<R>
  cancelled?: () => boolean
  what?: string // e.g. "the stem split" — used in messages
}): Promise<R | null> {
  const what = opts.what ?? 'the job'
  const started = Date.now()
  let errors = 0
  while (Date.now() - started < opts.maxWaitMs) {
    await new Promise((r) => setTimeout(r, opts.intervalMs))
    if (opts.cancelled?.()) return null
    let data: T, ok: boolean
    try {
      const res = await fetch(opts.url())
      if (transientStatus(res.status)) {
        // A transient reply may still carry a definite answer ({status:'failed'}).
        const body = await res.json().catch(() => null)
        if (!body || (body as Record<string, unknown>).status !== 'failed') throw new Error(`HTTP ${res.status}`)
        data = body as T
        ok = false
      } else {
        data = await res.json()
        ok = res.ok
      }
    } catch (err) {
      errors++
      console.warn(`[poll] ${what}: check ${errors}/${MAX_POLL_ERRORS} failed — retrying:`, err instanceof Error ? err.message : err)
      if (errors >= MAX_POLL_ERRORS) throw new PollError(`Lost contact while waiting for ${what} — check your connection and try again`)
      continue
    }
    errors = 0
    if (opts.cancelled?.()) return null
    const step = opts.read(data, ok)
    if (step === 'wait') continue
    if ('failed' in step) throw new PollError(step.failed)
    return step.done
  }
  throw new PollError(`${what[0].toUpperCase()}${what.slice(1)} took too long — please try again`)
}
