import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 30

// Returns a presigned upload URL so the browser can PUT the file DIRECTLY
// to Supabase Storage without proxying bytes through this server.
// Auth is verified via the session cookie — unauthenticated calls get 401.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    const { filename, contentType } = await req.json()
    if (!filename || typeof filename !== 'string') {
      return NextResponse.json({ error: 'filename is required' }, { status: 400 })
    }

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${user.id}/${Date.now()}-${safeName}`
    const mime = contentType || guessMime(filename)

    const { data, error } = await supabaseAdmin.storage
      .from('audio-uploads')
      .createSignedUploadUrl(path)

    if (error || !data?.signedUrl) {
      console.error('[upload-stem/presign] createSignedUploadUrl failed:', error?.message)
      return NextResponse.json(
        { error: `Could not create upload URL: ${error?.message ?? 'unknown'}` },
        { status: 500 }
      )
    }

    return NextResponse.json({ uploadUrl: data.signedUrl, path, mime })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[upload-stem/presign] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'm4a') return 'audio/mp4'
  if (ext === 'wav') return 'audio/wav'
  return 'audio/mpeg'
}
