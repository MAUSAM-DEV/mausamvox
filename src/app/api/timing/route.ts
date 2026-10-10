import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'

// POST /api/timing — prints a browser `[timing]` line (src/lib/client-timing.ts)
// in the Vercel logs, so the Result screen's steps (mixing, mastering search,
// MP3 encoding, upload, save) can be read after a live test. Logs only: no
// database, no storage. Signed-in users only, rate-limited, numbers only.
export const maxDuration = 5

export async function POST(req: NextRequest) {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return new NextResponse(null, { status: 401 })
  if (!rateLimit(user.id, 'timing', { max: 60, windowMs: 60 * 60 * 1000 }).allowed) return new NextResponse(null, { status: 429 })

  let body: { stage?: unknown; fields?: unknown }
  try { body = await req.json() } catch { return new NextResponse(null, { status: 400 }) }
  const stage = typeof body.stage === 'string' && /^[a-z0-9-]{1,32}$/.test(body.stage) ? body.stage : null
  if (!stage || !body.fields || typeof body.fields !== 'object') return new NextResponse(null, { status: 400 })
  const parts = Object.entries(body.fields as Record<string, unknown>)
    .filter(([k, v]) => /^[a-zA-Z][a-zA-Z0-9]{0,23}$/.test(k) && typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e8)
    .slice(0, 16)
    .map(([k, v]) => `${k}=${Math.round(v as number)}`)
  console.log(`[timing] client stage=${stage} ${parts.join(' ')} user=${user.id.slice(0, 8)}`)
  return new NextResponse(null, { status: 204 })
}
