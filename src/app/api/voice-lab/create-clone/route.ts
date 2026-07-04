import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

export const maxDuration = 15

// Called AFTER the client has PUT the audio file to Supabase Storage via the
// presigned URL from /api/voice-lab/presign. Creates the voice_clones row using
// the SERVICE ROLE client so RLS never blocks the insert.
export async function POST(req: NextRequest) {
  try {
    // ── 1. Verify the admin client has a real service-role key ───────────────
    // Without this key the insert would be treated as an anon request and fail
    // with "permission denied for table voice_clones".
    if (!adminConfigured) {
      console.error(
        '[voice-lab/create-clone] SUPABASE_SERVICE_ROLE_KEY is not configured. ' +
        'Go to Vercel → Project Settings → Environment Variables and add it, then redeploy.'
      )
      return NextResponse.json(
        { error: 'Server configuration error: service role key is missing. Contact support.' },
        { status: 500 }
      )
    }

    // ── 2. Authenticate the caller (anon client reads the session cookie) ─────
    console.log('[voice-lab/create-clone] handler entered')
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) {
      console.error('[voice-lab/create-clone] auth error:', authError.message)
      return NextResponse.json({ error: 'Auth error: ' + authError.message }, { status: 401 })
    }
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }
    console.log('[voice-lab/create-clone] user:', user.id)

    // ── 3. Parse and validate request body ───────────────────────────────────
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
    // Path must be scoped to this user to prevent ownership confusion
    if (!path || !path.startsWith(`${user.id}/`)) {
      console.error('[voice-lab/create-clone] path ownership check failed:', { path, userId: user.id })
      return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
    }

    // ── 4. Insert into voice_clones using the SERVICE ROLE client ─────────────
    // supabaseAdmin bypasses all RLS policies. user_id is set explicitly from
    // the verified session so the row is always owned by the correct user.
    // No stored sample_url: sample_path is the durable reference and a fresh
    // signed URL is minted on read via /api/voice-lab/sample-url. The old 24h
    // stored URL expired and caused "voice expired" on Voice Lab playback.
    const type = cloneType === 'studio' ? 'studio' : 'express'
    console.log('[voice-lab/create-clone] inserting voice_clone for user', user.id)

    // Both tiers start 'pending' and go through real training (express just
    // trains with fewer epochs — see /api/voice-lab/train). The old express
    // path that marked rows instantly 'ready' with no model produced voices
    // that couldn't actually convert anything.
    const { data: row, error: insertError } = await supabaseAdmin
      .from('voice_clones')
      .insert({
        user_id: user.id,
        name: name.trim(),
        type,
        status: 'pending',
        sample_path: path,
        created_at: new Date().toISOString(),
      })
      .select('id, name, type, status, model_url, sample_url, created_at')
      .single()

    if (insertError) {
      console.error(
        '[voice-lab/create-clone] INSERT FAILED — code:', insertError.code,
        '| message:', insertError.message,
        '| details:', insertError.details,
        '| hint:', insertError.hint
      )
      // Surface the real error (e.g. "permission denied", "column does not exist")
      // so the Vercel log makes the root cause immediately clear.
      return NextResponse.json(
        { error: `Database error (${insertError.code}): ${insertError.message}` },
        { status: 500 }
      )
    }

    console.log('[voice-lab/create-clone] created voice_clone id:', row?.id)
    return NextResponse.json({ voice: row })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error('[voice-lab/create-clone] unhandled error:', msg)
    if (stack) console.error('[voice-lab/create-clone] stack:', stack)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
