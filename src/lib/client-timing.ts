// Browser-side `[timing]` lines (2026-10-10): logged to the console AND sent to
// /api/timing, which prints the same line in the Vercel logs — testing happens
// on the live site, so the console alone is never read. Grep Vercel logs for
// `[timing] client` to see where a swap's time went. Fire-and-forget: a failed
// send is ignored and never touches the swap.
export function clientTiming(stage: string, fields: Record<string, number>) {
  const clean: Record<string, number> = {}
  for (const [k, v] of Object.entries(fields)) if (Number.isFinite(v)) clean[k] = Math.round(v)
  console.log(`[timing] stage=${stage} ${Object.entries(clean).map(([k, v]) => `${k}=${v}`).join(' ')}`)
  try {
    const body = JSON.stringify({ stage, fields: clean })
    if (!navigator.sendBeacon?.('/api/timing', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/timing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {})
    }
  } catch { /* timing is best-effort */ }
}
