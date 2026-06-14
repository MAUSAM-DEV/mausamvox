// In-memory sliding-window rate limiter.
// Works correctly within a single Node.js process (one Vercel function instance).
// For multi-region / multi-instance production traffic, swap the store for
// an Upstash Redis or Vercel KV backend — the interface stays the same.

interface RateWindow {
  count: number
  resetAt: number
}

const store = new Map<string, RateWindow>()

// Purge expired windows every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now()
  Array.from(store.entries()).forEach(([key, win]) => {
    if (win.resetAt < now) store.delete(key)
  })
}, 5 * 60 * 1000).unref?.()   // .unref() keeps the process from being kept alive by this timer

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSecs: number
}

export function rateLimit(
  ip: string,
  action: string,
  { max, windowMs }: { max: number; windowMs: number }
): RateLimitResult {
  const key = `${action}::${ip}`
  const now = Date.now()
  const win: RateWindow | undefined = store.get(key)

  if (!win || win.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: max - 1, retryAfterSecs: 0 }
  }

  if (win.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSecs: Math.ceil((win.resetAt - now) / 1000),
    }
  }

  win.count++
  return { allowed: true, remaining: max - win.count, retryAfterSecs: 0 }
}
