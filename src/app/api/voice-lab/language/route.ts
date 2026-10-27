import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { replicateClient } from '@/lib/replicate-client'
import { HD_FINISH_DEPLOYMENT } from '@/lib/hd-voice'

// A Voice Lab voice's language, detected from its recording (2026-10-27). Voice Lab has no
// language choice, so every voice was stored as English (the column default) — and HD Voice
// picked its reference clip by looking for English words in Hindi singing. The finishing
// machine's `voice_language` task (models hd-finish/language.py) takes Whisper-small's
// language over every 30 s chunk and keeps the majority (Urdu counts as Hindi); the result
// is stored as voice_clones.language + language_detected (migration 20261027000001).
//   POST { voiceId } → { id } (a job to poll) or { language, detected: true } (already done)
//   GET ?id=…&voiceId=… → { status, language? } — stores it when done
// Own voices only. Free; never blocks anything (the page runs it in the background).
// Vercel logs: search "[voice-language]".
export const maxDuration = 15

async function ownVoice(voiceId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !/^[0-9a-f-]{36}$/.test(voiceId)) return null
  const { data: voice } = await supabaseAdmin.from('voice_clones').select('id, user_id, sample_path, language').eq('id', voiceId).eq('user_id', user.id).maybeSingle()
  if (!voice) return null
  // language_detected is read separately: before the migration the column doesn't exist (→ not detected)
  const { data: flag } = await supabaseAdmin.from('voice_clones').select('language_detected').eq('id', voiceId).maybeSingle()
  return { ...voice, detected: (flag as { language_detected?: boolean } | null)?.language_detected === true }
}

export async function POST(req: NextRequest) {
  let body: { voiceId?: string } = {}
  try { body = await req.json() } catch { /* below */ }
  const voice = await ownVoice(String(body.voiceId ?? ''))
  if (!voice) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  if (voice.detected) return NextResponse.json({ language: voice.language, detected: true })
  if (!voice.sample_path) return NextResponse.json({ error: 'This voice has no recording' }, { status: 400 })
  const { data: signed } = await supabaseAdmin.storage.from('voice-samples').createSignedUrl(voice.sample_path, 3600)
  if (!signed?.signedUrl) return NextResponse.json({ error: 'Could not sign the recording' }, { status: 500 })
  try {
    const p = await replicateClient().deployments.predictions.create(HD_FINISH_DEPLOYMENT.owner, HD_FINISH_DEPLOYMENT.name, {
      input: { task: 'voice_language', lead: signed.signedUrl },
    })
    console.log(`[voice-language] started ${p.id} for voice ${voice.id}`)
    return NextResponse.json({ id: p.id })
  } catch (err) {
    console.error('[voice-language] did not start:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'not started' }, { status: 502 })
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? ''
  const voice = await ownVoice(req.nextUrl.searchParams.get('voiceId') ?? '')
  if (!voice) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  if (!/^[a-z0-9]{8,64}$/.test(id)) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  const p = await replicateClient().predictions.get(id)
  if (p.status === 'succeeded') {
    const line = String(p.logs ?? '').split('\n').find((l) => l.startsWith('LANGUAGE ')) ?? ''
    let language = ''
    try { language = String((JSON.parse(line.slice('LANGUAGE '.length)) as { language?: string }).language ?? '') } catch { /* below */ }
    if (!/^[a-z]{2,3}$/.test(language)) return NextResponse.json({ status: 'failed', error: 'no language in the result' })
    // An older finishing version answers task voice_language like `language`; only a `votes` result is the vote.
    if (!line.includes('"votes"')) {
      console.warn(`[voice-language] ${id}: the finishing machine is on an older version (no vote) — not stored`)
      return NextResponse.json({ status: 'failed', error: 'finishing machine not updated yet' })
    }
    const { error } = await supabaseAdmin.from('voice_clones').update({ language, language_detected: true }).eq('id', voice.id).eq('user_id', voice.user_id)
    if (error) {
      console.error(`[voice-language] store failed for ${voice.id}: ${error.message}`)
      return NextResponse.json({ status: 'failed', error: 'could not store it' })
    }
    console.log(`[voice-language] voice ${voice.id}: ${voice.language} → ${language} (${line.slice(9, 120)})`)
    return NextResponse.json({ status: 'succeeded', language })
  }
  if (p.status === 'failed' || p.status === 'canceled') return NextResponse.json({ status: 'failed' })
  return NextResponse.json({ status: p.status })
}
