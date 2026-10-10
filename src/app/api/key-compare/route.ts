import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { rvcEngine, rvcVersion } from '@/lib/rvc-engine'
import { resolveVoiceModelUrl, rvcInput } from '@/lib/rvc-convert'
import { KEY_COMPARE_MAX, songTag } from '@/lib/key-compare-shared'

// Compare keys (Configure → Song Key): three short conversions of the same
// ~15 s chorus excerpt in three keys, so the user can hear which sounds most
// like them. FREE — about $0.01–0.02 of engine time — and limited to
// KEY_COMPARE_MAX comparisons per song per hour.
//
// No database: the limit counts this song's excerpts in the user's own upload
// folder (the client uploads one per comparison, named keycmp-<song hash>),
// plus an in-memory per-user backstop. Polling uses GET /api/voice-convert.
export const maxDuration = 30

const WINDOW_MS = 60 * 60 * 1000
const MAX_EXCERPT_BYTES = 8 * 1024 * 1024 // a 15 s 16-bit stereo WAV is ~2.6 MB

export async function POST(req: NextRequest) {
  try {
    if (!adminConfigured || !process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    let body: { excerptPath?: string; trackKey?: string; voiceId?: string; pitches?: number[]; autotune?: number }
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
    const { excerptPath, trackKey, voiceId, pitches, autotune = 0 } = body
    const own = (p?: string) => !!p && !p.includes('..') && p.startsWith(`${user.id}/`)
    if (!own(trackKey) || !own(excerptPath) || !voiceId) return NextResponse.json({ error: 'Missing song, excerpt or voice' }, { status: 400 })
    if (!Array.isArray(pitches) || pitches.length !== 3 || !pitches.every((p) => Number.isFinite(p))) {
      return NextResponse.json({ error: 'Three keys are required' }, { status: 400 })
    }
    const tag = songTag(trackKey!)
    if (!excerptPath!.includes(`keycmp-${tag}`)) return NextResponse.json({ error: 'Excerpt does not belong to this song' }, { status: 400 })

    // ── Limit: 3 per song per hour (excerpts in the user's folder), plus a
    // per-user backstop across songs in case the folder listing fails.
    const backstop = rateLimit(user.id, 'key-compare', { max: 12, windowMs: WINDOW_MS })
    if (!backstop.allowed) {
      return NextResponse.json({ error: 'limit', retryAfterSecs: backstop.retryAfterSecs }, { status: 429 })
    }
    // (Storage "search" only matches the START of a name, and uploads are
    // named <timestamp>-<file> — so list the newest files and filter here.)
    const { data: files } = await supabaseAdmin.storage.from('audio-uploads')
      .list(user.id, { limit: 200, sortBy: { column: 'created_at', order: 'desc' } })
    const since = Date.now() - WINDOW_MS
    const recent = (files ?? []).filter((f) => f.name.includes(`keycmp-${tag}`) && Date.parse(f.created_at ?? '') >= since)
    // Excerpts older than the window no longer count — tidy them away (best-effort).
    const stale = (files ?? []).filter((f) => f.name.includes('keycmp-') && Date.parse(f.created_at ?? '') < since).map((f) => `${user.id}/${f.name}`)
    if (stale.length) void supabaseAdmin.storage.from('audio-uploads').remove(stale)
    const mine = recent.find((f) => `${user.id}/${f.name}` === excerptPath)
    if (!mine) return NextResponse.json({ error: 'Excerpt not found — please try again' }, { status: 400 })
    // This request's excerpt is already uploaded: count the OTHER comparisons.
    // A refused try deletes its excerpt, so trying again doesn't push the wait back.
    const earlier = recent.filter((f) => f !== mine)
    if (earlier.length >= KEY_COMPARE_MAX) {
      await supabaseAdmin.storage.from('audio-uploads').remove([excerptPath!]).catch(() => {})
      const oldestCounted = Date.parse(earlier[KEY_COMPARE_MAX - 1].created_at ?? '') // newest-first list
      const retryAfterSecs = Number.isFinite(oldestCounted) ? Math.max(60, Math.ceil((oldestCounted + WINDOW_MS - Date.now()) / 1000)) : 3600
      return NextResponse.json({ error: 'limit', retryAfterSecs }, { status: 429 })
    }
    if ((mine.metadata?.size ?? 0) > MAX_EXCERPT_BYTES) return NextResponse.json({ error: 'Excerpt too long' }, { status: 400 })

    const modelUrl = await resolveVoiceModelUrl(voiceId, user.id, new URL(req.url).origin, 'key-compare')
    if (!modelUrl) return NextResponse.json({ error: 'No model available for this voice' }, { status: 400 })
    const { data: signed } = await supabaseAdmin.storage.from('audio-uploads').createSignedUrl(excerptPath!, 3600)
    if (!signed?.signedUrl) return NextResponse.json({ error: 'Could not read the excerpt' }, { status: 500 })

    // ── Three conversions; if one can't start, cancel the others.
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const engine = rvcEngine()
    const ids: string[] = []
    try {
      for (const p of pitches) {
        const prediction = await replicate.predictions.create({ version: rvcVersion(engine), input: rvcInput(engine, signed.signedUrl, modelUrl, p, autotune) })
        ids.push(prediction.id)
      }
    } catch (err) {
      await Promise.all(ids.map((id) => replicate.predictions.cancel(id).catch(() => {})))
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[key-compare] create failed:', msg)
      return NextResponse.json({ error: "The voice engine didn't start — please try again" }, { status: 502 })
    }
    console.log(`[key-compare] started ${ids.join(',')} (voice=${voiceId}, pitches=${pitches.join('/')}, ${earlier.length + 1}/${KEY_COMPARE_MAX} this hour)`)
    return NextResponse.json({ predictionIds: ids, remaining: KEY_COMPARE_MAX - earlier.length - 1 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[key-compare] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
