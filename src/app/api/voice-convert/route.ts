import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { ADMIN_EMAILS } from '@/lib/admin'
import { logReplicateTiming, logReplicateStageTiming } from '@/lib/replicate-timing'
import { rvcEngine, rvcVersion } from '@/lib/rvc-engine'
import { resolveVoiceModelUrl, rvcInput } from '@/lib/rvc-convert'

export const maxDuration = 30

// Preview pricing: the first 2 previews of a given track are free, the 3rd+
// costs 50 credits. Gated server-side via the consume_preview RPC.
const FREE_PREVIEWS_PER_TRACK = 2
const PREVIEW_COST = 50

// Refunds a preview charge whose Replicate job never started (create-failure
// only). Also rolls back the count increment so a never-run preview isn't
// counted. Best-effort: a failed refund is logged, never thrown.
async function refundPreview(userId: string, trackKey: string, amount: number): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('refund_preview', {
      p_user: userId,
      p_track: trackKey,
      p_refund: amount,
    })
    if (error) console.error('[voice-convert] preview refund failed:', error.message)
  } catch (err) {
    console.error('[voice-convert] preview refund threw:', err instanceof Error ? err.message : String(err))
  }
}

// Replicate SDK v1 wraps file outputs in a FileOutput class whose .url()
// method returns a URL object. JSON.stringify() shows {} because the URL
// is stored as a non-enumerable private field — so we must call .url() explicitly.
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

// Safe stringify: FileOutput/Error objects have circular refs / unserializable fields
function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

// Clamp a number into [lo, hi].

// True when `id` is one of our RVC predictions that failed (or was canceled)
// in the last 15 minutes — the only case where a retry preview is free.
const RETRY_WINDOW_MS = 15 * 60 * 1000
async function isRecentFailure(id: string): Promise<boolean> {
  try {
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const p = await replicate.predictions.get(id)
    const created = Date.parse(p.created_at)
    return (p.status === 'failed' || p.status === 'canceled') && p.version === rvcVersion() && Date.now() - created < RETRY_WINDOW_MS
  } catch {
    return false
  }
}

