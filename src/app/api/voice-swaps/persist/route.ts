import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

// Allow up to 60 s: we download ~5 MB from Replicate then re-upload to Supabase.
export const maxDuration = 60

const VOICE_SWAPS_BUCKET = 'voice-swaps'

// Replicate SDK v1 wraps file outputs in a FileOutput object.
function toUrlString(v: unknown): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.url === 'function') {
      try { return String((o.url as () => unknown)()) } catch { return '' }
    }
    if (typeof o.url === 'string') return o.url
  }
  return ''
}

// POST /api/voice-swaps/persist
//
// Called by the client immediately after a successful voice-convert poll.
// Downloads the converted MP3 from Replicate's ephemeral URL, uploads it to
// the private voice-swaps bucket, and inserts the voice_swaps row — in one
// server-side operation that completes well within Replicate's 1-hour TTL.
//
// Idempotent: a unique index on replicate_prediction_id means a retry for the
// same prediction is a no-op (we return the existing swap id).
//
// Best-effort on the storage upload: if the download or upload fails, we still
// insert the row (with result_path = null) so the swap appears in Recent Swaps.
export async function POST(req: NextRequest) {
  if (!adminConfigured) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  }
  if (!process.env.REPLICATE_API_TOKEN) {
    return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const sessionClient = await createClient()
  const { data: { user }, error: authError } = await sessionClient.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  // ── Parse body ─────────────────────────────────────────────────────────────
  // mixedPath (optional): storage path in audio-uploads of the client-built
  // FULL mix (clone vocal + instrumental). When present we store THAT as the
  // durable result instead of the bare RVC vocal, so Recent Swaps plays the
  // full track. result_url still holds the Replicate vocal URL as a fallback.
  // instrumentalPath (optional): sibling MUSIC-ONLY mix for Performance Mode's
  // "Music only" backing — best-effort, stored as voice_swaps.instrumental_path.
  let body: { predictionId?: string; songName?: string; voiceUsed?: string; mixedPath?: string; instrumentalPath?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { predictionId, songName, voiceUsed, mixedPath, instrumentalPath } = body
  if (!predictionId) return NextResponse.json({ error: 'predictionId is required' }, { status: 400 })
  if (!songName)     return NextResponse.json({ error: 'songName is required' }, { status: 400 })
  if (!voiceUsed)    return NextResponse.json({ error: 'voiceUsed is required' }, { status: 400 })

  // ── Idempotency: return early if this prediction was already persisted ──────
  const { data: existing } = await supabaseAdmin
    .from('voice_swaps')
    .select('id')
    .eq('replicate_prediction_id', predictionId)
    .maybeSingle()
  if (existing?.id) {
    console.log('[voice-swaps/persist] already persisted, returning existing swap', existing.id)
    return NextResponse.json({ swapId: existing.id })
  }

  // ── Fetch the Replicate prediction to get the output URL ─────────────────
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  let resultUrl = ''
  try {
    const prediction = await replicate.predictions.get(predictionId)
    if (prediction.status !== 'succeeded') {
      return NextResponse.json({ error: `Prediction not succeeded (status: ${prediction.status})` }, { status: 409 })
    }
    resultUrl = toUrlString(prediction.output)
    if (!resultUrl) {
      return NextResponse.json({ error: 'Could not parse Replicate output URL' }, { status: 502 })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-swaps/persist] Replicate fetch failed:', msg)
    return NextResponse.json({ error: `Replicate fetch failed: ${msg}` }, { status: 502 })
  }

  // ── Generate swap ID and storage path ────────────────────────────────────
  const swapId = crypto.randomUUID()
  const swapPath = `${user.id}/${swapId}.mp3`

  // ── Pick what to store durably ───────────────────────────────────────────
  // Prefer the client-built full mix (signed from audio-uploads); fall back to
  // the Replicate vocal URL when no mix was supplied or it can't be signed.
  let downloadUrl = resultUrl
  if (mixedPath && !mixedPath.includes('..')) {
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('audio-uploads')
      .createSignedUrl(mixedPath, 600) // 10 min — fetched immediately below
    if (signErr || !signed?.signedUrl) {
      console.error('[voice-swaps/persist] mixed path sign failed, using vocal:', signErr?.message)
    } else {
      downloadUrl = signed.signedUrl
      console.log('[voice-swaps/persist] storing FULL mix from', mixedPath)
    }
  }

  // ── Best-effort: download + upload to durable storage ────────────────────
  let resultPath: string | null = null
  try {
    const res = await fetch(downloadUrl)
    if (!res.ok) {
      console.error(`[voice-swaps/persist] download failed HTTP ${res.status}`)
    } else {
      const mp3Buffer = Buffer.from(await res.arrayBuffer())
      console.log('[voice-swaps/persist] downloaded', mp3Buffer.length, 'bytes for swap', swapId)

      const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from(VOICE_SWAPS_BUCKET)
        .upload(swapPath, mp3Buffer, { contentType: 'audio/mpeg', upsert: false })
      if (uploadError) {
        console.error('[voice-swaps/persist] upload failed:', uploadError.message)
      } else {
        resultPath = swapPath
        console.log('[voice-swaps/persist] uploaded — local path:', swapPath, '| supabase fullPath:', uploadData?.fullPath ?? '(no fullPath returned)')
      }
    }
  } catch (err) {
    console.error('[voice-swaps/persist] storage step threw:', err instanceof Error ? err.message : String(err))
  }

  // ── Best-effort: persist the MUSIC-ONLY instrumental alongside ─────────────
  // Same sign → download → upload dance as the mix above. Any failure leaves
  // instrPath null: the swap still saves fully, /swaps just won't offer the
  // "Music only" Performance Mode backing for this row.
  let instrPath: string | null = null
  if (instrumentalPath && !instrumentalPath.includes('..')) {
    try {
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from('audio-uploads')
        .createSignedUrl(instrumentalPath, 600)
      if (signErr || !signed?.signedUrl) {
        console.error('[voice-swaps/persist] instrumental sign failed:', signErr?.message)
      } else {
        const res = await fetch(signed.signedUrl)
        if (!res.ok) {
          console.error(`[voice-swaps/persist] instrumental download failed HTTP ${res.status}`)
        } else {
          const buf = Buffer.from(await res.arrayBuffer())
          const path = `${user.id}/${swapId}-instrumental.mp3`
          const { error: upErr } = await supabaseAdmin.storage
            .from(VOICE_SWAPS_BUCKET)
            .upload(path, buf, { contentType: 'audio/mpeg', upsert: false })
          if (upErr) {
            console.error('[voice-swaps/persist] instrumental upload failed:', upErr.message)
          } else {
            instrPath = path
            console.log('[voice-swaps/persist] instrumental stored:', path)
          }
        }
      }
    } catch (err) {
      console.error('[voice-swaps/persist] instrumental step threw:', err instanceof Error ? err.message : String(err))
    }
  }

  // ── Insert the voice_swaps row (always, with or without result_path) ──────
  // ON CONFLICT on replicate_prediction_id is our idempotency guard — a second
  // call for the same predictionId is silently dropped.
  let { error: insertError } = await supabaseAdmin
    .from('voice_swaps')
    .insert({
      id: swapId,
      user_id: user.id,
      song_name: songName,
      voice_used: voiceUsed,
      quality_score: null,
      result_url: resultUrl,
      result_path: resultPath,
      instrumental_path: instrPath,
      replicate_prediction_id: predictionId,
    })

  // Deploy-before-migrate safety: if the instrumental_path column doesn't
  // exist yet (migration 20260705000000 not applied), PostgREST rejects the
  // whole insert (PGRST204 "column not found"). Retry once without it so a
  // swap is NEVER lost to a schema lag — just saved without the instrumental.
  if (insertError && /instrumental_path/.test(insertError.message)) {
    console.error('[voice-swaps/persist] instrumental_path column missing — run migration 20260705000000. Retrying insert without it.')
    ;({ error: insertError } = await supabaseAdmin
      .from('voice_swaps')
      .insert({
        id: swapId,
        user_id: user.id,
        song_name: songName,
        voice_used: voiceUsed,
        quality_score: null,
        result_url: resultUrl,
        result_path: resultPath,
        replicate_prediction_id: predictionId,
      }))
  }

  if (insertError) {
    // Unique violation → another concurrent request already inserted — return its id.
    if (insertError.code === '23505') {
      const { data: raceWinner } = await supabaseAdmin
        .from('voice_swaps')
        .select('id')
        .eq('replicate_prediction_id', predictionId)
        .maybeSingle()
      return NextResponse.json({ swapId: raceWinner?.id ?? swapId })
    }
    console.error('[voice-swaps/persist] insert failed:', insertError.message)
    return NextResponse.json({ error: `DB insert failed: ${insertError.message}` }, { status: 500 })
  }

  console.log('[voice-swaps/persist] done — swap', swapId, resultPath ? '(durable)' : '(result_url only)')
  return NextResponse.json({ swapId, persisted: resultPath !== null })
}
