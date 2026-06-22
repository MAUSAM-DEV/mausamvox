/**
 * Next.js instrumentation hook — runs once at server startup, before any
 * route handlers execute.
 *
 * Why: Node v26's built-in fetch (undici) negotiates HTTP/2 via ALPN with
 * Supabase's gateway, which then throttles the connection with
 * ENHANCE_YOUR_CALM (HTTP/2 flood protection). That surfaced as the recurring
 * "Auth error: fetch failed" and "ZIP upload failed: fetch failed".
 *
 * Fix: install a global undici dispatcher with allowH2:false so all
 * server-side fetches (Supabase, Replicate, etc.) use HTTP/1.1.
 */
export async function register() {
  // Only the Node.js server runtime has sockets / undici. Skip the Edge runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // webpackIgnore: true — prevents webpack from tracing undici into any bundle
  // (including the Edge Runtime bundle for middleware). The NEXT_RUNTIME guard
  // above means Edge never reaches this line at runtime anyway.
  const { Agent, setGlobalDispatcher } = await import(/* webpackIgnore: true */ 'undici')

  setGlobalDispatcher(
    new Agent({
      allowH2: false, // force HTTP/1.1 — avoids Supabase ENHANCE_YOUR_CALM
    })
  )

  console.log('[instrumentation] global undici dispatcher set (allowH2:false → HTTP/1.1)')
}
