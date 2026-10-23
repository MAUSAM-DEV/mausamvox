// HD voice (engine plan step 3, 2026-10-22; finishing + preferred references 2026-10-23) —
// ADMIN ACCOUNTS ONLY for now. The founder's frozen "balanced" recipe, voice part:
//   1. SoulX-Singer on our private cloud model (L40S deployment, the tested "pieces ≤ 12 s"
//      method). Reference: the voice's PREFERRED references when it has them
//      (voice-samples/<owner>/hd-ref/<voiceId>/<language>.wav — the model picks the one in
//      the song's language), else the clearest 10 s of its Voice Lab recording, picked in
//      the model exactly as in the tests.
//   2. The user's own RVC voice (protect 0.2, index 0.3, RMVPE, pitch 0 — the key is applied by SoulX).
//   3. Finishing on the private CPU model mausam-dev/hd-finish (models repo hd-finish/): volume
//      contour → the app's polish → gentle de-ess / evening-out → per-section balance to the
//      original's lead-vs-music. The Result screen then mixes it with the HD mix settings
//      (ResultStep `hdVoice`: no browser polish, glue off, shared room 0, no tone match).
//
// Fallback to today's engine (same as every other swap) when SoulX hasn't started
// after HD_START_TIMEOUT_MS, hasn't finished HD_RUN_TIMEOUT_MS after starting, fails,
// or its output fails the quick check (in the model: > 5 % of the lead's sung moments
// silent; here: no / tiny audio file). An RVC or finishing failure after SoulX also falls back.
//
// No database or storage state: POST returns a signed ticket ("hd.<payload>.<mac>")
// as the predictionId; each GET poll advances it and hands the client the next ticket
// (`nextId`) when a new stage starts. The finished answer carries the real Replicate
// prediction id of the voice that was delivered, which save / "Recent — not saved" use.
//
// Credits: unchanged rules — a full swap is charged by the client only after a voice
// is delivered (once, fallback or not); a paid preview is charged at POST as today and
// refunded here if every path fails. Admins are never charged.
//
// Vercel logs: search "hd-voice".
import { createHmac, timingSafeEqual } from 'crypto'
import Replicate from 'replicate'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ADMIN_EMAILS } from '@/lib/admin'
import { INDEXED_RVC_VERSION, rvcEngine, rvcVersion } from '@/lib/rvc-engine'
import { resolveVoiceModelUrl, rvcInput } from '@/lib/rvc-convert'

export const HD_SOULX_DEPLOYMENT = { owner: 'mausam-dev', name: 'soulx-l40s' } // private model mausam-dev/soulx-svc
export const HD_FINISH_DEPLOYMENT = { owner: 'mausam-dev', name: 'hd-finish-cpu' } // private model mausam-dev/hd-finish
export const HD_FINISH_TIMEOUT_MS = 8 * 60 * 1000  // finishing not done this long after it was asked for → fallback
export const HD_REF_DIR = 'hd-ref'                 // voice-samples/<owner>/hd-ref/<voiceId>/<language>.wav
export const HD_START_TIMEOUT_MS = 3 * 60 * 1000   // SoulX not started (queue + boot) after this → fallback
export const HD_RUN_TIMEOUT_MS = 8 * 60 * 1000     // SoulX not finished this long after starting → fallback
export const HD_MAX_KEY = 12                       // SoulX takes ±12 semitones; beyond → today's engine
export const HD_RVC_F0_METHOD = 'rmvpe'            // the tested setting (today's engine uses crepe)
export const HD_RVC_PITCH = 0                      // the key is already in SoulX's output
export const HD_MIN_OUTPUT_BYTES = 50_000          // a SoulX WAV smaller than this is not a song
const SIGNED_URL_TTL_S = 21600

export const HD_NOTE_STARTING = 'HD voice — getting the singing engine ready…'
export const HD_NOTE_SINGING = 'HD voice — shaping the singing (about 2–3 min)…'
export const HD_NOTE_VOICE = 'HD voice — adding your voice…'
export const HD_NOTE_FINISH = 'HD voice — balancing and polishing…'
export const HD_NOTE_FALLBACK = 'Finishing your swap…'

