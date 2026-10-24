import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'
import { withTimeout } from '@/lib/storage-transfer'

// "Recent — not saved" (2026-10-10): the user's most recent UNSAVED swap stays
// recoverable for 24 h. Everything else a Result screen needs is already in
// durable storage (stems, lead/backing); only the converted voice lives on
// Replicate (deleted ~1 h after the run). So when a conversion finishes the
// page POSTs here and the server copies that voice (WAV, ~26 MB for 4½ min)
// plus a small settings file into the private voice-swaps bucket:
//   <user>/unsaved/<prediction>.wav + .json   (2-voice duets also <prediction>-2.wav, since 2026-10-24)
// One per user — a new one replaces the old. Saving deletes it (DELETE);
// anything older than 24 h is deleted on the next GET or POST. No database.
//
// POST   { predictionId, predictionId2?, take }  → copy the voice(s) + settings
// GET                            → { recent: { predictionId, take, voiceUrl, voiceUrl2?, createdAt } | null }
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

  let body: { predictionId?: string; predictionId2?: string; take?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  const { predictionId, predictionId2, take } = body
  if (!predictionId || !ID_RE.test(predictionId)) return NextResponse.json({ error: 'Bad prediction id' }, { status: 400 })
  if (predictionId2 !== undefined && !ID_RE.test(predictionId2)) return NextResponse.json({ error: 'Bad prediction id' }, { status: 400 })
  const takeJson = JSON.stringify(take ?? null)
  if (!take || typeof take !== 'object' || takeJson.length > MAX_TAKE_CHARS) return NextResponse.json({ error: 'Bad take' }, { status: 400 })

  try {
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    // The converted voice(s), from Replicate (deleted there ~1 h after the run)
    const fetchVoice = async (id: string): Promise<Buffer | NextResponse> => {
      const prediction = await replicate.predictions.get(id)
      const out = prediction.output as unknown
      const voiceUrl = typeof out === 'string' ? out : ''
      if (prediction.status !== 'succeeded' || !voiceUrl) return NextResponse.json({ error: 'Conversion not finished' }, { status: 409 })
      const res = await withTimeout(fetch(voiceUrl), 20_000, 'voice download')
      if (!res.ok) return NextResponse.json({ error: `Voice download failed (${res.status})` }, { status: 502 })
      const voice = Buffer.from(await res.arrayBuffer())
      if (voice.length > MAX_VOICE_BYTES) return NextResponse.json({ error: 'Voice too large' }, { status: 413 })
      return voice
    }
    const voices = await Promise.all([predictionId, ...(predictionId2 ? [predictionId2] : [])].map(fetchVoice))
    const bad = voices.find((v): v is NextResponse => !Buffer.isBuffer(v))
    if (bad) return bad
    const [voice, voice2] = voices as Buffer[]

    const dir = `${user.id}/unsaved`
    const up = async (name: string, data: Buffer, contentType: string) =>
      (await withTimeout(supabaseAdmin.storage.from(BUCKET).upload(`${dir}/${name}`, data, { contentType, upsert: true }), 25_000, 'upload')).error
    const errs = await Promise.all([
      up(`${predictionId}.wav`, voice, 'audio/wav'),
      ...(voice2 ? [up(`${predictionId}-2.wav`, voice2, 'audio/wav')] : []),
    ])
    const err = errs.find(Boolean) ?? (await up(`${predictionId}.json`, Buffer.from(takeJson), 'application/json'))
    if (err) return NextResponse.json({ error: `Store failed: ${err.message}` }, { status: 502 })

    // Keep only this one (its .wav, -2.wav and .json).
    const others = (await listFresh(user.id)).filter((f) => !f.name.startsWith(predictionId)).map((f) => `${dir}/${f.name}`)
    if (others.length) await supabaseAdmin.storage.from(BUCKET).remove(others)
    console.log(`[unsaved] kept ${predictionId}${voice2 ? ` + ${predictionId2} (duet)` : ''} (${((voice.length + (voice2?.length ?? 0)) / 1e6).toFixed(1)} MB)${others.length ? `, replaced ${others.length} file(s)` : ''}`)
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
    // signed now, for this page visit only (the page downloads the voice at once when the take is opened)
    const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(`${dir}/${predictionId}.wav`, 3600)
    if (!take || !signed?.signedUrl) return NextResponse.json({ recent: null })
    let voiceUrl2: string | undefined
    if (files.some((f) => f.name === `${predictionId}-2.wav`)) {
      voiceUrl2 = (await supabaseAdmin.storage.from(BUCKET).createSignedUrl(`${dir}/${predictionId}-2.wav`, 3600)).data?.signedUrl
      if (!voiceUrl2) return NextResponse.json({ recent: null })
    }
    return NextResponse.json({ recent: { predictionId, take, voiceUrl: signed.signedUrl, ...(voiceUrl2 ? { voiceUrl2 } : {}), createdAt: json.created_at } })
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
  await supabaseAdmin.storage.from(BUCKET).remove([`${dir}/${id}.wav`, `${dir}/${id}-2.wav`, `${dir}/${id}.json`])
  return NextResponse.json({ ok: true })
}
