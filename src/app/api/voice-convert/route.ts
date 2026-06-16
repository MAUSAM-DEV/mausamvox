import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'

export const maxDuration = 30

const RVC_VERSION = 'd18e2e0a6a6d3af183cc09622cebba8555ec9a9e66983261fc64c8b1572b7dce'

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
    }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { vocalsUrl, voiceModelUrl, voiceId, pitchShift = 0, styleIntensity = 6 } = body
    if (!vocalsUrl) {
      return NextResponse.json({ error: 'vocalsUrl is required' }, { status: 400 })
    }
    if (!voiceModelUrl) {
      return NextResponse.json({ error: 'voiceModelUrl is required' }, { status: 400 })
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

    // Style Intensity (1–10, "Subtle" → "Full replacement") maps onto RVC's
    // index_rate, which controls how much of the target voice's character
    // replaces the source vs. how much of the original accent/tone leaks through.
    const indexRate = Math.min(1, Math.max(0, styleIntensity / 10))

    const prediction = await replicate.predictions.create({
      version: RVC_VERSION,
      input: {
        input_audio: vocalsUrl,
        rvc_model: 'CUSTOM',
        custom_rvc_model_download_url: voiceModelUrl,
        pitch_change: pitchShift,
        index_rate: indexRate,
        filter_radius: 3,
        rms_mix_rate: 0.25,
        f0_method: 'rmvpe',
        crepe_hop_length: 128,
        protect: 0.33,
        output_format: 'mp3',
      },
    })

    console.log(`[voice-convert] started prediction ${prediction.id} (voice=${voiceId ?? 'unknown'}, status=${prediction.status})`)

    return NextResponse.json({ predictionId: prediction.id, status: prediction.status })
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
