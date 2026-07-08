import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { logReplicateTiming, logReplicateStageTiming } from '@/lib/replicate-timing'
import { persistStemFile } from '@/lib/stem-persist'
import { KARAOKE_VERSION, KARAOKE_MODEL } from '@/lib/karaoke-engine'

// GET buffers the lead/backing stems from Replicate into Supabase on success
// (two parallel ~5 MB download + re-uploads), so allow up to 60 s like stem-split.
export const maxDuration = 60

// erickluis00/all-in-one-audio — wraps python-audio-separator. We feed it an
// already-isolated full-vocal stem and ask the UVR karaoke model to split it
// into lead vs backing vocals. KARAOKE_VERSION + KARAOKE_MODEL now live in
// lib/karaoke-engine.ts (shared single source of truth with the pre-warm ping).

// Replicate SDK v1 wraps file outputs in a FileOutput class whose .url()
// method returns a URL object. JSON.stringify() shows {} because the URL
// is stored as a non-enumerable private field — so we must call .url() explicitly.
// (predictions.get usually returns plain string URLs, but we stay defensive.)
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

// Starts a karaoke (lead/backing) split job. Returns immediately with a
// prediction id — the all-in-one-audio cog runs ~1 min, longer than a
// serverless function should block for, so the client polls GET below.
//
// This stage is ADDITIVE and OPTIONAL: callers must treat any failure as
// "no lead/backing — fall back to the full vocal". This route never blocks
// a swap and is always free (no credit deduction here).
export async function POST(req: NextRequest) {
  try {
    let body: { vocalsUrl?: string; vocalsPath?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { vocalsUrl, vocalsPath } = body
    if (!vocalsUrl) {
      return NextResponse.json({ error: 'vocalsUrl is required' }, { status: 400 })
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    // Re-sign the vocal stem from its durable Supabase path so the karaoke split
    // always fetches a fresh URL — the client-cached vocalsUrl (Demucs output)
    // expires ~1h. Falls back to the supplied URL when no path is provided.
    let effectiveVocalsUrl = vocalsUrl
    if (vocalsPath && !vocalsPath.includes('..')) {
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from('audio-uploads')
        .createSignedUrl(vocalsPath, 21600)
      if (signErr || !signed?.signedUrl) {
        console.warn('[karaoke-split] vocalsPath re-sign failed, using supplied URL:', signErr?.message)
      } else {
        effectiveVocalsUrl = signed.signedUrl
      }
    }

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

    const prediction = await replicate.predictions.create({
      version: KARAOKE_VERSION,
      input: {
        music_input: effectiveVocalsUrl,
        audioSeparator: true,
        audioSeparatorModel: KARAOKE_MODEL,
      },
    })

    console.log(`[karaoke-split] started prediction ${prediction.id} (status=${prediction.status})`)

    return NextResponse.json({ predictionId: prediction.id, status: prediction.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[karaoke-split] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Polled by the client to check on a job started via POST above.
// On success maps the cog's outputs:
//   mdx_vocals       -> leadVocalsUrl    (KARA primary "(Vocals)" stem = lead)
//   mdx_instrumental -> backingVocalsUrl (KARA secondary stem on a vocal-only
//                                         input = backing / harmonies)
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
      logReplicateTiming('karaoke-split', prediction)
      logReplicateStageTiming('karaoke', prediction)
      const output = prediction.output as Record<string, unknown> | null
      const leadVocalsUrl = toUrlString(output?.mdx_vocals)
      const backingVocalsUrl = toUrlString(output?.mdx_instrumental)

      // Lead is the stem we actually swap — if it's missing the split is
      // unusable, so report failure and let the caller fall back.
      if (!leadVocalsUrl) {
        return NextResponse.json(
          { status: 'failed', error: `Could not parse lead vocals from output. Shape: ${safeStringify(prediction.output)}` },
          { status: 502 }
        )
      }

      // backingVocalsUrl may legitimately be '' (e.g. parse miss); still usable —
      // caller swaps the lead and simply has no backing to fold into the bed.
      //
      // Buffer both stems into durable storage so voice-convert (and the
      // full-song mix) can re-sign fresh URLs after the Replicate URLs expire
      // (~1h) — the lead is the DEFAULT input to a single-voice swap, so a
      // stale cached leadVocalsUrl previously went to RVC unchecked. Soft-
      // fallback per stem: on persist failure return the ephemeral URL and
      // omit that stem's path (callers behave as before).
      const [persistedLead, persistedBacking] = await Promise.all([
        persistStemFile('karaoke-split', `stems/${id}-lead.mp3`, leadVocalsUrl),
        backingVocalsUrl
          ? persistStemFile('karaoke-split', `stems/${id}-backing.mp3`, backingVocalsUrl)
          : Promise.resolve(null),
      ])
      return NextResponse.json({
        status: 'succeeded',
        leadVocalsUrl: persistedLead?.url ?? leadVocalsUrl,
        backingVocalsUrl: persistedBacking?.url ?? backingVocalsUrl,
        ...(persistedLead ? { leadVocalsPath: persistedLead.path } : {}),
        ...(persistedBacking ? { backingVocalsPath: persistedBacking.path } : {}),
      })
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      return NextResponse.json({ status: prediction.status, error: safeStringify(prediction.error) })
    }

    return NextResponse.json({ status: prediction.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[karaoke-split] poll error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
