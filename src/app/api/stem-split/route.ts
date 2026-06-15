import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Vercel Pro: up to 300s. Hobby: 60s (Demucs typically takes 60–120s).
export const maxDuration = 180

function extractStems(output: unknown): { bass: string; drums: string; other: string; vocals: string } | null {
  // cjwbw/demucs returns [bass, drums, other, vocals] for htdemucs
  if (Array.isArray(output) && output.length >= 4) {
    return {
      bass:   String(output[0]),
      drums:  String(output[1]),
      other:  String(output[2]),
      vocals: String(output[3]),
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  let body: { storagePath?: string; userId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { storagePath } = body
  if (!storagePath) {
    return NextResponse.json({ error: 'storagePath is required' }, { status: 400 })
  }

  if (!process.env.REPLICATE_API_TOKEN) {
    return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
  }

  // ── 1. Signed URL — bucket is private, Replicate must be able to fetch the file ──
  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from('audio-uploads')
    .createSignedUrl(storagePath, 600) // 10-min TTL

  if (signErr || !signed?.signedUrl) {
    return NextResponse.json(
      { error: `Could not sign storage URL: ${signErr?.message ?? 'unknown'}` },
      { status: 500 }
    )
  }

  // ── 2. Run Demucs via Replicate SDK ─────────────────────────────
  // replicate.run() polls internally — no manual loop needed.
  // "ryan5453/demucs" resolves to the latest published version automatically.
  try {
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

    const output = await replicate.run('cjwbw/demucs', {
      input: {
        audio: signed.signedUrl,
        stem: 'vocals',
        model: 'htdemucs',
        mp3: true,
        mp3_bitrate: 320,
      },
    })

    const stems = extractStems(output)
    if (!stems) {
      return NextResponse.json(
        { error: `Unexpected Replicate output: ${JSON.stringify(output)}` },
        { status: 502 }
      )
    }

    // Returns all 4 stems so callers can verify; vocals = output[3]
    return NextResponse.json(stems)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Replicate call failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
