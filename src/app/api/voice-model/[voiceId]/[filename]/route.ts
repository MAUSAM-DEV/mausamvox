import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

export const maxDuration = 15

// GET /api/voice-model/<voiceId>/<voiceId>-<modelPathHash>.zip
//
// Redirect proxy for the Replicate RVC model. The RVC container derives a
// local filename by splitting custom_rvc_model_download_url on '/' and
// taking the last segment — without stripping query strings. Supabase signed
// URLs end in "uuid.zip?token=<300+ char JWT>", blowing past the OS 255-char
// filename limit (Errno 36). We expose a clean short URL instead, then
// 307-redirect Replicate to the real signed URL. Replicate's Python HTTP
// client follows redirects transparently, so file bytes never flow through
// Vercel.
//
// The filename segment is ignored here (the signed URL comes from voiceId's
// model_path) but it is NOT arbitrary: the RVC container uses it as its model
// CACHE KEY, extracting the zip to a folder named after it and skipping the
// download when that folder already exists on a warm instance. voice-convert
// builds it as "<voiceId>-<sha1(model_path)[:8]>.zip" so each voice (and each
// retrain) gets its own cache entry — the old constant "model.zip" made warm
// instances silently reuse whichever voice's weights were cached first.
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
