import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 15

// Called AFTER the client has successfully PUT the file to Supabase Storage.
// Returns a 6-hour signed download URL for the given storage path.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    const { path } = await req.json()
    if (!path || typeof path !== 'string') {
      return NextResponse.json({ error: 'path is required' }, { status: 400 })
    }

    // Verify the path belongs to this user
    if (!path.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data, error } = await supabaseAdmin.storage
      .from('audio-uploads')
      .createSignedUrl(path, 21600) // 6-hour TTL

    if (error || !data?.signedUrl) {
      console.error('[upload-stem/sign] createSignedUrl failed:', error?.message, 'path:', path)
      return NextResponse.json(
        { error: `Could not create download URL: ${error?.message ?? 'unknown'}` },
        { status: 500 }
      )
    }

    return NextResponse.json({ url: data.signedUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[upload-stem/sign] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
