import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

// Voice Library preview — public, no auth (previews are part of browsing).
// 307-redirects to a FRESH signed URL for the published voice's sample on
// every read (the sign-on-read proxy pattern — never a stored signed URL).
// Only rows with published=true are served; everything else 404s identically
// so private voices can't be probed.
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const PREVIEW_TTL = 300 // played immediately; short exposure if the URL leaks

export async function GET(req: NextRequest) {
  try {
    if (!adminConfigured) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    const id = req.nextUrl.searchParams.get('id')
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid voice id' }, { status: 400 })
    }

    const { data: row, error } = await supabaseAdmin
      .from('voice_clones')
      .select('sample_path')
      .eq('id', id)
      .eq('published', true)
      .maybeSingle()
    // Missing published column (migration not applied) reads as not found.
    if (error || !row?.sample_path) {
      return NextResponse.json({ error: 'No preview available' }, { status: 404 })
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('voice-samples')
      .createSignedUrl(row.sample_path, PREVIEW_TTL)
    if (signErr || !signed?.signedUrl) {
      console.error('[library/preview] sign failed:', signErr?.message)
      return NextResponse.json({ error: 'Could not load the preview' }, { status: 500 })
    }
    return NextResponse.redirect(signed.signedUrl, 307)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[library/preview] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
