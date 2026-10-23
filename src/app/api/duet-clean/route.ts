import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { HD_FINISH_DEPLOYMENT } from '@/lib/hd-voice'
import { rateLimit } from '@/lib/rate-limit'

// Duet clean-up before a 2-voice swap (2026-10-23; every user's duets since 2026-10-24). The finishing machine
// (mausam-dev/hd-finish, task "duetclean") takes the male singer's leftovers out of the female
// stem: the voice engine's pitch tracker grabbed his note in octave overlaps, so her converted voice
// sang his line (founder's duet test: 2.4 s → 1.2 s; her solo cracks 5.6 → 4.4 %).
//   POST { femalePath, malePath } → { id }      GET ?id=… → { status, url? }
// The cleaned stem's URL is Replicate's (≈ 1 h) — used right away for this swap, never stored.
// Any failure = the page converts her original stem. Vercel logs: search "[duet]".
export const maxDuration = 15

async function signedIn() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// only the duet split's own stems (gender-split/<hash>-male|female.mp3)
const okPath = (p: unknown): p is string => typeof p === 'string' && /^gender-split\/[A-Za-z0-9_-]+\.(mp3|flac|wav)$/.test(p)

export async function POST(req: NextRequest) {
  const user = await signedIn()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  // a duet swap starts one clean-up; a few retries are fine, a loop is not
  if (!rateLimit(user.id, 'duet-clean', { max: 6, windowMs: 10 * 60_000 }).allowed) return NextResponse.json({ error: 'Too many duet swaps — wait a few minutes' }, { status: 429 })
  let body: { femalePath?: string; malePath?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (!okPath(body.femalePath) || !okPath(body.malePath)) return NextResponse.json({ error: 'femalePath and malePath are required' }, { status: 400 })
  const sign = async (p: string) => (await supabaseAdmin.storage.from('audio-uploads').createSignedUrl(p, 21600)).data?.signedUrl ?? null
  const [female, male] = await Promise.all([sign(body.femalePath), sign(body.malePath)])
  if (!female || !male) return NextResponse.json({ error: 'Could not sign the stems' }, { status: 500 })
  try {
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const p = await replicate.deployments.predictions.create(HD_FINISH_DEPLOYMENT.owner, HD_FINISH_DEPLOYMENT.name, {
      input: { task: 'duetclean', lead: female, other: male },
    })
    console.log(`[duet] clean-up started ${p.id} on ${HD_FINISH_DEPLOYMENT.name} (${body.femalePath})`)
    return NextResponse.json({ id: p.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[duet] clean-up did not start:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

export async function GET(req: NextRequest) {
  if (!(await signedIn())) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!/^[a-z0-9]{8,64}$/.test(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  const p = await replicate.predictions.get(id)
  // only clean-up jobs — never another job's output
  if ((p.input as { task?: string } | undefined)?.task !== 'duetclean') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (p.status === 'succeeded' && typeof p.output === 'string') {
    const line = String(p.logs ?? '').split('\n').find((l) => l.startsWith('DUETCLEAN ')) ?? ''
    const created = Date.parse(p.created_at ?? ''), done = Date.parse(p.completed_at ?? '')
    console.log(`[duet] clean-up done ${id}: ${line.slice('DUETCLEAN '.length) || 'no log'} | took ${Number.isFinite(done - created) ? Math.round((done - created) / 1000) : 'n/a'} s (ran ${p.metrics?.predict_time?.toFixed(0) ?? 'n/a'} s)`)
    return NextResponse.json({ status: 'succeeded', url: p.output })
  }
  if (p.status === 'succeeded' || p.status === 'failed' || p.status === 'canceled') {
    console.warn(`[duet] clean-up ${id} ${p.status}: ${String(p.error ?? 'no output').slice(0, 200)}`)
    return NextResponse.json({ status: 'failed' })
  }
  return NextResponse.json({ status: p.status })
}
