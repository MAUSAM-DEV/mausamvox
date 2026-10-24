import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminConfigured } from '@/lib/supabase/admin'
import { ADMIN_EMAILS } from '@/lib/admin'
import { chargeSwap } from '@/lib/swap-charges'
import { FULL_SWAP_CREDITS } from '@/lib/swap-prices'

// POST /api/voice-swaps/charge-preview — "Save to library" on a previewed take: the
// preview's voice becomes the full swap without a new conversion. Charged here, on the
// server (2026-10-24, engine rollout step 1): FULL_SWAP_CREDITS minus what that preview
// cost; a preview already saved costs nothing more. Must succeed before
// /api/voice-swaps/persist will save the preview (it checks the ledger).
// Body: { previewId } = the preview's delivered prediction id; trackKey for the log.
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let body: { previewId?: string; trackKey?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  const previewId = typeof body.previewId === 'string' ? body.previewId.slice(0, 200) : ''
  if (!previewId) return NextResponse.json({ error: 'previewId is required' }, { status: 400 })

  if (ADMIN_EMAILS.includes(user.email ?? '')) return NextResponse.json({ charged: 0 })

  const charge = await chargeSwap({ userId: user.id, kind: 'save', price: FULL_SWAP_CREDITS, trackKey: typeof body.trackKey === 'string' ? body.trackKey.slice(0, 500) : '', previewId })
  if (!charge.ok) {
    if (charge.insufficient) {
      return NextResponse.json({ error: `Not enough credits — saving this swap costs up to ${FULL_SWAP_CREDITS} credits and you have ${charge.creditsRemaining}. Top up to continue.`, creditsRemaining: charge.creditsRemaining }, { status: 402 })
    }
    if (charge.previewNotFound) return NextResponse.json({ error: "This preview can't be saved any more — run the full swap instead." }, { status: 404 })
    return NextResponse.json({ error: "Couldn't check your credits — please try again in a minute." }, { status: 500 })
  }
  return NextResponse.json({ charged: charge.charged, creditsRemaining: charge.creditsRemaining })
}
