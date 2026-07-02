import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { STEMS_BUCKET, STEM_URL_TTL } from '@/lib/stem-persist'

export const maxDuration = 15

// Batch re-sign of durable stem paths. Called by the client after restoring a
// cached stem session from localStorage: the stored signed URLs may be hours
// old (or expired), so we swap in fresh ones before any stem is fetched or fed
// to a swap. NEVER store expiring signed URLs — store paths, sign at use.
//
// Allowed path prefixes:
//   stems/…         — Demucs + karaoke stems (keyed by unguessable prediction id)
//   gender-split/…  — MVSEP male/female stems (keyed by unguessable job hash)
//   <user.id>/…     — the user's own uploads
// Anything else (including path traversal) is rejected per-path with null.
const MAX_PATHS = 16

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    let body: { paths?: unknown }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const paths = Array.isArray(body.paths) ? body.paths : null
    if (!paths || paths.length === 0 || paths.length > MAX_PATHS) {
      return NextResponse.json({ error: `paths must be a non-empty array (max ${MAX_PATHS})` }, { status: 400 })
    }

    const allowed = (p: unknown): p is string =>
      typeof p === 'string' &&
      !p.includes('..') &&
      (p.startsWith('stems/') || p.startsWith('gender-split/') || p.startsWith(`${user.id}/`))

    // Sign every valid path in parallel; a missing object or bad path maps to
    // null so the caller keeps its old URL for that stem (soft-fallback).
    const entries = await Promise.all(
      paths.map(async (p): Promise<[string, string | null]> => {
        if (!allowed(p)) return [String(p), null]
        const { data, error } = await supabaseAdmin.storage.from(STEMS_BUCKET).createSignedUrl(p, STEM_URL_TTL)
        if (error || !data?.signedUrl) {
          console.warn('[stems/refresh] sign failed for', p, error?.message)
          return [p, null]
        }
        return [p, data.signedUrl]
      }),
    )

    return NextResponse.json({ urls: Object.fromEntries(entries) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stems/refresh] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
