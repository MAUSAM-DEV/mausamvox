import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

// DELETE /api/voice-lab/delete-clone?id=<voiceCloneId>
// Removes the voice_clones row and its associated storage files.
// Storage cleanup is best-effort: failures are logged but never block the row delete.
export async function DELETE(req: NextRequest) {
  try {
    const voiceCloneId = req.nextUrl.searchParams.get('id')
    if (!voiceCloneId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    if (!adminConfigured) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    // Fetch storage paths before deleting the row. Filter by user_id so a user
    // can never delete another user's voice even with a guessed UUID.
    const { data: clone, error: fetchError } = await supabaseAdmin
      .from('voice_clones')
      .select('id, sample_path, model_path')
      .eq('id', voiceCloneId)
      .eq('user_id', user.id)
      .single()

    if (fetchError || !clone) {
      return NextResponse.json({ error: 'Voice not found' }, { status: 404 })
    }

    // Best-effort storage cleanup — log failures, never throw.
    if (clone.sample_path) {
      const { error: sampleErr } = await supabaseAdmin.storage
        .from('voice-samples')
        .remove([clone.sample_path])
      if (sampleErr) console.error('[delete-clone] voice-samples cleanup failed:', sampleErr.message)
    }

    if (clone.model_path) {
      const { error: modelErr } = await supabaseAdmin.storage
        .from('voice-models')
        .remove([clone.model_path])
      if (modelErr) console.error('[delete-clone] voice-models cleanup failed:', modelErr.message)
    }

    // Row delete is the authoritative step.
    const { error: deleteError } = await supabaseAdmin
      .from('voice_clones')
      .delete()
      .eq('id', voiceCloneId)
      .eq('user_id', user.id)

    if (deleteError) {
      console.error('[delete-clone] row delete failed:', deleteError.message)
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[delete-clone] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
