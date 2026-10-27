import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { replicateClient } from '@/lib/replicate-client'
import { HD_FINISH_DEPLOYMENT } from '@/lib/hd-voice'
import { ownVoiceVerdict } from '@/lib/own-voice'

// Own-voice check (2026-10-27; see src/lib/own-voice.ts). The page uploads a short clip of the user
// saying a random phrase to voice-samples (via /api/voice-lab/presign), then:
//   POST { voiceId, path } → { id }  starts the finishing machine's speaker_match task
//   GET ?id=…&voiceId=…&path=… → { status, score?, verdict? } — on success stores the score on the
//   voice (migration 20261027000004) and deletes the clip.
// Own voices only. Free; a soft gate (never blocks training). Vercel logs: "[voice-check]".
export const maxDuration = 15

async function ownVoice(voiceId: string, path: string) {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user || !/^[0-9a-f-]{36}$/.test(voiceId)) return null
  // only a check clip (presign `check: true` names it <user>/checks/<time>-check.<ext>)
  if (!new RegExp(`^${user.id}/checks/\\d+-check\\.[a-z0-9]{2,4}$`).test(path)) return null
  const { data: voice } = await supabaseAdmin.from('voice_clones').select('id, user_id, sample_path').eq('id', voiceId).eq('user_id', user.id).maybeSingle()
  if (!voice?.sample_path) return null
  return voice as { id: string; user_id: string; sample_path: string }
}

export async function POST(req: NextRequest) {
  let body: { voiceId?: string; path?: string } = {}
  try { body = await req.json() } catch { /* below */ }
  const path = String(body.path ?? '')
  const voice = await ownVoice(String(body.voiceId ?? ''), path)
  if (!voice) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const sign = (p: string) => supabaseAdmin.storage.from('voice-samples').createSignedUrl(p, 3600)
  const [ref, clip] = await Promise.all([sign(voice.sample_path), sign(path)])
  if (!ref.data?.signedUrl || !clip.data?.signedUrl) return NextResponse.json({ error: 'Could not read the recordings' }, { status: 500 })
  try {
    const p = await replicateClient().deployments.predictions.create(HD_FINISH_DEPLOYMENT.owner, HD_FINISH_DEPLOYMENT.name, {
      input: { task: 'speaker_match', lead: ref.data.signedUrl, other: clip.data.signedUrl },
    })
    console.log(`[voice-check] started ${p.id} for voice ${voice.id}`)
    return NextResponse.json({ id: p.id })
  } catch (err) {
    // an older finishing version rejects the task name — the page says the check is unavailable
    console.error('[voice-check] did not start:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'not started' }, { status: 502 })
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? ''
  const path = req.nextUrl.searchParams.get('path') ?? ''
  const voice = await ownVoice(req.nextUrl.searchParams.get('voiceId') ?? '', path)
  if (!voice) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  if (!/^[a-z0-9]{8,64}$/.test(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const p = await replicateClient().predictions.get(id)
  if (p.status === 'failed' || p.status === 'canceled') return NextResponse.json({ status: 'failed' })
  if (p.status !== 'succeeded') return NextResponse.json({ status: p.status })

  const line = String(p.logs ?? '').split('\n').find((l) => l.startsWith('SPEAKER ')) ?? ''
  let score = NaN
  try { score = Number((JSON.parse(line.slice('SPEAKER '.length)) as { score?: number }).score) } catch { /* below */ }
  if (!Number.isFinite(score)) return NextResponse.json({ status: 'failed', error: 'no score in the result' })
  const verdict = ownVoiceVerdict(score)
  const { error } = await supabaseAdmin.from('voice_clones')
    .update({ own_voice_score: score, own_voice_checked_at: new Date().toISOString() })
    .eq('id', voice.id).eq('user_id', voice.user_id)
  if (error) console.warn(`[voice-check] score not stored for ${voice.id} (migration 20261027000004 not run?): ${error.message}`)
  await supabaseAdmin.storage.from('voice-samples').remove([path]).catch(() => {})
  console.log(`[voice-check] voice ${voice.id}: ${score} → ${verdict} (${line.slice(8, 140)})`)
  return NextResponse.json({ status: 'succeeded', score, verdict })
}
