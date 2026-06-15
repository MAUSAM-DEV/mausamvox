import { NextRequest, NextResponse } from 'next/server'

// Vercel Pro allows up to 300s; hobby is capped at 60s.
// Set to 180s — enough for typical Demucs jobs (~90s on warm GPUs).
export const maxDuration = 180

const REPLICATE_API = 'https://api.replicate.com/v1'
const POLL_INTERVAL_MS = 3_000
const MAX_POLLS = 60 // 60 × 3s = 3 minutes

type PredictionStatus = 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'

interface Prediction {
  id: string
  status: PredictionStatus
  output?: unknown
  error?: string
}

function extractStems(output: unknown): { vocals: string; instrumental: string } | null {
  if (Array.isArray(output) && output.length >= 2) {
    return { vocals: output[0] as string, instrumental: output[1] as string }
  }
  if (output && typeof output === 'object') {
    const o = output as Record<string, string>
    const vocals = o.vocals
    const instrumental = o.no_vocals ?? o.accompaniment ?? o.other
    if (vocals && instrumental) return { vocals, instrumental }
  }
  return null
}

export async function POST(req: NextRequest) {
  let body: { audioUrl?: string; userId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { audioUrl } = body
  if (!audioUrl) {
    return NextResponse.json({ error: 'audioUrl is required' }, { status: 400 })
  }

  const token = process.env.REPLICATE_API_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
  }

  // ── 1. Start prediction ──────────────────────────────────────────
  const createRes = await fetch(`${REPLICATE_API}/models/ryan5453/demucs/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { audio: audioUrl, two_stems: 'vocals' },
    }),
  })

  if (!createRes.ok) {
    const text = await createRes.text()
    return NextResponse.json({ error: `Replicate error: ${text}` }, { status: 502 })
  }

  let prediction: Prediction = await createRes.json()

  // ── 2. Poll for completion ───────────────────────────────────────
  for (
    let i = 0;
    i < MAX_POLLS &&
    prediction.status !== 'succeeded' &&
    prediction.status !== 'failed' &&
    prediction.status !== 'canceled';
    i++
  ) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

    const pollRes = await fetch(`${REPLICATE_API}/predictions/${prediction.id}`, {
      headers: { Authorization: `Token ${token}` },
    })

    if (pollRes.ok) {
      prediction = await pollRes.json()
    }
  }

  // ── 3. Handle result ─────────────────────────────────────────────
  if (prediction.status === 'failed' || prediction.status === 'canceled') {
    return NextResponse.json(
      { error: prediction.error ?? `Stem split ${prediction.status}` },
      { status: 502 }
    )
  }

  if (prediction.status !== 'succeeded') {
    return NextResponse.json({ error: 'Stem split timed out after 3 minutes' }, { status: 504 })
  }

  const stems = extractStems(prediction.output)
  if (!stems) {
    return NextResponse.json(
      { error: 'Unexpected output format from Replicate' },
      { status: 502 }
    )
  }

  return NextResponse.json(stems)
}
