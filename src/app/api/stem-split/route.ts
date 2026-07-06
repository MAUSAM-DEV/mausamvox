import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { logReplicateTiming, logReplicateStageTiming } from '@/lib/replicate-timing'
import { persistStemFile } from '@/lib/stem-persist'
import { fireWarmPing } from '@/lib/rvc-engine'

// POST creates the prediction and returns immediately. GET is the status poll;
// on success it now also buffers ALL FOUR stems from Replicate into Supabase
// (parallel downloads + re-uploads), so allow up to 60 s like voice-swaps/persist.
export const maxDuration = 60

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

// ── Durable stem copies ─────────────────────────────────────────────────────
// Demucs returns ephemeral replicate.delivery URLs (~1h). The vocal is later
// fed to gender-split (MVSEP), karaoke-split, and voice-convert (RVC); the
// music stems (bass/drums/other) are fetched by the browser to build the
// full-song mix — all often well past that hour (localStorage cache restore,
// duet flows). We copy ALL FOUR stems into the private audio-uploads bucket
// (persistStemFile in lib/stem-persist) so every consumer can re-sign a fresh
// URL on demand instead of hitting a dead link and silently dropping the stem.
async function persistAllStems(
  predictionId: string,
  stems: { vocals: string; bass: string; drums: string; other: string },
): Promise<Partial<Record<'vocals' | 'bass' | 'drums' | 'other', { url: string; path: string }>>> {
  const kinds = ['vocals', 'bass', 'drums', 'other'] as const
  const results = await Promise.all(
    kinds.map((kind) =>
      stems[kind]
        ? persistStemFile('stem-split', `stems/${predictionId}-${kind}.mp3`, stems[kind])
        : Promise.resolve(null),
    ),
  )
  const out: Partial<Record<(typeof kinds)[number], { url: string; path: string }>> = {}
  kinds.forEach((kind, i) => {
    const r = results[i]
    if (r) out[kind] = r
  })
  return out
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
        // cjwbw/demucs's param is `model_name` (not `model`); the old `model` key
        // was silently ignored, so the cog ran its default htdemucs (4-stem) by
        // luck. Name it explicitly. `mp3: true` was likewise an ignored key —
        // output_format already defaults to mp3, so it's dropped. Output unchanged.
        audio: signed.signedUrl,
        model_name: 'htdemucs',
        mp3_bitrate: 320,
      },
    })

    console.log(`[stem-split] started prediction ${prediction.id} (status=${prediction.status})`)

    // ── 3. Pre-warm the bare-RVC pool (PROJECT_STATUS §6) ─────────────
    // First of two pings per swap: this one wakes the pool while Demucs runs.
    // The GET success handler below re-pings when the stems land, because the
    // 2026-07-05 acceptance swap showed the pool re-chills in under 7 minutes
    // — Demucs (~3-4 min) plus user think-time already exceeded that window.
    await fireWarmPing(new URL(req.url).origin, 'stem-split')

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
      logReplicateTiming('stem-split', prediction)
      logReplicateStageTiming('demucs', prediction)
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
      // Buffer every stem into durable storage so later consumers can re-sign
      // fresh URLs after the Replicate URLs expire. Soft-fallback per stem: on
      // failure we return the ephemeral URL and omit that stem's path.
      const persisted = await persistAllStems(id, stems)
      // Second warm ping of the swap: restart the bare-RVC pool's idle clock at
      // the moment the stems land — the user typically converts within a few
      // minutes of here, and the pool re-chills faster than the POST-time ping
      // alone can cover (observed <7 min on 2026-07-05). The client polls stop
      // at 'succeeded', so this fires once per split.
      await fireWarmPing(new URL(req.url).origin, 'stem-split')
      return NextResponse.json({
        status: 'succeeded',
        ...stems,
        ...(persisted.vocals ? { vocals: persisted.vocals.url, vocalsPath: persisted.vocals.path } : {}),
        ...(persisted.bass ? { bass: persisted.bass.url, bassPath: persisted.bass.path } : {}),
        ...(persisted.drums ? { drums: persisted.drums.url, drumsPath: persisted.drums.path } : {}),
        ...(persisted.other ? { other: persisted.other.url, otherPath: persisted.other.path } : {}),
      })
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
