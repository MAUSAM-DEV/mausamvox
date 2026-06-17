import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 15

const MIME_TO_EXT: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
}

// Returns a presigned Supabase Storage upload URL for the voice-samples bucket.
// The client PUTs the audio file directly to Supabase — this bypasses Vercel's
// 4.5 MB request body limit, which blocks large WAV uploads through the server.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const { contentType } = await req.json()
    const rawMime = (contentType || '').split(';')[0].trim()
    const mime = MIME_TO_EXT[rawMime] ? rawMime : 'audio/webm'
    const ext = MIME_TO_EXT[mime] ?? 'webm'
    const path = `${user.id}/${Date.now()}-sample.${ext}`

    const { data, error } = await supabaseAdmin.storage
      .from('voice-samples')
      .createSignedUploadUrl(path)

    if (error || !data) {
      console.error('[voice-lab/presign]', error?.message)
      return NextResponse.json({ error: error?.message ?? 'Could not create upload URL' }, { status: 500 })
    }

    return NextResponse.json({ uploadUrl: data.signedUrl, path, mime })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-lab/presign] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
