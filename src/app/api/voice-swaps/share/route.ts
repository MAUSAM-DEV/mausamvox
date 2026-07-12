import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

// POST /api/voice-swaps/share — toggle public sharing for one saved swap.
// Body: { swapId: string, enable: boolean }
//   enable=true  → returns the existing share token, or mints a new random
//                  UUID (idempotent: re-sharing an already-shared track keeps
//                  its link working rather than rotating it under the user).
//   enable=false → revoke: nulls the token, killing every distributed link.
//                  Sharing again later mints a NEW token by design.
//
// Session-authed; ownership enforced by the .eq('user_id', user.id) clause
// (voice_swaps pattern: admin client + app-code ownership check, no RLS).
// The service-role UPDATE is covered by migration 20260707000000; the
// share_token column itself is migration 20260712000002.
export async function POST(req: NextRequest) {
  if (!adminConfigured) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  let body: { swapId?: string; enable?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { swapId, enable } = body
  if (!swapId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(swapId)) {
    return NextResponse.json({ error: 'A valid swapId is required' }, { status: 400 })
  }
  if (typeof enable !== 'boolean') {
    return NextResponse.json({ error: 'enable (boolean) is required' }, { status: 400 })
  }

  // select('*') tolerates migration timing on share_token — naming it
  // explicitly would 400 the whole query on a deploy that outruns
  // migration 20260712000002 (same defense as the swap proxy route).
  const { data: swap } = await supabaseAdmin
    .from('voice_swaps')
    .select('*')
    .eq('id', swapId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!swap) {
    return NextResponse.json({ error: 'Swap not found' }, { status: 404 })
  }

  if (enable && !swap.result_path) {
    // Nothing playable is stored (expired / persist soft-fail) — a share link
    // would 404 immediately, so refuse honestly instead.
    return NextResponse.json({ error: 'This track has no stored audio to share' }, { status: 409 })
  }

  const newToken: string | null = enable ? (swap.share_token ?? crypto.randomUUID()) : null

  if (newToken !== (swap.share_token ?? null)) {
    const { error: updateError } = await supabaseAdmin
      .from('voice_swaps')
      .update({ share_token: newToken })
      .eq('id', swapId)
      .eq('user_id', user.id)

    if (updateError) {
      // Most likely cause pre-migration: column doesn't exist yet.
      console.error('[voice-swaps/share] update failed:', updateError.message)
      return NextResponse.json({ error: 'Could not update sharing — please try again' }, { status: 500 })
    }
  }

  console.log(`[voice-swaps/share] ${enable ? 'enabled' : 'revoked'} sharing for swap ${swapId}`)
  return NextResponse.json({ shareToken: newToken })
}
