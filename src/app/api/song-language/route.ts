import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { HD_FINISH_DEPLOYMENT } from '@/lib/hd-voice'
import { newEnginesFor } from '@/lib/new-engines'

// Song language for the engine choice (engine plan step 2, 2026-10-23) — new-engine accounts
// only (lib/new-engines.ts).
// The finishing machine (mausam-dev/hd-finish, task "language") runs Whisper-small on the
// lead's loudest 30 s — the same rule as the HD reference pick (Urdu counts as Hindi) — and
// prints `LANGUAGE {json}` in its logs. Asking also wakes the finishing machine early.
//   POST { leadPath } → { id }        GET ?id=… → { status, language?, whisper? }
// Free; never blocks a swap (the page treats any failure as "language unknown").
// Vercel logs: search "[engine]".
export const maxDuration = 15

async function admin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user && newEnginesFor(user.email) ? user : null
}

export async function POST(req: NextRequest) {
  if (!(await admin())) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  let body: { leadPath?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  const leadPath = body.leadPath ?? ''
  if (!leadPath || leadPath.includes('..')) return NextResponse.json({ error: 'leadPath is required' }, { status: 400 })
  const { data: signed } = await supabaseAdmin.storage.from('audio-uploads').createSignedUrl(leadPath, 21600)
  if (!signed?.signedUrl) return NextResponse.json({ error: 'Could not sign the lead' }, { status: 500 })
  try {
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const p = await replicate.deployments.predictions.create(HD_FINISH_DEPLOYMENT.owner, HD_FINISH_DEPLOYMENT.name, {
      input: { task: 'language', lead: signed.signedUrl },
    })
    console.log(`[engine] song language: started ${p.id} on ${HD_FINISH_DEPLOYMENT.name} (${leadPath})`)
    return NextResponse.json({ id: p.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[engine] song language: did not start:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

export async function GET(req: NextRequest) {
  if (!(await admin())) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!/^[a-z0-9]{8,64}$/.test(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  const p = await replicate.predictions.get(id)
  if (p.status === 'succeeded') {
    const line = String(p.logs ?? '').split('\n').find((l) => l.startsWith('LANGUAGE ')) ?? ''
    try {
      const r = JSON.parse(line.slice('LANGUAGE '.length)) as { language: string; whisper: string; window_start_s: number }
      const created = Date.parse(p.created_at ?? ''), done = Date.parse(p.completed_at ?? '')
      console.log(`[engine] song language ${r.language} (Whisper ${r.whisper}, window from ${r.window_start_s} s) | ${id} took ${Number.isFinite(done - created) ? Math.round((done - created) / 1000) : 'n/a'} s (ran ${p.metrics?.predict_time?.toFixed(0) ?? 'n/a'} s)`)
      return NextResponse.json({ status: 'succeeded', language: r.language, whisper: r.whisper })
    } catch {
      return NextResponse.json({ status: 'failed', error: 'no LANGUAGE line in the result' })
    }
  }
  if (p.status === 'failed' || p.status === 'canceled') return NextResponse.json({ status: 'failed', error: String(p.error ?? '').slice(0, 200) })
  return NextResponse.json({ status: p.status })
}
