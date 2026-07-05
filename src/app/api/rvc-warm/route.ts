import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { fireWarmPing, rvcEngine } from '@/lib/rvc-engine'

export const maxDuration = 15

// POST /api/rvc-warm
//
// Auth-gated, fire-and-forget pre-warm of the bare-RVC pool (PROJECT_STATUS
// §6). The client calls this when the Result screen mounts: a regenerate or
// fine-tune "Apply to Full Track" from there lands minutes later — past the
// pool's observed re-chill window (<7 min, 2026-07-05) — so the stem-split
// pings can't cover it. Each ping is a ~2-3s built-in-voice prediction
// (~$0.001); the rate limit keeps a stuck client from burning money.
//
// Always returns 200 with { warmed } — a failed warm-up must never surface as
// an error in the swap flow.
export async function POST(req: NextRequest) {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  if (rvcEngine() !== 'bare') {
    return NextResponse.json({ warmed: false, reason: 'cover engine — no pre-warm needed' })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rl = rateLimit(ip, 'rvc-warm', { max: 6, windowMs: 60_000 })
  if (!rl.allowed) {
    return NextResponse.json({ warmed: false, reason: 'rate limited' })
  }

  await fireWarmPing(new URL(req.url).origin, 'rvc-warm')
  return NextResponse.json({ warmed: true })
}
