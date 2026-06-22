import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

// 1-hour TTL — long enough for a playback session, short enough to limit
// exposure if the URL leaks. We sign on every request so there's no stale URL
// stored anywhere; the voice-samples bucket remains private throughout.
const SAMPLE_URL_TTL = 60 * 60

// GET /api/voice-lab/sample-url?id=<voiceCloneId>
// Returns a fresh signed URL for the voice sample. Called by TestStep on mount
// to replace the 24-hour stored sample_url, which expires and breaks playback.
export async function GET(req: NextRequest) {
  try {
    const voiceCloneId = req.nextUrl.searchParams.get('id')
    if (!voiceCloneId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    if (!adminConfigured) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    const { data: clone, error: cloneError } = await supabaseAdmin
      .from('voice_clones')
      .select('sample_path')
      .eq('id', voiceCloneId)
      .eq('user_id', user.id)
      .single()

    if (cloneError || !clone?.sample_path) {
      return NextResponse.json({ error: 'No sample found' }, { status: 404 })
    }

    const { data: signed, error: signError } = await supabaseAdmin.storage
      .from('voice-samples')
      .createSignedUrl(clone.sample_path, SAMPLE_URL_TTL)

    if (signError || !signed?.signedUrl) {
      console.error('[voice-lab/sample-url] sign failed:', signError?.message)
      return NextResponse.json({ error: 'Could not sign sample URL' }, { status: 500 })
    }

    return NextResponse.json({ signedUrl: signed.signedUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-lab/sample-url] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
