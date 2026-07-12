import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

export const maxDuration = 15

// GET /api/shared/<token>/audio — PUBLIC playable audio for a shared track
// (no auth). Sign-on-read proxy, mirroring /api/voice-swaps/[swapId]/[filename]:
// the durable result_path is looked up BY TOKEN from the DB on every request
// and signed fresh (1h TTL), then 307-redirected. The share link itself never
// expires while sharing is on — no signed URL is ever stored or handed out
// long-term (the known stale-signed-URL failure mode).
// Unknown/revoked/expired tokens → 404.

// No cookies/headers are read — force dynamic so every load re-signs and a
// revoke takes effect immediately.
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  if (!adminConfigured) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: swap } = await supabaseAdmin
    .from('voice_swaps')
    .select('result_path')
    .eq('share_token', token)
    .maybeSingle()

  if (!swap?.result_path) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from('voice-swaps')
    .createSignedUrl(swap.result_path, 3600)

  if (signErr || !signed?.signedUrl) {
    console.error('[shared audio] sign failed:', signErr?.message)
    return NextResponse.json({ error: 'Could not load audio' }, { status: 500 })
  }

  return NextResponse.redirect(signed.signedUrl, 307)
}
