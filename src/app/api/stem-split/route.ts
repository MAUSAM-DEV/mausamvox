import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { supabaseAdmin } from '@/lib/supabase/admin'

// POST just creates the prediction and returns immediately — no blocking wait.
// GET is a lightweight status check. Both fit comfortably inside 30 s.
export const maxDuration = 30

const DEMUCS_VERSION = '25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953'

// Replicate SDK v1 wraps file outputs in a FileOutput class whose .url()
// method returns a URL object. JSON.stringify() shows {} because the URL
// is stored as a non-enumerable private field — so we must call .url() explicitly.
function toUrlString(v: unknown): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    // FileOutput: has a .url() method returning a URL object
    if (typeof o.url === 'function') {
      try { return String((o.url as () => unknown)()) } catch { return '' }
    }
    // Plain object with a url string property
    if (typeof o.url === 'string') return o.url
  }
  return ''
}

function extractStems(output: unknown): { bass: string; drums: string; other: string; vocals: string } | null {
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const o = output as Record<string, unknown>
    return {
      vocals: toUrlString(o.vocals),
      bass:   toUrlString(o.bass),
      drums:  toUrlString(o.drums),
      other:  toUrlString(o.other),
    }
  }
  // Array fallback: [bass, drums, other, vocals]
  if (Array.isArray(output) && output.length >= 4) {
    return {
      bass:   toUrlString(output[0]),
      drums:  toUrlString(output[1]),
      other:  toUrlString(output[2]),
      vocals: toUrlString(output[3]),
    }
  }
  return null
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

// Starts a Demucs stem-split job. Returns immediately with a prediction ID —
// the client polls GET below until the job completes. This replaces the old
// replicate.run() (synchronous) approach which blocked a Vercel function for
// up to several minutes and reliably 504'd on long or large files.
export async function POST(req: NextRequest) {
  try {
    console.log('[stem-split] handler entered')

    let body: { storagePath?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { storagePath } = body
    if (!storagePath) {
      return NextResponse.json({ error: 'storagePath is required' }, { status: 400 })
    }

    // ── 1. Signed URL (bucket is private) ───────────────────────────
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('audio-uploads')
      .createSignedUrl(storagePath, 21600)

    if (signErr || !signed?.signedUrl) {
      console.error('[stem-split] createSignedUrl failed:', signErr?.message, 'for path:', storagePath)
      return NextResponse.json(
        { error: `Could not sign storage URL: ${signErr?.message ?? 'unknown'}` },
        { status: 500 }
      )
    }

    console.log('[stem-split] signed URL created, starting Replicate prediction...')

    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    // ── 2. Start Demucs (fire and return — client polls GET) ─────────
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const prediction = await replicate.predictions.create({
      version: DEMUCS_VERSION,
      input: {
        audio: signed.signedUrl,
        model: 'htdemucs',
        mp3: true,
        mp3_bitrate: 320,
      },
    })

    console.log(`[stem-split] started prediction ${prediction.id} (status=${prediction.status})`)
    return NextResponse.json({ predictionId: prediction.id, status: prediction.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stem-split] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Polled by the client to check on a job started via POST above.
// On success maps Demucs output (object or array) to { vocals, bass, drums, other }.
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
      // Log raw output shape so Vercel logs can diagnose any future parse issues.
      console.log('[stem-split] raw output type:', typeof prediction.output, Array.isArray(prediction.output) ? 'array' : '')
      console.log('[stem-split] raw output keys:', prediction.output && typeof prediction.output === 'object' ? Object.keys(prediction.output as object) : 'n/a')

      const stems = extractStems(prediction.output)
      if (!stems) {
        return NextResponse.json(
          { status: 'failed', error: `Could not parse Replicate output. Shape: ${safeStringify(prediction.output)}` },
          { status: 502 }
        )
      }
      if (!stems.vocals) {
        return NextResponse.json(
          { status: 'failed', error: `Vocals URL missing. Full stems: ${safeStringify(stems)}` },
          { status: 502 }
        )
      }
      console.log(`[stem-split] prediction ${id} succeeded`)
      return NextResponse.json({ status: 'succeeded', ...stems })
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      const errMsg = safeStringify(prediction.error)
      console.error(`[stem-split] prediction ${id} ${prediction.status}:`, errMsg)
      return NextResponse.json({ status: prediction.status, error: errMsg })
    }

    // starting / processing / etc — client keeps polling
    return NextResponse.json({ status: prediction.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stem-split] poll error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