// Starts a voice-conversion job. Returns immediately with a prediction id —
// RVC runs can take longer than a serverless function is allowed to stay
// open, so the client polls GET below instead of us blocking here.
export async function POST(req: NextRequest) {
  try {
    let body: {
      vocalsUrl?: string
      vocalsPath?: string
      voiceModelUrl?: string
      voiceId?: string
      pitchShift?: number
      autotune?: number
      isPreview?: boolean
      trackKey?: string
      // The app's one automatic retry after a conversion FAILED on the engine:
      // the id of that failed prediction. A preview retry is then free (the
      // failed attempt already used the preview), so nobody pays twice.
      retryOf?: string
    }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { vocalsUrl, vocalsPath, voiceModelUrl, voiceId, pitchShift = 0, autotune = 0, isPreview = false, trackKey, retryOf } = body
    if (!vocalsUrl) {
      return NextResponse.json({ error: 'vocalsUrl is required' }, { status: 400 })
    }
    if (!voiceId && !voiceModelUrl) {
      return NextResponse.json({ error: 'voiceId or voiceModelUrl is required' }, { status: 400 })
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    // Run when voiceId is present (server-side model URL resolution) or when
    // isPreview is true (credit gate). Full swaps with only a client-supplied
    // voiceModelUrl and no voiceId skip auth — legacy path, no server lookup needed.
    let user: { id: string; email?: string | null } | null = null
    if (voiceId || isPreview) {
      if (!adminConfigured) {
        console.error('[voice-convert] SUPABASE_SERVICE_ROLE_KEY is not configured')
        return NextResponse.json(
          { error: 'Server configuration error: service role key is missing. Contact support.' },
          { status: 500 }
        )
      }
      const sessionClient = await createClient()
      const { data: { user: sessionUser }, error: authError } = await sessionClient.auth.getUser()
      if (authError) {
        return NextResponse.json({ error: 'Auth error: ' + authError.message }, { status: 401 })
      }
      if (!sessionUser) {
        return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
      }
      user = sessionUser
    }

    // ── Model URL resolution ──────────────────────────────────────────────────
    // Prefer the durable Supabase copy (model_path, signed on read) so the voice
    // still works after the ephemeral replicate.delivery URL expires. Fall back to
    // model_url from DB (older voices not yet persisted), then to the client-supplied
    // voiceModelUrl as a last resort for backwards compatibility.
    let effectiveModelUrl = voiceModelUrl ?? ''
    if (voiceId && user) {
      const resolved = await resolveVoiceModelUrl(voiceId, user.id, new URL(req.url).origin, 'voice-convert')
      if (resolved) effectiveModelUrl = resolved
      // else: clone not found or both null — keep client-supplied voiceModelUrl
    }

    if (!effectiveModelUrl) {
      return NextResponse.json({ error: 'No model URL available for this voice' }, { status: 400 })
    }

    // ── PREVIEW GATE (full swaps are untouched — charged client-side as before) ──
    // First 2 previews of a track are free; the 3rd+ costs PREVIEW_COST. All
    // decisions are server-side: the user comes from the session cookie (never the
    // body), and the check+increment+charge is one atomic RPC. We charge BEFORE
    // starting Replicate and refund only if the create itself fails.
    // Auth and adminConfigured already verified above (isPreview was in the condition
    // that triggered auth); user is guaranteed non-null here when isPreview is true.
    let previewRefund: { userId: string; trackKey: string; amount: number } | null = null
    let creditsRemaining: number | null = null
    // Credits this preview cost (0 = free preview / admin / full swap). The client
    // subtracts it when the same take is saved as the full swap (never pay twice).
    let previewCharged = 0
    if (isPreview) {
      if (!user) {
        // Defensive — can't happen: auth ran above when isPreview is true.
        return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
      }
      // Admin accounts are exempt from all credit gates — skip the RPC entirely.
      const isAdmin = ADMIN_EMAILS.includes(user.email ?? '')
      // Manual-extracted-stems tracks have no storagePath — always free, so skip
      // the RPC entirely and never touch preview_uses.
      if (!isAdmin && trackKey) {
        const { data, error } = await supabaseAdmin.rpc('consume_preview', {
          p_user: user.id,
          p_track: trackKey,
          p_free_limit: FREE_PREVIEWS_PER_TRACK,
          p_cost: PREVIEW_COST,
        })
        if (error) {
          console.error('[voice-convert] consume_preview failed:', error.message)
          return NextResponse.json({ error: 'Failed to check preview allowance' }, { status: 500 })
        }
        const row = Array.isArray(data) ? data[0] : data
        if (!row) {
          return NextResponse.json({ error: 'Failed to check preview allowance' }, { status: 500 })
        }
        if (row.insufficient) {
          return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 })
        }
        if (row.charged > 0) {
          previewRefund = { userId: user.id, trackKey, amount: row.charged }
          previewCharged = row.charged
        }
        // Surface the new balance so the client can update its display.
        creditsRemaining = row.credits_remaining
        // Automatic retry of a conversion that failed on the engine within the
        // last 15 min: undo this preview's count and charge right away.
        if (retryOf && await isRecentFailure(retryOf)) {
          await refundPreview(user.id, trackKey, row.charged)
          console.log(`[voice-convert] free retry of failed prediction ${retryOf}`)
          if (row.charged > 0) creditsRemaining = (creditsRemaining ?? 0) + row.charged
          previewRefund = null
          previewCharged = 0
        }
      }
    }

    // Re-sign the vocal stem from its durable Supabase path so RVC always fetches
    // a fresh URL. The client-supplied vocalsUrl can be a long-dead Replicate URL
    // (the Demucs output expires ~1h) or a stale signed URL by the time a swap is
    // submitted — especially after a localStorage cache restore. Falls back to the
    // supplied URL for derived stems (lead/male/female) and manual/legacy results,
    // which carry no vocalsPath yet (those land in Increment B).
    let effectiveVocalsUrl = vocalsUrl
    if (vocalsPath && !vocalsPath.includes('..')) {
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from('audio-uploads')
        .createSignedUrl(vocalsPath, 21600)
      if (signErr || !signed?.signedUrl) {
        console.warn('[voice-convert] vocalsPath re-sign failed, using supplied URL:', signErr?.message)
      } else {
        effectiveVocalsUrl = signed.signedUrl
      }
    }

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

    // Engine inputs (fixed server-side settings + this take's pitch and
    // auto-tune) — shared with Compare keys, lib/rvc-convert.ts.
    const engine = rvcEngine()
    const input = rvcInput(engine, effectiveVocalsUrl, effectiveModelUrl, pitchShift, autotune)

    let prediction
    try {
      prediction = await replicate.predictions.create({
        version: rvcVersion(engine),
        input,
      })
    } catch (createErr) {
      // The job never started — refund the preview charge and roll back the
      // count. NOTE: failures that happen LATER, during the GET poll, are NOT
      // refunded (accepted limitation).
      if (previewRefund) {
        await refundPreview(previewRefund.userId, previewRefund.trackKey, previewRefund.amount)
      }
      const msg = createErr instanceof Error ? createErr.message : String(createErr)
      console.error('[voice-convert] prediction create failed:', msg)
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    console.log(`[voice-convert] started prediction ${prediction.id} (voice=${voiceId ?? 'unknown'}, status=${prediction.status})`)

    return NextResponse.json({ predictionId: prediction.id, status: prediction.status, creditsRemaining, previewCharged })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-convert] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Polled by the client to check on a job started via POST above.
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const prediction = await replicate.predictions.get(id)

    if (prediction.status === 'succeeded') {
      logReplicateTiming('voice-convert', prediction)
      logReplicateStageTiming('rvc', prediction)
      const convertedVocalsUrl = toUrlString(prediction.output)
      if (!convertedVocalsUrl) {
        return NextResponse.json(
          { status: 'failed', error: `Could not parse Replicate output. Shape: ${safeStringify(prediction.output)}` },
          { status: 502 }
        )
      }
      return NextResponse.json({ status: 'succeeded', convertedVocalsUrl })
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      return NextResponse.json({ status: prediction.status, error: safeStringify(prediction.error) })
    }

    return NextResponse.json({ status: prediction.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-convert] poll error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