// Kill switch without a code change: Vercel env HD_VOICE=off (then redeploy).
export function hdVoiceAllowed(email: string | null | undefined): boolean {
  if ((process.env.HD_VOICE ?? '').trim().toLowerCase() === 'off') return false
  return !!email && ADMIN_EMAILS.includes(email)
}

type Stage = 'sx' | 'rvc' | 'fin' | 'fb'
interface Ticket {
  s: Stage        // stage
  id: string      // Replicate prediction of this stage
  u: string       // user id
  v: string       // voice id
  lp: string      // lead stem storage path (audio-uploads), '' if none
  lu: string      // lead URL — only when there is no path
  ip: string      // instrumental storage path (audio-uploads) — the finishing's music
  bp: string      // backing vocals storage path, '' if none
  p: number       // the take's key / pitch (SoulX key; today's engine's pitch on fallback)
  a: number       // auto-tune amount (as today)
  t0: number      // HD start, ms
  ts: number      // this stage's start, ms
  pc: number      // preview credits charged at POST (refunded if every path fails)
  tk: string      // track key for that refund
  fr?: string     // fallback reason
}

const b64 = (s: string) => Buffer.from(s).toString('base64url')
const mac = (payload: string) => createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').update(`hd-voice:${payload}`).digest().subarray(0, 16).toString('base64url')
function sign(t: Ticket): string {
  const payload = b64(JSON.stringify(t))
  return `hd.${payload}.${mac(payload)}`
}
export function isHdTicket(id: string): boolean {
  return id.startsWith('hd.')
}
function verify(id: string): Ticket | null {
  const [, payload, m] = id.split('.')
  if (!payload || !m || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  const want = Buffer.from(mac(payload)), got = Buffer.from(m)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()) as Ticket } catch { return null }
}

const secs = (ms: number) => `${Math.round(ms / 1000)} s`
function outputUrl(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.url === 'function') { try { return String((o.url as () => unknown)()) } catch { return '' } }
    if (typeof o.url === 'string') return o.url
  }
  return ''
}
const logLine = (logs: unknown, tag: string) => String(logs ?? '').split('\n').find((l) => l.startsWith(tag))?.trim() ?? `${tag} n/a`

async function signedStem(path: string): Promise<string> {
  if (!path) return ''
  const { data } = await supabaseAdmin.storage.from('audio-uploads').createSignedUrl(path, SIGNED_URL_TTL_S)
  return data?.signedUrl ?? ''
}
async function signedLead(t: Ticket): Promise<string> {
  return (await signedStem(t.lp)) || t.lu
}

// The voice's preferred references (any number of <language>.wav), signed. [] when it has none.
async function preferredRefs(userId: string, voiceId: string): Promise<{ lang: string; url: string }[]> {
  const dir = `${userId}/${HD_REF_DIR}/${voiceId}`
  const { data } = await supabaseAdmin.storage.from('voice-samples').list(dir)
  const out: { lang: string; url: string }[] = []
  for (const f of data ?? []) {
    const m = /^([a-z]{2})\.wav$/.exec(f.name)
    if (!m) continue
    const { data: s } = await supabaseAdmin.storage.from('voice-samples').createSignedUrl(`${dir}/${f.name}`, SIGNED_URL_TTL_S)
    if (s?.signedUrl) out.push({ lang: m[1], url: s.signedUrl })
  }
  return out
}

