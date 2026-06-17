import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 60

const ALLOWED_TYPES: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
}

// Voice-samples bucket is private and has no storage.objects RLS policies,
// so uploads go through this route (service role bypasses RLS) instead of
// straight from the browser — auth is verified via the session cookie below.
export async function POST(req: NextRequest) {
  console.log('[voice-lab/upload-sample] handler entered')
  try {
    console.log('[voice-lab/upload-sample] creating supabase client')
    const supabase = await createClient()
    console.log('[voice-lab/upload-sample] getting user')
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }
    console.log('[voice-lab/upload-sample] user:', user.id)

    console.log('[voice-lab/upload-sample] parsing form data')
    const form = await req.formData()
    const file = form.get('audio')
    const name = form.get('name')
    const cloneType = form.get('cloneType')
    console.log('[voice-lab/upload-sample] file:', file instanceof File ? `${file.name} ${file.size}B ${file.type}` : typeof file, 'name:', name)

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'audio file is required' }, { status: 400 })
    }
    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    // Strip codec parameters so "audio/webm;codecs=opus" matches "audio/webm"
    const mimeType = (file.type || 'application/octet-stream').split(';')[0].trim()
    const ext = ALLOWED_TYPES[mimeType]
    if (!ext) {
      return NextResponse.json({ error: `Unsupported audio type: ${mimeType}` }, { status: 400 })
    }

    const type = cloneType === 'studio' ? 'studio' : 'express'
    const path = `${user.id}/${Date.now()}-sample.${ext}`
    console.log('[voice-lab/upload-sample] reading file buffer, size:', file.size)
    const buffer = Buffer.from(await file.arrayBuffer())
    console.log('[voice-lab/upload-sample] uploading to storage, path:', path)

    const { error: uploadError } = await supabaseAdmin.storage
      .from('voice-samples')
      .upload(path, buffer, { contentType: mimeType, upsert: false })

    if (uploadError) {
      console.error('[voice-lab/upload-sample] storage upload failed:', uploadError.message)
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 })
    }
    console.log('[voice-lab/upload-sample] upload ok, creating signed URL')

    // Generate a 24-hour signed URL for the sample (used for playback reference)
    const { data: signed } = await supabaseAdmin.storage
      .from('voice-samples')
      .createSignedUrl(path, 86400)
    const sampleUrl = signed?.signedUrl ?? null

    const { data: row, error: insertError } = await supabaseAdmin
      .from('voice_clones')
      .insert({
        user_id: user.id,
        name: name.trim(),
        type,
        status: 'ready',
        sample_path: path,
        ...(sampleUrl ? { sample_url: sampleUrl } : {}),
      })
      .select('id, name, type, status, model_url, created_at')
      .single()

    if (insertError) {
      console.error('[voice-lab/upload-sample] insert failed:', insertError.message)
      return NextResponse.json({ error: `Could not save voice: ${insertError.message}` }, { status: 500 })
    }

    console.log('[voice-lab/upload-sample] done, voice id:', row?.id)
    return NextResponse.json({ voice: row })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[voice-lab/upload-sample] unhandled error:', msg)
    if (stack) console.error('[voice-lab/upload-sample] stack:', stack)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
