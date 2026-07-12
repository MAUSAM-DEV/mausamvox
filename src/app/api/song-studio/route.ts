import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { ADMIN_EMAILS } from '@/lib/admin'
import {
  ACE_STEP_VERSION,
  SONG_STUDIO_CREDITS,
  SONG_MIN_SECONDS,
  SONG_MAX_SECONDS,
} from '@/lib/song-engine'

// Song Studio: AI full-song generation via ACE-Step (see song-engine.ts).
//
// POST creates the prediction and returns immediately; GET is the status poll
// (stem-split's create+poll shape, so the client never hits a 504).
//
// Credits follow the gender-split charge+refund pattern: deduct_credits()
// atomically BEFORE the paid Replicate work (each run costs real money), and
// add_credits() refunds if the job fails or never starts — a failed generation
// is never charged. Refund idempotency across repeated polls of the same
// failed prediction rides on voice_swaps' unique replicate_prediction_id
// index: the failure marker row (result_path null, invisible to every list
// query) inserts exactly once, and only that first insert refunds.
//
// On success the audio is copied into the voice-swaps bucket and a
// kind='song_studio' row is inserted, so the result is a normal saved track:
// playable through the sign-on-read proxy (never expires), listed in
// Recent/Saved Tracks, shareable, deletable, 90-day retention.
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Generous input caps — validation, not creativity limits.
const MAX_LYRICS_CHARS = 5000
const MAX_TAGS_CHARS = 300
const MAX_TITLE_CHARS = 120

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

// Best-effort atomic refund — never throws; a failed refund must not mask the
// original error (mirrors gender-split's refundCredits).
async function refundCredits(userId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('add_credits', {
      p_user_id: userId,
      p_amount: SONG_STUDIO_CREDITS,
    })
    if (error) console.error('[song-studio] refund failed:', error.message)
  } catch (err) {
    console.error('[song-studio] refund threw:', err instanceof Error ? err.message : String(err))
  }
}

// Insert a voice_swaps row, tolerating a deploy that outruns migration
// 20260712000003: if Postgres rejects the unknown `kind` column, retry the
// same row without it (the row is then unlabeled but functional).
async function insertSwapRow(row: Record<string, unknown>): Promise<{ error: { code?: string; message: string } | null }> {
  const first = await supabaseAdmin.from('voice_swaps').insert(row)
  if (first.error && /kind/.test(first.error.message)) {
    const { kind: _kind, ...withoutKind } = row
    return supabaseAdmin.from('voice_swaps').insert(withoutKind)
  }
  return first
}

