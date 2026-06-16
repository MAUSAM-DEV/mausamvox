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
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    const form = await req.formData()
    const file = form.get('audio')
    const name = form.get('name')
    const cloneType = form.get('cloneType')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'audio file is required' }, { status: 400 })
    }
    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const mimeType = file.type || 'application/octet-stream'
    const ext = ALLOWED_TYPES[mimeType]
    if (!ext) {
      return NextResponse.json({ error: `Unsupported audio type: ${mimeType}` }, { status: 400 })
    }

    const type = cloneType === 'studio' ? 'studio' : 'express'
    const path = `${user.id}/${Date.now()}-sample.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await supabaseAdmin.storage
      .from('voice-samples')
      .upload(path, buffer, { contentType: mimeType, upsert: false })

    if (uploadError) {
      return NextResponse.json({ error: `Upload failed: ${uploadError.message}` }, { status: 500 })
    }

    const { data: row, error: insertError } = await supabaseAdmin
      .from('voice_clones')
      .insert({ user_id: user.id, name: name.trim(), type, status: 'pending', sample_path: path })
      .select('id, name, type, status, model_url, created_at')
      .single()

    if (insertError) {
      return NextResponse.json({ error: `Could not save voice: ${insertError.message}` }, { status: 500 })
    }

    return NextResponse.json({ voice: row })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-lab/upload-sample] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
