import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

// Publish / unpublish a trained voice to the free community Voice Library.
//
// POST { voiceId, publish: true, consent: true, bio? }  → publish
// POST { voiceId, publish: false }                      → unpublish
//
// Publishing requires the consent checkbox server-side too (never trust the
// UI alone): library_consent_at records when consent was given and is KEPT
// on unpublish as the audit record of the consent event. Only ready voices
// with a stored model can be published — an unusable library entry would be
// a dead control. Ownership is enforced here in app code (service-role
// client + explicit user_id check, the voice_swaps pattern).
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_BIO_CHARS = 200

export async function POST(req: NextRequest) {
  try {
    if (!adminConfigured) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    let body: { voiceId?: string; publish?: boolean; consent?: boolean; bio?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { voiceId, publish } = body
    if (!voiceId || !UUID_RE.test(voiceId) || typeof publish !== 'boolean') {
      return NextResponse.json({ error: 'voiceId and publish are required' }, { status: 400 })
    }

    const { data: clone, error: cloneErr } = await supabaseAdmin
      .from('voice_clones')
      .select('id, user_id, status, model_path, model_url')
      .eq('id', voiceId)
      .single()
    if (cloneErr || !clone) {
      return NextResponse.json({ error: 'Voice not found' }, { status: 404 })
    }
    if (clone.user_id !== user.id) {
      return NextResponse.json({ error: 'You can only publish your own voices' }, { status: 403 })
    }

    let update: Record<string, unknown>
    if (publish) {
      if (body.consent !== true) {
        return NextResponse.json(
          { error: 'Publishing requires confirming you own this voice or have the rights to share it' },
          { status: 400 }
        )
      }
      if (clone.status !== 'ready' || (!clone.model_path && !clone.model_url)) {
        return NextResponse.json(
          { error: 'Only trained, ready voices can be published' },
          { status: 409 }
        )
      }
      const now = new Date().toISOString()
      update = {
        published: true,
        published_at: now,
        library_consent_at: now,
        library_bio: (body.bio ?? '').trim().slice(0, MAX_BIO_CHARS) || null,
      }
    } else {
      // Visibility off; library_consent_at stays as the consent audit record.
      update = { published: false }
    }

    const { error: updateErr } = await supabaseAdmin
      .from('voice_clones')
      .update(update)
      .eq('id', voiceId)
    if (updateErr) {
      if (/published|library_/.test(updateErr.message)) {
        return NextResponse.json(
          { error: 'The Voice Library isn’t enabled on this environment yet (migration 20260713000000 pending)' },
          { status: 503 }
        )
      }
      console.error('[library/publish] update failed:', updateErr.message)
      return NextResponse.json({ error: `Could not update the voice: ${updateErr.message}` }, { status: 500 })
    }

    console.log(`[library/publish] voice ${voiceId} ${publish ? 'published' : 'unpublished'} by ${user.id}`)
    return NextResponse.json({ ok: true, published: publish })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[library/publish] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
