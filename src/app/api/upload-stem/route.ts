import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 30

// Returns a presigned upload URL + a presigned download URL so the browser
// can PUT the file directly to Supabase Storage without proxying bytes
// through this route.  Auth is still enforced via the session cookie.
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

    const { data: uploadData, error: uploadErr } = await supabaseAdmin.storage
      .from('audio-uploads')
      .createSignedUploadUrl(path)

    if (uploadErr || !uploadData?.signedUrl) {
      return NextResponse.json(
        { error: `Could not create upload URL: ${uploadErr?.message ?? 'unknown'}` },
        { status: 500 }
      )
    }

    // 6-hour signed download URL — long enough for the voice-swap session
    const { data: dlData, error: dlErr } = await supabaseAdmin.storage
      .from('audio-uploads')
      .createSignedUrl(path, 21600)

    if (dlErr || !dlData?.signedUrl) {
      return NextResponse.json(
        { error: `Could not create download URL: ${dlErr?.message ?? 'unknown'}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      uploadUrl: uploadData.signedUrl,
      downloadUrl: dlData.signedUrl,
      path,
      mime,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[upload-stem] unhandled error:', msg)
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