// POST side. Throws when SoulX can't be started (the caller then runs today's engine).
export async function startHdVoice(opts: {
  userId: string; voiceId: string; leadPath: string; leadUrl: string; instrumentalPath: string; backingPath: string
  pitch: number; autotune: number; previewCharged: number; trackKey: string
}): Promise<string> {
  const t0 = Date.now()
  if (Math.abs(opts.pitch) > HD_MAX_KEY) throw new Error(`key ${opts.pitch} is beyond ±${HD_MAX_KEY}`)
  if (!opts.instrumentalPath) throw new Error('no studio instrumental stored (the finishing needs the music)')
  // The user's OWN voice only (its references / Voice Lab recording).
  const { data: voice } = await supabaseAdmin.from('voice_clones').select('sample_path, language').eq('id', opts.voiceId).eq('user_id', opts.userId).maybeSingle()
  if (!voice) throw new Error('not the user\'s own voice')
  const language = String(voice.language ?? '')
  const refs = await preferredRefs(opts.userId, opts.voiceId)
  let refInput: Record<string, string>, refNote: string
  if (refs.length) {
    const main = refs.find((r) => r.lang === language) ?? refs[0], alt = refs.find((r) => r !== main)
    refInput = { prompt: main.url, prompt_language: main.lang, ...(alt ? { prompt_alt: alt.url, prompt_alt_language: alt.lang } : {}) }
    refNote = `preferred references ${refs.map((r) => r.lang).join('+')} (default ${main.lang})`
  } else {
    if (!voice.sample_path) throw new Error('voice has no stored Voice Lab recording')
    const { data: sample } = await supabaseAdmin.storage.from('voice-samples').createSignedUrl(voice.sample_path, SIGNED_URL_TTL_S)
    if (!sample?.signedUrl) throw new Error('could not sign the Voice Lab recording')
    refInput = { prompt_source: sample.signedUrl, prompt_language: language }
    refNote = 'picked from the Voice Lab recording'
  }
  const t: Ticket = {
    s: 'sx', id: '', u: opts.userId, v: opts.voiceId, lp: opts.leadPath, lu: opts.leadPath ? '' : opts.leadUrl,
    ip: opts.instrumentalPath, bp: opts.backingPath, p: Math.round(opts.pitch), a: opts.autotune, t0, ts: t0, pc: opts.previewCharged, tk: opts.trackKey,
  }
  const lead = await signedLead(t)
  if (!lead) throw new Error('no lead vocal URL')
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  const pred = await replicate.deployments.predictions.create(HD_SOULX_DEPLOYMENT.owner, HD_SOULX_DEPLOYMENT.name, {
    input: { target: lead, ...refInput, pitch_shift: t.p },
  })
  t.id = pred.id
  console.log(`[hd-voice] start: voice ${opts.voiceId} key ${t.p} language ${language || '?'} | reference: ${refNote} → SoulX ${pred.id} on ${HD_SOULX_DEPLOYMENT.name} (${Date.now() - t0} ms)`)
  return sign(t)
}

async function refundIfCharged(t: Ticket) {
  if (!(t.pc > 0) || !t.tk) return
  const { error } = await supabaseAdmin.rpc('refund_preview', { p_user: t.u, p_track: t.tk, p_refund: t.pc })
  console.log(`[hd-voice] preview refund ${t.pc} cr: ${error ? `FAILED ${error.message}` : 'ok'}`)
}

type Reply = Record<string, unknown>

