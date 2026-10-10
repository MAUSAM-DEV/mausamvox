import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'

// "Recent — not saved" (2026-10-10): the user's most recent UNSAVED swap stays
// recoverable for 24 h. Everything else a Result screen needs is already in
// durable storage (stems, lead/backing); only the converted voice lives on
// Replicate (deleted ~1 h after the run). So when a conversion finishes the
// page POSTs here and the server copies that voice (WAV, ~26 MB for 4½ min)
// plus a small settings file into the private voice-swaps bucket:
//   <user>/unsaved/<prediction>.wav + .json
// One per user — a new one replaces the old. Saving deletes it (DELETE);
// anything older than 24 h is deleted on the next GET or POST. No database.
//
// POST   { predictionId, take }  → copy the voice + settings
// GET                            → { recent: { predictionId, take, voiceUrl, createdAt } | null }
// DELETE ?id=<predictionId>      → remove it
export const maxDuration = 60

const BUCKET = 'voice-swaps'
const KEEP_MS = 24 * 60 * 60 * 1000
const MAX_VOICE_BYTES = 80 * 1024 * 1024
const MAX_TAKE_CHARS = 20_000
const ID_RE = /^[a-z0-9]{8,64}$/

async function signedInUser() {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  return user
}

// Files in the user's unsaved folder; older than 24 h are removed (best-effort).
async function listFresh(userId: string) {
  const dir = `${userId}/unsaved`
  const { data } = await supabaseAdmin.storage.from(BUCKET).list(dir, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })
  const files = data ?? []
  const cutoff = Date.now() - KEEP_MS
  const stale = files.filter((f) => Date.parse(f.created_at ?? '') < cutoff).map((f) => `${dir}/${f.name}`)
  if (stale.length) await supabaseAdmin.storage.from(BUCKET).remove(stale)
  return files.filter((f) => !(Date.parse(f.created_at ?? '') < cutoff))
}

export async function POST(req: NextRequest) {
  if (!adminConfigured || !process.env.REPLICATE_API_TOKEN) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  const user = await signedInUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  if (!rateLimit(user.id, 'unsaved', { max: 40, windowMs: 60 * 60 * 1000 }).allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  let body: { predictionId?: string; take?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  const { predictionId, take } = body
  if (!predictionId || !ID_RE.test(predictionId)) return NextResponse.json({ error: 'Bad prediction id' }, { status: 400 })
  const takeJson = JSON.stringify(take ?? null)
  if (!take || typeof take !== 'object' || takeJson.length > MAX_TAKE_CHARS) return NextResponse.json({ error: 'Bad take' }, { status: 400 })

  try {
    const prediction = await new Replicate({ auth: process.env.REPLICATE_API_TOKEN }).predictions.get(predictionId)
    const out = prediction.output as unknown
    const voiceUrl = typeof out === 'string' ? out : ''
    if (prediction.status !== 'succeeded' || !voiceUrl) return NextResponse.json({ error: 'Conversion not finished' }, { status: 409 })
    const res = await fetch(voiceUrl)
    if (!res.ok) return NextResponse.json({ error: `Voice download failed (${res.status})` }, { status: 502 })
    const voice = Buffer.from(await res.arrayBuffer())
    if (voice.length > MAX_VOICE_BYTES) return NextResponse.json({ error: 'Voice too large' }, { status: 413 })

    const dir = `${user.id}/unsaved`
    const up = async (name: string, data: Buffer, contentType: string) =>
      (await supabaseAdmin.storage.from(BUCKET).upload(`${dir}/${name}`, data, { contentType, upsert: true })).error
    const err = (await up(`${predictionId}.wav`, voice, 'audio/wav')) ?? (await up(`${predictionId}.json`, Buffer.from(takeJson), 'application/json'))
    if (err) return NextResponse.json({ error: `Store failed: ${err.message}` }, { status: 502 })

    // Keep only this one.
    const others = (await listFresh(user.id)).filter((f) => !f.name.startsWith(`${predictionId}.`)).map((f) => `${dir}/${f.name}`)
    if (others.length) await supabaseAdmin.storage.from(BUCKET).remove(others)
    console.log(`[unsaved] kept ${predictionId} (${(voice.length / 1e6).toFixed(1)} MB)${others.length ? `, replaced ${others.length} file(s)` : ''}`)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[unsaved] store failed:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET() {
  if (!adminConfigured) return NextResponse.json({ recent: null })
  const user = await signedInUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  try {
    const files = await listFresh(user.id)
    const json = files.find((f) => f.name.endsWith('.json'))
    if (!json) return NextResponse.json({ recent: null })
    const predictionId = json.name.slice(0, -'.json'.length)
    if (!files.some((f) => f.name === `${predictionId}.wav`)) return NextResponse.json({ recent: null })
    const dir = `${user.id}/unsaved`
    const { data: blob } = await supabaseAdmin.storage.from(BUCKET).download(`${dir}/${json.name}`)
    const take = blob ? JSON.parse(await blob.text()) : null
    const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(`${dir}/${predictionId}.wav`, 3600)
    if (!take || !signed?.signedUrl) return NextResponse.json({ recent: null })
    return NextResponse.json({ recent: { predictionId, take, voiceUrl: signed.signedUrl, createdAt: json.created_at } })
  } catch (e) {
    console.error('[unsaved] read failed:', e instanceof Error ? e.message : String(e))
    return NextResponse.json({ recent: null })
  }
}

export async function DELETE(req: NextRequest) {
  const user = await signedInUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })
  const dir = `${user.id}/unsaved`
  await supabaseAdmin.storage.from(BUCKET).remove([`${dir}/${id}.wav`, `${dir}/${id}.json`])
  return NextResponse.json({ ok: true })
}
