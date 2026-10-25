import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { HD_FINISH_DEPLOYMENT, HD_SOULX_DEPLOYMENT } from '@/lib/hd-voice'
import { newEnginesFor } from '@/lib/new-engines'

// Speed (engine plan step 5, 2026-10-23) — new-engine accounts only (lib/new-engines.ts). While a song is in and
// Configure is open, the page calls this every 60 s next to /api/rvc-warm (which warms the
// voice engine): it wakes the finishing machine (CPU, cheap) and — only when the chosen
// engine is HD Voice and the page's 5-minute SoulX allowance per song isn't used up —
// SoulX's L40S (≈ $0.06 per minute it stays up). Each ping is a `warm` job that does no work.
// Always 200; a failed warm-up never touches a swap. Vercel logs: search "[engine] warm".
export const maxDuration = 15

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !newEnginesFor(user.email)) return NextResponse.json({ warmed: [] })
  if (!rateLimit(user.id, 'engine-warm', { max: 6, windowMs: 60_000 }).allowed) return NextResponse.json({ warmed: [], reason: 'rate limited' })
  let body: { soulx?: boolean } = {}
  try { body = await req.json() } catch { /* defaults */ }
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  const targets = [HD_FINISH_DEPLOYMENT, ...(body.soulx ? [HD_SOULX_DEPLOYMENT] : [])]
  const warmed: string[] = []
  await Promise.all(targets.map(async (d) => {
    try {
      const p = await replicate.deployments.predictions.create(d.owner, d.name, { input: { warm: true } })
      warmed.push(`${d.name} ${p.id}`)
    } catch (err) {
      console.warn(`[engine] warm ${d.name} failed (no effect on swaps):`, err instanceof Error ? err.message : String(err))
    }
  }))
  console.log(`[engine] warm: ${warmed.join(', ') || 'nothing'}`)
  return NextResponse.json({ warmed })
}
