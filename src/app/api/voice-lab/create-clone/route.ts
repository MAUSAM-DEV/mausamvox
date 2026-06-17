import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 15

// Called AFTER the client has PUT the audio file to Supabase Storage via the
// presigned URL from /api/voice-lab/presign. Creates the voice_clones row and
// returns a 24-hour signed URL for sample playback.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    const body = await req.json()
    const { name, cloneType, path, mime } = body as {
      name: string
      cloneType: string
      path: string
      mime: string
    }

    if (!name?.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (!path || !path.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
    }

    // Signed URL for sample playback (24-hour TTL)
    const { data: signed } = await supabaseAdmin.storage
      .from('voice-samples')
      .createSignedUrl(path, 86400)
    const sampleUrl = signed?.signedUrl ?? null

    const type = cloneType === 'studio' ? 'studio' : 'express'
    const { data: row, error: insertError } = await supabaseAdmin
      .from('voice_clones')
      .insert({
        user_id: user.id,
        name: name.trim(),
        type,
        // Express voices are immediately usable for voice-swap style transfer.
        // model_url is null until a full RVC training job completes (separate pipeline).
        status: 'ready',
        sample_path: path,
        ...(sampleUrl ? { sample_url: sampleUrl } : {}),
      })
      .select('id, name, type, status, model_url, sample_url, created_at')
      .single()

    if (insertError) {
      console.error('[voice-lab/create-clone] insert failed:', insertError.message)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    console.log('[voice-lab/create-clone] created voice_clone', row?.id, 'for user', user.id)
    return NextResponse.json({ voice: row })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[voice-lab/create-clone] unhandled error:', msg)
    if (stack) console.error('[voice-lab/create-clone] stack:', stack)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
