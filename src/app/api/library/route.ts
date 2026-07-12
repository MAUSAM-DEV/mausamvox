import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

// Voice Library — public browse endpoint (no auth: browsing is open, USING a
// voice stays behind login because /voice-swap is middleware-gated).
//
// GET /api/library           → all published voices, newest first
// GET /api/library?id=<uuid> → one published voice (the Voice Swap picker
//                              uses this to resolve a ?libVoice= param)
//
// Runs on the service-role client so no anon PostgREST grants are needed;
// only publish-safe fields are returned (never user_id, model paths or
// sample paths). Requires migration 20260713000000; until it's applied the
// published column doesn't exist — that error is answered as an empty
// library rather than a 500, so a deploy that outruns the migration shows
// an honest "no voices yet" instead of breaking the page.
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const PUBLIC_FIELDS = 'id, name, type, language, library_bio, published_at, sample_path'

type LibraryRow = {
  id: string
  name: string
  type: string
  language: string
  library_bio: string | null
  published_at: string | null
  sample_path: string | null
}

function toPublicVoice(r: LibraryRow) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    language: r.language,
    bio: r.library_bio,
    publishedAt: r.published_at,
    // The path itself stays server-side; the client only learns whether a
    // preview exists (played via /api/library/preview?id=).
    hasPreview: !!r.sample_path,
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!adminConfigured) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    const id = req.nextUrl.searchParams.get('id')
    if (id) {
      if (!UUID_RE.test(id)) {
        return NextResponse.json({ error: 'Invalid voice id' }, { status: 400 })
      }
      const { data: row, error } = await supabaseAdmin
        .from('voice_clones')
        .select(PUBLIC_FIELDS)
        .eq('id', id)
        .eq('published', true)
        .maybeSingle()
      if (error) {
        // Migration not applied yet → column doesn't exist → not published.
        if (/published/.test(error.message)) {
          return NextResponse.json({ error: 'Voice not found in the library' }, { status: 404 })
        }
        console.error('[library] single fetch failed:', error.message)
        return NextResponse.json({ error: 'Library lookup failed' }, { status: 500 })
      }
      if (!row) {
        return NextResponse.json({ error: 'Voice not found in the library' }, { status: 404 })
      }
      return NextResponse.json({ voice: toPublicVoice(row as LibraryRow) })
    }

    const { data: rows, error } = await supabaseAdmin
      .from('voice_clones')
      .select(PUBLIC_FIELDS)
      .eq('published', true)
      .eq('status', 'ready')
      .order('published_at', { ascending: false })
    if (error) {
      if (/published/.test(error.message)) {
        console.warn('[library] published column missing (migration 20260713000000 not applied) — returning empty library')
        return NextResponse.json({ voices: [] })
      }
      console.error('[library] list failed:', error.message)
      return NextResponse.json({ error: 'Library lookup failed' }, { status: 500 })
    }
    return NextResponse.json({ voices: (rows as LibraryRow[]).map(toPublicVoice) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[library] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
