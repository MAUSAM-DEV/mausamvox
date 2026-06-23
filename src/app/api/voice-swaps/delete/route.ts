import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

// DELETE /api/voice-swaps/delete?id=<swapId>
// Removes a single voice_swaps row owned by the current user.
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

    // user_id filter ensures a user can never delete another user's row.
    const { error: deleteError } = await supabaseAdmin
      .from('voice_swaps')
      .delete()
      .eq('id', swapId)
      .eq('user_id', user.id)

    if (deleteError) {
      console.error('[voice-swaps/delete] row delete failed:', deleteError.message)
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-swaps/delete] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
