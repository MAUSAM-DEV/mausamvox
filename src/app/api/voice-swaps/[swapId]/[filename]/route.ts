import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

export const maxDuration = 15

// GET /api/voice-swaps/<swapId>/result.mp3
//
// Signed-URL proxy for persisted swap results. The `filename` segment exists
// only so the browser/player sees a clean filename in the URL — it is not
// validated against the stored path (the path comes from the DB row).
// Scoped to the authenticated user's own swaps (ownership enforced by the
// .eq('user_id', user.id) clause — not RLS, so service role doesn't bypass it).
//
// Pattern mirrors /api/voice-model/[voiceId]/[filename].
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ swapId: string }> }
) {
  const { swapId } = await params

  if (!adminConfigured) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(swapId)) {
    return NextResponse.json({ error: 'Invalid swap ID' }, { status: 400 })
  }

  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  const { data: swap } = await supabaseAdmin
    .from('voice_swaps')
    .select('result_path')
    .eq('id', swapId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!swap?.result_path) {
    return NextResponse.json({ error: 'Swap result not found or not yet persisted' }, { status: 404 })
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from('voice-swaps')
    .createSignedUrl(swap.result_path, 3600)

  if (signErr || !signed?.signedUrl) {
    console.error('[voice-swaps proxy] sign failed:', signErr?.message)
    return NextResponse.json({ error: 'Could not sign swap URL' }, { status: 500 })
  }

  return NextResponse.redirect(signed.signedUrl, 307)
}
