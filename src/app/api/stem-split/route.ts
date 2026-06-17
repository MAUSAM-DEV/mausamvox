import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const maxDuration = 180

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

// Safe stringify: FileOutput objects have circular refs / unserializable fields
function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

export async function POST(req: NextRequest) {
  // Top-level catch ensures we always return JSON, never an HTML error page
  try {
    let body: { storagePath?: string; userId?: string; skipSplit?: boolean }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { storagePath, skipSplit } = body
    if (!storagePath) {
      return NextResponse.json({ error: 'storagePath is required' }, { status: 400 })
    }

    // ── 1. Signed URL (bucket is private) ───────────────────────────
    // 6h TTL: when skipSplit is set, this URL goes straight back to the
    // client and must still be valid whenever they later hit "Process",
    // not just for the immediate Replicate fetch below.
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('audio-uploads')
      .createSignedUrl(storagePath, 21600)

    if (signErr || !signed?.signedUrl) {
      return NextResponse.json(
        { error: `Could not sign storage URL: ${signErr?.message ?? 'unknown'}` },
        { status: 500 }
      )
    }

    // Pre-separated stem upload: the file already IS the stem (vocals,
    // instrumental, bass, drums, or other) — just hand back a signed URL.
    if (skipSplit) {
      return NextResponse.json({ url: signed.signedUrl })
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    // ── 2. Run Demucs ────────────────────────────────────────────────
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

    const output = await replicate.run(
      'cjwbw/demucs:25a173108cff36ef9f80f854c162d01df9e6528be175794b81158fa03836d953',
      {
        input: {
          audio: signed.signedUrl,
          stem: 'none',
          model: 'htdemucs',
          mp3: true,
          mp3_bitrate: 320,
        },
      }
    )

    // Log raw output so we can see the exact shape in Vercel logs
    console.log('[stem-split] raw output type:', typeof output, Array.isArray(output) ? 'array' : '')
    console.log('[stem-split] raw output keys:', output && typeof output === 'object' ? Object.keys(output as object) : 'n/a')
    console.log('[stem-split] raw output JSON:', safeStringify(output))

    // Log each stem individually to catch FileOutput .url() values
    if (output && typeof output === 'object' && !Array.isArray(output)) {
      const o = output as Record<string, unknown>
      for (const key of ['vocals', 'bass', 'drums', 'other', 'no_vocals']) {
        const v = o[key]
        console.log(`[stem-split] ${key}: type=${typeof v}, urlMethod=${typeof (v as Record<string,unknown>)?.url}, resolved=${toUrlString(v)}`)
      }
    }

    const stems = extractStems(output)
    if (!stems) {
      return NextResponse.json(
        { error: `Could not parse Replicate output. Shape: ${safeStringify(output)}` },
        { status: 502 }
      )
    }

    if (!stems.vocals) {
      return NextResponse.json(
        { error: `Vocals URL missing. Full stems: ${safeStringify(stems)}` },
        { status: 502 }
      )
    }

    return NextResponse.json(stems)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stem-split] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
