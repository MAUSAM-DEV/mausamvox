import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

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

// Starts a voice-conversion job. Returns immediately with a prediction id —
// RVC runs can take longer than a serverless function is allowed to stay
// open, so the client polls GET below instead of us blocking here.
export async function POST(req: NextRequest) {
  try {
    let body: {
      vocalsUrl?: string
      voiceModelUrl?: string
      voiceId?: string
      pitchShift?: number
      styleIntensity?: number
      isPreview?: boolean
      trackKey?: string
    }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { vocalsUrl, voiceModelUrl, voiceId, pitchShift = 0, styleIntensity = 6, isPreview = false, trackKey } = body
    if (!vocalsUrl) {
      return NextResponse.json({ error: 'vocalsUrl is required' }, { status: 400 })
    }
    if (!voiceModelUrl) {
      return NextResponse.json({ error: 'voiceModelUrl is required' }, { status: 400 })
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    // ── PREVIEW GATE (full swaps are untouched — charged client-side as before) ──
    // First 2 previews of a track are free; the 3rd+ costs PREVIEW_COST. All
    // decisions are server-side: the user comes from the session cookie (never the
    // body), and the check+increment+charge is one atomic RPC. We charge BEFORE
    // starting Replicate and refund only if the create itself fails.
    let previewRefund: { userId: string; trackKey: string; amount: number } | null = null
    let creditsRemaining: number | null = null
    if (isPreview) {
      if (!adminConfigured) {
        console.error('[voice-convert] SUPABASE_SERVICE_ROLE_KEY is not configured')
        return NextResponse.json(
          { error: 'Server configuration error: service role key is missing. Contact support.' },
          { status: 500 }
        )
      }
      const sessionClient = await createClient()
      const { data: { user }, error: authError } = await sessionClient.auth.getUser()
      if (authError) {
        return NextResponse.json({ error: 'Auth error: ' + authError.message }, { status: 401 })
      }
      if (!user) {
        return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
      }

      // Manual-extracted-stems tracks have no storagePath — always free, so skip
      // the RPC entirely and never touch preview_uses.
      if (trackKey) {
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

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

    // Style Intensity (1–10, "Subtle" → "Full replacement") maps onto RVC's
    // index_rate, which controls how much of the target voice's character
    // replaces the source vs. how much of the original accent/tone leaks through.
    const indexRate = Math.min(1, Math.max(0, styleIntensity / 10))

    let prediction
    try {
      prediction = await replicate.predictions.create({
        version: RVC_VERSION,
        input: {
          song_input: vocalsUrl,
          rvc_model: 'CUSTOM',
          custom_rvc_model_download_url: voiceModelUrl,
          pitch_change: 'no-change',
          pitch_change_all: pitchShift,
          index_rate: indexRate,
          filter_radius: 4,
          rms_mix_rate: 0.5,
          pitch_detection_algorithm: 'rmvpe',
          crepe_hop_length: 128,
          protect: 0.33,
          output_format: 'mp3',
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
