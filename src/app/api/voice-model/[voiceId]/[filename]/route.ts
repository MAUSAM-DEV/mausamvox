import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

export const maxDuration = 15

// GET /api/voice-model/<voiceId>/model.zip
//
// Redirect proxy for the Replicate RVC model. The RVC container derives a
// local filename by splitting custom_rvc_model_download_url on '/' and
// taking the last segment — without stripping query strings. Supabase signed
// URLs end in "uuid.zip?token=<300+ char JWT>", blowing past the OS 255-char
// filename limit (Errno 36). We expose a clean URL whose last segment is
// "model.zip", then 307-redirect Replicate to the real signed URL. Replicate's
// Python HTTP client follows redirects transparently, so file bytes never flow
// through Vercel.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ voiceId: string; filename: string }> }
) {
  const { voiceId } = await params

  if (!adminConfigured) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }

  // UUID format guard — prevents path-traversal or unexpected DB queries
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(voiceId)) {
    return NextResponse.json({ error: 'Invalid voice ID' }, { status: 400 })
  }

  const { data: clone } = await supabaseAdmin
    .from('voice_clones')
    .select('model_path')
    .eq('id', voiceId)
    .single()

  if (!clone?.model_path) {
    return NextResponse.json({ error: 'Model not found' }, { status: 404 })
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from('voice-models')
    .createSignedUrl(clone.model_path, 3600) // 1-hour TTL; Replicate fetches immediately

  if (signErr || !signed?.signedUrl) {
    console.error('[voice-model proxy] sign failed:', signErr?.message)
    return NextResponse.json({ error: 'Could not sign model URL' }, { status: 500 })
  }

  return NextResponse.redirect(signed.signedUrl, 307)
}
