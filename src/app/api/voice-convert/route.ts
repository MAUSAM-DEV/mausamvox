import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'

export const maxDuration = 180

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

// Safe stringify: FileOutput objects have circular refs / unserializable fields
function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

export async function POST(req: NextRequest) {
  // Top-level catch ensures we always return JSON, never an HTML error page
  try {
    let body: { vocalsUrl?: string; voiceModelUrl?: string; pitchShift?: number }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { vocalsUrl, voiceModelUrl, pitchShift = 0 } = body
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

    const output = await replicate.run(
      'pseudoram/rvc-v2:d18e2e0a6a6d3af183cc09622cebba8555ec9a9e66983261fc64c8b1572b7dce',
      {
        input: {
          input_audio: vocalsUrl,
          rvc_model: 'CUSTOM',
          custom_rvc_model_download_url: voiceModelUrl,
          pitch_change: pitchShift,
          index_rate: 0.5,
          filter_radius: 3,
          rms_mix_rate: 0.25,
          f0_method: 'rmvpe',
          crepe_hop_length: 128,
          protect: 0.33,
          output_format: 'mp3',
        },
      }
    )

    console.log('[voice-convert] raw output type:', typeof output)
    console.log('[voice-convert] raw output JSON:', safeStringify(output))

    const convertedVocalsUrl = toUrlString(output)
    if (!convertedVocalsUrl) {
      return NextResponse.json(
        { error: `Could not parse Replicate output. Shape: ${safeStringify(output)}` },
        { status: 502 }
      )
    }

    return NextResponse.json({ convertedVocalsUrl })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-convert] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
