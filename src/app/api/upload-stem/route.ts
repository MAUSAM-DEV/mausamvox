import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 60

// Uploads a single stem file to audio-uploads using the service-role client so
// RLS on storage.objects never blocks the request.  Auth is still enforced via
// the session cookie — unauthenticated calls get a 401 before any upload happens.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file field is required' }, { status: 400 })
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${user.id}/${Date.now()}-${safeName}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const contentType = file.type || guessMime(file.name)

    const { error: uploadError } = await supabaseAdmin.storage
      .from('audio-uploads')
      .upload(path, buffer, { contentType, upsert: false })

    if (uploadError) {
      return NextResponse.json(
        { error: `Upload failed: ${uploadError.message}` },
        { status: 500 }
      )
    }

    // 6-hour signed URL — long enough for the user to finish the voice-swap session
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('audio-uploads')
      .createSignedUrl(path, 21600)

    if (signErr || !signed?.signedUrl) {
      return NextResponse.json(
        { error: `Could not create signed URL: ${signErr?.message ?? 'unknown'}` },
        { status: 500 }
      )
    }

    return NextResponse.json({ path, url: signed.signedUrl })
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