// ── POST: validate → deduct → create the prediction ─────────────────────────
export async function POST(req: NextRequest) {
  // Set once credits are debited so every create-failure path can refund.
  let chargedUserId: string | null = null
  try {
    if (!adminConfigured) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    let body: { lyrics?: string; stylePrompt?: string; duration?: number }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const lyrics = (body.lyrics ?? '').trim()
    const stylePrompt = (body.stylePrompt ?? '').trim()
    const duration = body.duration

    if (!lyrics) {
      return NextResponse.json({ error: 'Lyrics are required — use [instrumental] for a song without vocals' }, { status: 400 })
    }
    if (lyrics.length > MAX_LYRICS_CHARS) {
      return NextResponse.json({ error: `Lyrics are too long (max ${MAX_LYRICS_CHARS} characters)` }, { status: 400 })
    }
    if (!stylePrompt) {
      return NextResponse.json({ error: 'A style prompt is required (e.g. "lo-fi hip hop, chill, female vocals")' }, { status: 400 })
    }
    if (stylePrompt.length > MAX_TAGS_CHARS) {
      return NextResponse.json({ error: `Style prompt is too long (max ${MAX_TAGS_CHARS} characters)` }, { status: 400 })
    }
    if (
      typeof duration !== 'number' || !Number.isFinite(duration) ||
      duration < SONG_MIN_SECONDS || duration > SONG_MAX_SECONDS
    ) {
      return NextResponse.json({ error: `Duration must be ${SONG_MIN_SECONDS}-${SONG_MAX_SECONDS} seconds` }, { status: 400 })
    }

    // Charge BEFORE the paid Replicate create (atomic; gender-split pattern).
    const isAdmin = ADMIN_EMAILS.includes(user.email ?? '')
    if (!isAdmin) {
      const { error: debitError } = await supabaseAdmin.rpc('deduct_credits', {
        p_user_id: user.id,
        p_amount: SONG_STUDIO_CREDITS,
      })
      if (debitError) {
        if (debitError.message.includes('INSUFFICIENT_CREDITS')) {
          return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 })
        }
        console.error('[song-studio] debit failed:', debitError.message)
        return NextResponse.json({ error: 'Failed to deduct credits' }, { status: 500 })
      }
      chargedUserId = user.id
    }

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const prediction = await replicate.predictions.create({
      version: ACE_STEP_VERSION,
      input: {
        tags: stylePrompt,
        lyrics,
        duration: Math.round(duration),
      },
    })

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      // Job never ran — refund immediately.
      if (chargedUserId) await refundCredits(chargedUserId)
      return NextResponse.json({ error: `Generation failed to start: ${safeStringify(prediction.error)}` }, { status: 502 })
    }

    console.log(`[song-studio] started prediction ${prediction.id} (${Math.round(duration)}s, user ${user.id})`)
    return NextResponse.json({ predictionId: prediction.id, status: prediction.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[song-studio] create error:', msg)
    // The create threw before a job started — refund the charge.
    if (chargedUserId) await refundCredits(chargedUserId)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── GET: poll → on success persist + return the durable proxy URL ───────────
// Query: id (prediction id), title (song name for the saved row).
export async function GET(req: NextRequest) {
  try {
    if (!adminConfigured) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }
    const title = (req.nextUrl.searchParams.get('title') ?? '').trim().slice(0, MAX_TITLE_CHARS) || 'Song Studio track'
    const stylePrompt = (req.nextUrl.searchParams.get('style') ?? '').trim().slice(0, MAX_TAGS_CHARS)
    const isAdmin = ADMIN_EMAILS.includes(user.email ?? '')

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const prediction = await replicate.predictions.get(id)

    if (prediction.status === 'succeeded') {
      // Idempotency: a re-poll (or double-tab) of an already-persisted
      // generation returns the existing row instead of storing twice.
      const { data: existing } = await supabaseAdmin
        .from('voice_swaps')
        .select('id, result_path')
        .eq('replicate_prediction_id', id)
        .maybeSingle()
      if (existing) {
        if (!existing.result_path) {
          // The marker row from an earlier failure poll — a prediction can't
          // fail then succeed, so this is unreachable in practice; answer
          // honestly if it ever happens.
          return NextResponse.json({ status: 'failed', error: 'This generation was already marked failed' })
        }
        return NextResponse.json({
          status: 'succeeded',
          swapId: existing.id,
          url: `/api/voice-swaps/${existing.id}/result.mp3`,
        })
      }

      const outputUrl = typeof prediction.output === 'string' ? prediction.output : null
      if (!outputUrl) {
        return NextResponse.json(
          { status: 'failed', error: `Could not parse output. Shape: ${safeStringify(prediction.output)}` },
          { status: 502 }
        )
      }

      // Copy the ephemeral Replicate output into durable storage (the
      // voice-swaps bucket), then serve it forever via the sign-on-read proxy.
      const audioRes = await fetch(outputUrl)
      if (!audioRes.ok) {
        return NextResponse.json({ status: 'failed', error: `Output download failed (http ${audioRes.status})` }, { status: 502 })
      }
      const audioBuffer = Buffer.from(await audioRes.arrayBuffer())
      const ext = new URL(outputUrl).pathname.split('.').pop()?.toLowerCase() === 'mp3' ? 'mp3' : 'wav'
      const swapId = crypto.randomUUID()
      const swapPath = `${user.id}/${swapId}.${ext}`

      const { error: uploadError } = await supabaseAdmin.storage
        .from('voice-swaps')
        .upload(swapPath, audioBuffer, { contentType: ext === 'mp3' ? 'audio/mpeg' : 'audio/wav', upsert: true })
      if (uploadError) {
        return NextResponse.json({ status: 'failed', error: `Storage upload failed: ${uploadError.message}` }, { status: 500 })
      }

      const { error: insertError } = await insertSwapRow({
        id: swapId,
        user_id: user.id,
        song_name: title,
        voice_used: stylePrompt ? `AI generated · ${stylePrompt}` : 'AI generated',
        result_path: swapPath,
        replicate_prediction_id: id,
        kind: 'song_studio',
      })
      if (insertError) {
        if (insertError.code === '23505') {
          // Lost a persist race with a concurrent poll — return the winner.
          const { data: winner } = await supabaseAdmin
            .from('voice_swaps').select('id').eq('replicate_prediction_id', id).maybeSingle()
          // Our orphaned upload: best-effort cleanup.
          await supabaseAdmin.storage.from('voice-swaps').remove([swapPath]).catch(() => {})
          if (winner) {
            return NextResponse.json({ status: 'succeeded', swapId: winner.id, url: `/api/voice-swaps/${winner.id}/result.mp3` })
          }
        }
        console.error('[song-studio] row insert failed:', insertError.message)
        return NextResponse.json({ status: 'failed', error: `Could not save the song: ${insertError.message}` }, { status: 500 })
      }

      console.log(`[song-studio] prediction ${id} persisted as swap ${swapId} (${audioBuffer.length} bytes)`)
      return NextResponse.json({
        status: 'succeeded',
        swapId,
        url: `/api/voice-swaps/${swapId}/result.mp3`,
      })
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      const errMsg = safeStringify(prediction.error)
      console.error(`[song-studio] prediction ${id} ${prediction.status}:`, errMsg)
      // Refund exactly once across repeated polls: the failure marker row
      // (result_path null — excluded from all lists) can only insert once
      // thanks to the unique replicate_prediction_id index.
      if (!isAdmin) {
        const { error: markerError } = await insertSwapRow({
          id: crypto.randomUUID(),
          user_id: user.id,
          song_name: title,
          voice_used: 'AI generated (failed)',
          result_path: null,
          replicate_prediction_id: id,
          kind: 'song_studio',
        })
        if (!markerError) {
          await refundCredits(user.id)
          console.log(`[song-studio] refunded ${SONG_STUDIO_CREDITS} cr for failed prediction ${id}`)
        } else if (markerError.code !== '23505') {
          // Marker insert failed for a non-duplicate reason — refund anyway
          // rather than risk keeping a charge for failed work.
          console.error('[song-studio] refund marker insert failed:', markerError.message)
          await refundCredits(user.id)
        }
      }
      return NextResponse.json({ status: prediction.status, error: errMsg, refunded: !isAdmin })
    }

    // starting / processing — client keeps polling
    return NextResponse.json({ status: prediction.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[song-studio] poll error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
