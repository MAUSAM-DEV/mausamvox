import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

export const maxDuration = 15

// GET /api/voice-swaps/<swapId>/result.mp3       → signs result_path
// GET /api/voice-swaps/<swapId>/instrumental.mp3 → signs instrumental_path
//
// Signed-URL proxy for persisted swap files. The `filename` segment picks
// WHICH stored path to sign (instrumental.mp3 = the music-only Performance
// Mode backing; anything else = the full result, so old player URLs keep
// working) — the actual storage path always comes from the DB row, never
// from the URL.
// Scoped to the authenticated user's own swaps (ownership enforced by the
// .eq('user_id', user.id) clause — not RLS, so service role doesn't bypass it).
//
// Pattern mirrors /api/voice-model/[voiceId]/[filename].
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ swapId: string; filename: string }> }
) {
  const { swapId, filename } = await params

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

  // select('*') keeps this tolerant of migration timing: naming
  // instrumental_path explicitly would 400 the WHOLE query (result.mp3
  // included) on a deploy that outruns migration 20260705000000.
  const { data: swap } = await supabaseAdmin
    .from('voice_swaps')
    .select('*')
    .eq('id', swapId)
    .eq('user_id', user.id)
    .maybeSingle()

  const wantsInstrumental = filename === 'instrumental.mp3'
  const path: string | null =
    (wantsInstrumental ? swap?.instrumental_path : swap?.result_path) ?? null

  if (!path) {
    return NextResponse.json(
      {
        error: wantsInstrumental
          ? 'No music-only backing is stored for this swap'
          : 'Swap result not found or not yet persisted',
      },
      { status: 404 }
    )
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from('voice-swaps')
    .createSignedUrl(path, 3600)

  if (signErr || !signed?.signedUrl) {
    console.error('[voice-swaps proxy] sign failed:', signErr?.message)
    return NextResponse.json({ error: 'Could not sign swap URL' }, { status: 500 })
  }

  return NextResponse.redirect(signed.signedUrl, 307)
}
