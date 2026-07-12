import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

// GET /api/shared/<token> — PUBLIC metadata for a shared track (no auth).
// The token is the unguessable share_token (migration 20260712000002), never
// the swap's primary id — possession of a valid token IS the authorization.
// Returns only display fields; user ids and storage paths never leave here.
// Unknown, revoked, or expired (no stored audio) tokens all 404 identically
// so a prober can't distinguish "never existed" from "revoked".

// No cookies/headers are read, so Next would otherwise consider this route
// static — force dynamic so a revoke takes effect on the next load.
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
    .select('song_name, voice_used, created_at, result_path')
    .eq('share_token', token)
    .maybeSingle()

  if (!swap || !swap.result_path) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    songName: swap.song_name,
    voiceUsed: swap.voice_used,
    createdAt: swap.created_at,
  })
}
