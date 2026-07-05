import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

const VOICE_SWAPS_BUCKET = 'voice-swaps'

// DELETE /api/voice-swaps/delete?id=<swapId>
// Removes the voice_swaps row and, if one exists, the persisted MP3 from storage.
export async function DELETE(req: NextRequest) {
  try {
    const swapId = req.nextUrl.searchParams.get('id')
    if (!swapId) {
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

    // Fetch the storage paths before deleting so we can clean up afterward.
    // user_id filter is the ownership gate — service role bypasses RLS but we
    // enforce ownership explicitly on every query. select('*') tolerates
    // migration timing on instrumental_path (see the proxy route).
    const { data: swapRow } = await supabaseAdmin
      .from('voice_swaps')
      .select('*')
      .eq('id', swapId)
      .eq('user_id', user.id)
      .maybeSingle()

    // Delete the DB row first. If this succeeds, the record is gone regardless
    // of what happens to storage, which avoids broken references in the UI.
    const { error: deleteError } = await supabaseAdmin
      .from('voice_swaps')
      .delete()
      .eq('id', swapId)
      .eq('user_id', user.id)

    if (deleteError) {
      console.error('[voice-swaps/delete] row delete failed:', deleteError.message)
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    // Best-effort: remove the persisted MP3(s) — the full mix and, when one was
    // stored, the music-only instrumental. Log on failure but don't error the
    // response — the row is already gone and the caller should treat it as success.
    const paths = [swapRow?.result_path, swapRow?.instrumental_path].filter(Boolean) as string[]
    if (paths.length > 0) {
      const { error: storageError } = await supabaseAdmin.storage
        .from(VOICE_SWAPS_BUCKET)
        .remove(paths)
      if (storageError) {
        console.error('[voice-swaps/delete] storage removal failed (row already deleted):', storageError.message)
      } else {
        console.log('[voice-swaps/delete] storage files removed:', paths.join(', '))
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-swaps/delete] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
