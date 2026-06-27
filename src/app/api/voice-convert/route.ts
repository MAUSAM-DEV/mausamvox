import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { ADMIN_EMAILS } from '@/lib/admin'

export const maxDuration = 30

const RVC_VERSION = '0a9c7c558af4c0f20667c1bd1260ce32a2879944a0b9e44e1398660c077b1550'

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
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

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
      styleIntensity?: number
      indexRate?: number
      // Fine-tune panel overrides for the remaining RVC quality params. Each is
      // optional; when omitted the prior hardcoded default is used (so normal
      // swaps are unchanged). All clamped server-side to their valid ranges.
      protect?: number
      filterRadius?: number
      rmsMixRate?: number
      isPreview?: boolean
      trackKey?: string
    }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { vocalsUrl, vocalsPath, voiceModelUrl, voiceId, pitchShift = 0, styleIntensity = 8, indexRate: indexRateOverride, protect, filterRadius, rmsMixRate, isPreview = false, trackKey } = body
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
      const { data: clone } = await supabaseAdmin
        .from('voice_clones')
        .select('model_path, model_url')
        .eq('id', voiceId)
        .eq('user_id', user.id)
        .single()

      if (clone?.model_path) {
        // Route Replicate through our proxy (/api/voice-model/<id>/model.zip) so
        // the last URL segment is the clean string "model.zip". The RVC container
        // derives its local filename from url.split('/')[-1] without stripping
        // query strings — passing a signed Supabase URL directly produces
        // "uuid.zip?token=<JWT>" (300+ chars), hitting Errno 36 (name too long).
        const origin = new URL(req.url).origin
        effectiveModelUrl = `${origin}/api/voice-model/${voiceId}/model.zip`
        console.log('[voice-convert] using model proxy for', voiceId)
      } else if (clone?.model_url) {
        effectiveModelUrl = clone.model_url
        console.log('[voice-convert] model_path null, using model_url from DB for', voiceId)
      }
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
        }
        // Surface the new balance so the client can update its display.
        creditsRemaining = row.credits_remaining
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

    // Style Intensity (1–10, "Subtle" → "Full replacement") maps onto RVC's
    // index_rate, which controls how much of the target voice's character
    // replaces the source vs. how much of the original accent/tone leaks through.
    // Regenerate sends an explicit indexRate to step voice strength up; when
    // present (and a finite number) it overrides the styleIntensity formula.
    // Either way the result is clamped to [0, 1].
    const rawIndexRate = typeof indexRateOverride === 'number' && Number.isFinite(indexRateOverride)
      ? indexRateOverride
      : styleIntensity / 10
    const indexRate = Math.min(1, Math.max(0, rawIndexRate))

    // Remaining RVC quality params: use the client override when supplied (clamped
    // to RVC's valid range), else the prior hardcoded default. filter_radius must
    // be an integer. Defaults match the values these were pinned at before tuning.
    const protectVal = typeof protect === 'number' && Number.isFinite(protect)
      ? clamp(protect, 0, 0.5) : 0.2
    const filterRadiusVal = typeof filterRadius === 'number' && Number.isFinite(filterRadius)
      ? Math.round(clamp(filterRadius, 0, 7)) : 4
    const rmsMixRateVal = typeof rmsMixRate === 'number' && Number.isFinite(rmsMixRate)
      ? clamp(rmsMixRate, 0, 1) : 0.25

    let prediction
    try {
      prediction = await replicate.predictions.create({
        version: RVC_VERSION,
        input: {
          song_input: effectiveVocalsUrl,
          rvc_model: 'CUSTOM',
          custom_rvc_model_download_url: effectiveModelUrl,
          pitch_change: 'no-change',
          pitch_change_all: pitchShift,
          index_rate: indexRate,
          filter_radius: filterRadiusVal,
          rms_mix_rate: rmsMixRateVal,
          pitch_detection_algorithm: 'rmvpe',
          crepe_hop_length: 128,
          protect: protectVal,
          output_format: 'mp3',
          // Random seed on every call so Replicate can't return a cached
          // prediction when the same vocalsUrl + model are resubmitted (Regenerate).
          seed: Math.floor(Math.random() * 2147483647),
        },
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

    return NextResponse.json({ predictionId: prediction.id, status: prediction.status, creditsRemaining })
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