async function fallback(t: Ticket, replicate: Replicate, origin: string, reason: string): Promise<Reply> {
  const now = Date.now()
  try {
    const lead = await signedLead(t)
    const modelUrl = await resolveVoiceModelUrl(t.v, t.u, origin, 'hd-voice')
    if (!lead || !modelUrl) throw new Error(!lead ? 'no lead vocal URL' : 'no voice model')
    const engine = rvcEngine()
    const pred = await replicate.predictions.create({ version: rvcVersion(engine), input: rvcInput(engine, lead, modelUrl, t.p, t.a) })
    console.log(`[hd-voice] FALLBACK to today's engine: ${reason} (at ${secs(now - t.t0)} from start) → ${pred.id}`)
    return { status: 'processing', nextId: sign({ ...t, s: 'fb', id: pred.id, ts: now, fr: reason }), note: HD_NOTE_FALLBACK }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[hd-voice] FAILED: ${reason}; today's engine didn't start either (${msg})`)
    await refundIfCharged(t)
    return { status: 'failed', error: `Voice conversion failed (${reason})` }
  }
}

// GET side: one poll. Returns the JSON the client expects from /api/voice-convert GET,
// plus `nextId` (switch to this ticket), `note` (progress message), and on success
// `predictionId` (the Replicate prediction of the delivered voice).
export async function pollHdVoice(id: string, userId: string, origin: string): Promise<{ body: Reply; status: number }> {
  const t = verify(id)
  if (!t) return { body: { error: 'Bad HD voice ticket' }, status: 400 }
  if (t.u !== userId) return { body: { error: 'Not allowed' }, status: 403 }
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  const pred = await replicate.predictions.get(t.id)
  const now = Date.now()
  const created = Date.parse(pred.created_at ?? '') || t.ts
  const started = pred.started_at ? Date.parse(pred.started_at) : NaN

  if (t.s === 'sx') {
    if (pred.status === 'succeeded') {
      const out = outputUrl(pred.output)
      let bytes = -1
      if (out) { try { bytes = Number((await fetch(out, { method: 'HEAD' })).headers.get('content-length') ?? -1) } catch { /* below */ } }
      if (!out || (bytes >= 0 && bytes < HD_MIN_OUTPUT_BYTES)) return { body: await fallback(t, replicate, origin, `SoulX output failed the quick check (${out ? `${bytes} bytes` : 'no file'})`), status: 200 }
      console.log(`[hd-voice] SoulX done ${t.id}: waited ${Number.isFinite(started) ? secs(started - created) : 'n/a'} to start, ran ${pred.metrics?.predict_time?.toFixed(0) ?? 'n/a'} s | ${logLine(pred.logs, 'LANGUAGE')} | ${logLine(pred.logs, 'REFERENCE')} | ${logLine(pred.logs, 'TIMING song')} | ${logLine(pred.logs, 'CHECK')}`)
      const modelUrl = await resolveVoiceModelUrl(t.v, t.u, origin, 'hd-voice')
      if (!modelUrl) return { body: await fallback(t, replicate, origin, 'no voice model for the RVC step'), status: 200 }
      try {
        const rvc = await replicate.predictions.create({
          version: INDEXED_RVC_VERSION,
          input: { ...rvcInput('indexed', out, modelUrl, HD_RVC_PITCH, t.a), f0_method: HD_RVC_F0_METHOD },
        })
        console.log(`[hd-voice] RVC started ${rvc.id} (your voice: protect 0.2, index 0.3, ${HD_RVC_F0_METHOD}, pitch ${HD_RVC_PITCH})`)
        // wake the finishing machine now, so it's up when the RVC step is done (only the create is awaited)
        await replicate.deployments.predictions.create(HD_FINISH_DEPLOYMENT.owner, HD_FINISH_DEPLOYMENT.name, { input: { warm: true } }).catch(() => {})
        return { body: { status: 'processing', nextId: sign({ ...t, s: 'rvc', id: rvc.id, ts: now }), note: HD_NOTE_VOICE }, status: 200 }
      } catch (err) {
        return { body: await fallback(t, replicate, origin, `RVC step didn't start (${err instanceof Error ? err.message : String(err)})`), status: 200 }
      }
    }
    if (pred.status === 'failed' || pred.status === 'canceled' || pred.status === 'aborted') {
      return { body: await fallback(t, replicate, origin, `SoulX ${pred.status}: ${String(pred.error ?? '').slice(0, 160)}`), status: 200 }
    }
    if (!Number.isFinite(started) && now - created > HD_START_TIMEOUT_MS) {
      await replicate.predictions.cancel(t.id).catch(() => {})
      return { body: await fallback(t, replicate, origin, `SoulX not started after ${secs(now - created)}`), status: 200 }
    }
    if (Number.isFinite(started) && now - started > HD_RUN_TIMEOUT_MS) {
      await replicate.predictions.cancel(t.id).catch(() => {})
      return { body: await fallback(t, replicate, origin, `SoulX not finished ${secs(now - started)} after starting`), status: 200 }
    }
    return { body: { status: 'processing', note: Number.isFinite(started) ? HD_NOTE_SINGING : HD_NOTE_STARTING }, status: 200 }
  }

  if (t.s === 'rvc') {
    if (pred.status === 'succeeded' && outputUrl(pred.output)) {
      console.log(`[hd-voice] RVC done ${t.id}: waited ${Number.isFinite(started) ? secs(started - created) : 'n/a'}, ran ${pred.metrics?.predict_time?.toFixed(0) ?? 'n/a'} s`)
      try {
        const [lead, instrumental, backing] = await Promise.all([signedLead(t), signedStem(t.ip), signedStem(t.bp)])
        if (!lead || !instrumental) throw new Error(!lead ? 'no lead vocal URL' : 'no instrumental URL')
        const fin = await replicate.deployments.predictions.create(HD_FINISH_DEPLOYMENT.owner, HD_FINISH_DEPLOYMENT.name, {
          input: { voice: outputUrl(pred.output), lead, instrumental, ...(backing ? { backing } : {}) },
        })
        console.log(`[hd-voice] finishing started ${fin.id} on ${HD_FINISH_DEPLOYMENT.name} (contour → polish → de-ess/evening-out → balance)`)
        return { body: { status: 'processing', nextId: sign({ ...t, s: 'fin', id: fin.id, ts: now }), note: HD_NOTE_FINISH }, status: 200 }
      } catch (err) {
        return { body: await fallback(t, replicate, origin, `finishing didn't start (${err instanceof Error ? err.message : String(err)})`), status: 200 }
      }
    }
    if (pred.status === 'succeeded' || pred.status === 'failed' || pred.status === 'canceled' || pred.status === 'aborted') {
      const why = pred.status === 'succeeded' ? 'no audio in the result' : `${pred.status}: ${String(pred.error ?? '').slice(0, 160)}`
      return { body: await fallback(t, replicate, origin, `RVC step after SoulX ${why}`), status: 200 }
    }
    return { body: { status: 'processing', note: HD_NOTE_VOICE }, status: 200 }
  }

  if (t.s === 'fin') {
    const out = pred.status === 'succeeded' ? outputUrl(pred.output) : ''
    if (out) {
      console.log(`[hd-voice] HD voice delivered: finishing ${t.id} waited ${Number.isFinite(started) ? secs(started - created) : 'n/a'}, ran ${pred.metrics?.predict_time?.toFixed(0) ?? 'n/a'} s | ${logLine(pred.logs, 'FINISH')} | total ${secs(now - t.t0)} from start`)
      return { body: { status: 'succeeded', convertedVocalsUrl: out, predictionId: t.id, hd: true }, status: 200 }
    }
    if (pred.status === 'succeeded' || pred.status === 'failed' || pred.status === 'canceled' || pred.status === 'aborted') {
      const why = pred.status === 'succeeded' ? 'no audio in the result' : `${pred.status}: ${String(pred.error ?? '').slice(0, 160)}`
      return { body: await fallback(t, replicate, origin, `finishing ${why}`), status: 200 }
    }
    if (now - created > HD_FINISH_TIMEOUT_MS) {
      await replicate.predictions.cancel(t.id).catch(() => {})
      return { body: await fallback(t, replicate, origin, `finishing not done after ${secs(now - created)}`), status: 200 }
    }
    return { body: { status: 'processing', note: HD_NOTE_FINISH }, status: 200 }
  }

  // 'fb' — today's engine
  if (pred.status === 'succeeded') {
    const out = outputUrl(pred.output)
    if (out) {
      console.log(`[hd-voice] fallback delivered (${t.fr}): ${t.id} waited ${Number.isFinite(started) ? secs(started - created) : 'n/a'}, ran ${pred.metrics?.predict_time?.toFixed(0) ?? 'n/a'} s | total ${secs(now - t.t0)} from start`)
      return { body: { status: 'succeeded', convertedVocalsUrl: out, predictionId: t.id, hd: false }, status: 200 }
    }
  }
  if (pred.status === 'succeeded' || pred.status === 'failed' || pred.status === 'canceled' || pred.status === 'aborted') {
    const why = pred.status === 'succeeded' ? 'no audio in the result' : `${pred.status}: ${String(pred.error ?? '').slice(0, 160)}`
    console.error(`[hd-voice] FAILED: today's engine ${why} after fallback (${t.fr}) — every path failed`)
    await refundIfCharged(t)
    return { body: { status: 'failed', error: `Voice conversion failed (${why})` }, status: 200 }
  }
  return { body: { status: 'processing', note: HD_NOTE_FALLBACK }, status: 200 }
}
