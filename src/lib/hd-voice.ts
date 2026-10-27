// HD voice (engine plan step 3, 2026-10-22; finishing + preferred references 2026-10-23) —
// Who gets it: lib/new-engines.ts (NEW_ENGINES off / testers / all). The founder's frozen "balanced" recipe, voice part:
//   1. SoulX-Singer on our private cloud model (L40S deployment, the tested "pieces ≤ 12 s"
//      method). Reference: the voice's PREFERRED references when it has them
//      (voice-samples/<owner>/hd-ref/<voiceId>/<language>.wav — the model picks the one in
//      the song's language), else the clearest 10 s of its Voice Lab recording, picked in
//      the model exactly as in the tests.
//   2. The user's own RVC voice (protect 0.2, index 0.3, RMVPE, pitch 0 — the key is applied by SoulX).
//   3. Finishing on the private CPU model mausam-dev/hd-finish (models repo hd-finish/): volume
//      contour → the app's polish → gentle de-ess / evening-out → per-section balance to the
//      original's lead-vs-music. The Result screen then mixes it with the HD mix settings
//      (ResultStep `finishedVoice`: no browser polish, glue off, shared room 0, no tone match).
//
// Fallback to today's engine (same as every other swap) when SoulX hasn't started
// after HD_START_TIMEOUT_MS, hasn't finished HD_RUN_TIMEOUT_MS after starting, fails,
// or its output fails the quick check (in the model: > 5 % of the lead's sung moments
// silent; here: no / tiny audio file). An RVC or finishing failure after SoulX also falls back.
// Before falling back (2026-10-23, fallback-wait fix): a step that failed because it
// couldn't FETCH an input (download / connection error) is started once more with fresh
// links; a voice-engine step (RVC, today's engine) that hasn't started after
// RVC_START_TIMEOUT_MS, landed on a machine without a working GPU (its log says "use CPU
// for inference" — seen 2026-10-23, 5+ min for a song instead of ~1), or is still running
// RVC_RUN_TIMEOUT_MS after starting, is cancelled and started once more — on the OTHER
// pool: voice-engine steps run on our own deployments (rvc-engine.ts RvcPool: Standard on T4, HD on L40S), and a
// restart goes to the public model (a broken machine stays up and would get the job again).
//
// No database or storage state: POST returns a signed ticket ("hd.<payload>.<mac>")
// as the predictionId; each GET poll advances it and hands the client the next ticket
// (`nextId`) when a new stage starts. The finished answer carries the real Replicate
// prediction id of the voice that was delivered, which save / "Recent — not saved" use.
//
// Credits (2026-10-24, lib/swap-charges.ts): the POST charged the swap before anything
// started; the ticket carries that charge (`ch`). It is settled when a voice is delivered
// (fallback or not — same price) and refunded, once, if every path fails or the page
// cancels the ticket (cancelHdVoice). Admins are never charged (no `ch`).
//
// Standard + balanced finishing (engine plan step 3, 2026-10-23, admin only): today's engine
// on the lead (stage 'std', with the same restarts), then the same finishing; if the
// finishing fails, today's unfinished voice is delivered (finished: false → today's mix).
// Answers carry `finished` (the Result screen's finished-voice mix) and `hd` (SoulX used).
//
// Vercel logs: search "hd-voice".
import { createHmac, timingSafeEqual } from 'crypto'
import Replicate from 'replicate'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createRvcPrediction, fireWarmPing, rvcEngine, rvcPoolName } from '@/lib/rvc-engine'
import { resolveVoiceModelUrl, rvcInput } from '@/lib/rvc-convert'
import { downgradeToStandard, refundSwap, setChargeEngine, settleSwap } from '@/lib/swap-charges'
import { FULL_SWAP_CREDITS, PREVIEW_CREDITS } from '@/lib/swap-prices'

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
export const HD_RESTARTS = 1                       // restarts per stage (input fetch error / stuck / no GPU)
export const RVC_START_TIMEOUT_MS = 3 * 60 * 1000  // a voice-engine step not started after this: cancelled, started once more
export const RVC_RUN_TIMEOUT_MS = 5 * 60 * 1000    // … or still running this long after starting (a full song takes ~0.5–1.5 min)
// Speed (rollout step 4, Option B, 2026-10-25): while SoulX sings (~2 min), the L40S voice machine is woken
// (boot ~1.7 min) and kept up with a ping this often — an idle machine shuts down in under a minute — so the
// RVC step starts at once. Not at SoulX's creation: SoulX itself can take 1–4.5 min to start.
export const HD_RVC_WAKE_EVERY_MS = 40 * 1000
const NO_GPU_LOG = 'use CPU for inference'         // the RVC engine's own message when the machine's GPU isn't usable
// "couldn't fetch an input" as Cog reports it, e.g. "404 Client Error: Not Found for url: …" or
// "HTTPSConnectionPool(host=…): Max retries exceeded with url: …" (seen 2026-10-23)
const INPUT_FETCH_ERROR = /Client Error|Server Error|for url:|HTTPSConnectionPool|Max retries exceeded|Connection (reset|aborted|refused)|Read timed out/i
// SoulX's own quality check failing (soulx-svc predict.py: "quick check failed: N % of the sung moments came out silent…")
const SOULX_CHECK_ERROR = /quick check failed/i
// admin test switch ?hdtest=soulx-download: SoulX is given a missing file (both tries) → fallback
const TEST_MISSING_FILE = '/__hd-test-missing.wav'
const SIGNED_URL_TTL_S = 21600

export const HD_NOTE_STARTING = 'HD voice — getting the singing engine ready…'
export const HD_NOTE_SINGING = 'HD voice — shaping the singing (about 2–3 min)…'
export const HD_NOTE_VOICE = 'HD voice — adding your voice…'
export const HD_NOTE_FINISH = 'HD voice — balancing and polishing…'
export const HD_NOTE_FALLBACK = 'Finishing your swap…'
export const STD_NOTE_VOICE = 'Adding your voice…'
export const STD_NOTE_FINISH = 'Balancing and polishing…'


type Stage = 'sx' | 'rvc' | 'fin' | 'fb' | 'std'
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
  ch?: string     // the swap's charge (swap_charges id) — absent for admins (never charged)
  hp?: 1          // that charge was taken at the HD price (a full swap): a fallback re-prices it to Standard
  pv?: string     // the paid preview counted toward it (kept when it's re-priced)
  hq?: string     // an HD preview (HD_PREVIEW_CREDITS): its song's track key — a fallback re-charges it as a Standard preview
  fr?: string     // fallback reason
  r?: number      // restarts used in this stage (fetch retry / start timeout)
  so?: string     // SoulX output URL (rvc stage — to restart the RVC step)
  ro?: string     // RVC output URL (fin stage — to restart the finishing)
  o?: string      // site origin (test switch)
  tf?: string     // admin test switch
  m?: 'std'       // Standard + finishing flow (absent = HD)
  rid?: string    // fin stage of the Standard flow: the Standard prediction (delivered if finishing fails)
  nf?: 1          // 2-voice duet (2026-10-24, admin): no finishing — the RVC step's voice is delivered (today's duet mix)
  wk?: number     // sx stage: when the L40S voice machine was last woken, ms (step 4, Option B)
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

// SoulX's inputs for a ticket (fresh signed links each time). Throws when they can't be made.
async function soulxInput(t: Ticket): Promise<{ input: Record<string, unknown>; note: string; language: string }> {
  // The user's OWN voice only (its references / Voice Lab recording).
  const { data: voice } = await supabaseAdmin.from('voice_clones').select('sample_path, language').eq('id', t.v).eq('user_id', t.u).maybeSingle()
  if (!voice) throw new Error('not the user\'s own voice')
  const language = String(voice.language ?? '')
  const refs = await preferredRefs(t.u, t.v)
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
  const lead = t.tf === 'soulx-download' && t.o ? `${t.o}${TEST_MISSING_FILE}` : await signedLead(t)
  if (!lead) throw new Error('no lead vocal URL')
  return { input: { target: lead, ...refInput, pitch_shift: t.p }, note: refNote, language }
}

// POST side. Throws when SoulX can't be started (the caller then runs today's engine).
export async function startHdVoice(opts: {
  userId: string; voiceId: string; leadPath: string; leadUrl: string; instrumentalPath: string; backingPath: string
  pitch: number; autotune: number; chargeId?: string; hdPriced?: boolean; previewId?: string; hdPreviewTrack?: string; origin?: string; test?: string
  noFinish?: boolean   // 2-voice duet: SoulX → RVC only (the founder's English duet pick, 2026-10-24)
}): Promise<string> {
  const t0 = Date.now()
  if (Math.abs(opts.pitch) > HD_MAX_KEY) throw new Error(`key ${opts.pitch} is beyond ±${HD_MAX_KEY}`)
  if (!opts.noFinish && !opts.instrumentalPath) throw new Error('no studio instrumental stored (the finishing needs the music)')
  const t: Ticket = {
    s: 'sx', id: '', u: opts.userId, v: opts.voiceId, lp: opts.leadPath, lu: opts.leadPath ? '' : opts.leadUrl,
    ip: opts.instrumentalPath, bp: opts.backingPath, p: Math.round(opts.pitch), a: opts.autotune, t0, ts: t0,
    ...(opts.chargeId ? { ch: opts.chargeId } : {}),
    ...(opts.chargeId && opts.hdPriced ? { hp: 1 as const, ...(opts.previewId ? { pv: opts.previewId } : {}) } : {}),
    ...(opts.chargeId && opts.hdPreviewTrack !== undefined ? { hq: opts.hdPreviewTrack } : {}),
    ...(opts.test ? { tf: opts.test, o: opts.origin } : {}),
    ...(opts.noFinish ? { nf: 1 as const } : {}),
  }
  const { input, note, language } = await soulxInput(t)
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  const pred = await replicate.deployments.predictions.create(HD_SOULX_DEPLOYMENT.owner, HD_SOULX_DEPLOYMENT.name, { input })
  t.id = pred.id
  console.log(`[hd-voice] start: voice ${opts.voiceId} key ${t.p} language ${language || '?'} | reference: ${note} → SoulX ${pred.id} on ${HD_SOULX_DEPLOYMENT.name} (${Date.now() - t0} ms)${t.tf ? ` | TEST ${t.tf}` : ''}`)
  return sign(t)
}

// Standard + balanced finishing: today's engine on the lead (our deployment), then the finishing.
export async function startStandardVoice(opts: {
  userId: string; voiceId: string; leadPath: string; leadUrl: string; instrumentalPath: string; backingPath: string
  pitch: number; autotune: number; chargeId?: string; origin: string
}): Promise<string> {
  const t0 = Date.now()
  const t: Ticket = {
    s: 'std', id: '', m: 'std', u: opts.userId, v: opts.voiceId, lp: opts.leadPath, lu: opts.leadPath ? '' : opts.leadUrl,
    ip: opts.instrumentalPath, bp: opts.backingPath, p: Math.round(opts.pitch), a: opts.autotune, t0, ts: t0, r: 0,
    ...(opts.chargeId ? { ch: opts.chargeId } : {}),
  }
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  const pred = await createRvcPrediction(replicate, rvcEngine(), await rvcStepInput(t, opts.origin, 'fb'), 'standard')
  t.id = pred.id
  // wake the finishing machine now, so it's up when the voice is done (only the create is awaited)
  if (opts.instrumentalPath) await replicate.deployments.predictions.create(HD_FINISH_DEPLOYMENT.owner, HD_FINISH_DEPLOYMENT.name, { input: { warm: true } }).catch(() => {})
  console.log(`[hd-voice] start STANDARD + finishing: voice ${opts.voiceId} key ${t.p} → today's engine ${pred.id} on ${rvcPoolName('standard')}${opts.instrumentalPath ? '' : ' (no studio instrumental: no finishing)'} (${Date.now() - t0} ms)`)
  return sign(t)
}

// Start the finishing on a voice (HD's RVC output or the Standard voice). Throws if it can't.
async function startFinishing(t: Ticket, replicate: Replicate, voiceUrl: string): Promise<string> {
  const [lead, instrumental, backing] = await Promise.all([signedLead(t), signedStem(t.ip), signedStem(t.bp)])
  if (!lead || !instrumental) throw new Error(!lead ? 'no lead vocal URL' : 'no instrumental URL')
  const fin = await replicate.deployments.predictions.create(HD_FINISH_DEPLOYMENT.owner, HD_FINISH_DEPLOYMENT.name, {
    input: { voice: voiceUrl, lead, instrumental, ...(backing ? { backing } : {}) },
  })
  console.log(`[hd-voice] finishing started ${fin.id} on ${HD_FINISH_DEPLOYMENT.name} (contour → polish → de-ess/evening-out → balance)`)
  return fin.id
}

// The voice-engine inputs for a ticket's step: HD's RVC step (on SoulX's output, rmvpe, pitch 0)
// or today's engine (on the lead, the take's pitch).
async function rvcStepInput(t: Ticket, origin: string, step: 'rvc' | 'fb'): Promise<Record<string, unknown>> {
  const modelUrl = await resolveVoiceModelUrl(t.v, t.u, origin, 'hd-voice')
  if (!modelUrl) throw new Error('no voice model')
  if (step === 'rvc') {
    if (!t.so) throw new Error('no SoulX output')
    return { ...rvcInput('indexed', t.so, modelUrl, HD_RVC_PITCH, t.a), f0_method: HD_RVC_F0_METHOD }
  }
  const lead = await signedLead(t)
  if (!lead) throw new Error('no lead vocal URL')
  return rvcInput(rvcEngine(), lead, modelUrl, t.p, t.a)
}

// Start this stage's job once more (fetch error / not started in time). null = no restart left.
async function restart(t: Ticket, replicate: Replicate, origin: string, why: string): Promise<Reply | null> {
  if ((t.r ?? 0) >= HD_RESTARTS) return null
  const now = Date.now()
  let id: string
  if (t.s === 'sx') {
    id = (await replicate.deployments.predictions.create(HD_SOULX_DEPLOYMENT.owner, HD_SOULX_DEPLOYMENT.name, { input: (await soulxInput(t)).input })).id
  } else if (t.s === 'fin') {
    const [lead, instrumental, backing] = await Promise.all([signedLead(t), signedStem(t.ip), signedStem(t.bp)])
    id = (await replicate.deployments.predictions.create(HD_FINISH_DEPLOYMENT.owner, HD_FINISH_DEPLOYMENT.name, {
      input: { voice: t.ro, lead, instrumental, ...(backing ? { backing } : {}) },
    })).id
  } else {
    // the other pool: the public model (our deployment's machine may be the problem)
    id = (await createRvcPrediction(replicate, t.s === 'rvc' ? 'indexed' : rvcEngine(), await rvcStepInput(t, origin, t.s === 'rvc' ? 'rvc' : 'fb'), 'public')).id
  }
  const where = t.s === 'rvc' || t.s === 'fb' || t.s === 'std' ? ' on the public model' : ''
  console.log(`[hd-voice] RESTART ${t.s === 'sx' ? 'SoulX' : t.s === 'fin' ? 'finishing' : t.s === 'rvc' ? 'RVC step' : "today's engine"}: ${why} (at ${secs(now - t.t0)} from start) → ${id}${where}`)
  const note = t.s === 'sx' ? HD_NOTE_STARTING : t.s === 'fin' ? (t.m === 'std' ? STD_NOTE_FINISH : HD_NOTE_FINISH) : t.s === 'rvc' ? HD_NOTE_VOICE : t.s === 'std' ? STD_NOTE_VOICE : HD_NOTE_FALLBACK
  return { status: 'processing', nextId: sign({ ...t, id, ts: now, r: (t.r ?? 0) + 1 }), note }
}

// Every path failed: give the swap's charge back (at most once — a repeat poll finds nothing).
async function refundIfCharged(t: Ticket) {
  if (t.ch) await refundSwap(t.u, { chargeId: t.ch }, 'hd-voice: every path failed')
}

type Reply = Record<string, unknown>

// Why a running voice-engine job should be restarted, or '' if it's fine.
function rvcStuck(pred: { status: string; logs?: string | null }, now: number, created: number, started: number): string {
  if (!Number.isFinite(started)) return now - created > RVC_START_TIMEOUT_MS ? `not started after ${secs(now - created)}` : ''
  if (String(pred.logs ?? '').includes(NO_GPU_LOG)) return 'landed on a machine without a working GPU (running on CPU)'
  return now - started > RVC_RUN_TIMEOUT_MS ? `still running ${secs(now - started)} after starting` : ''
}

async function fallback(t: Ticket, replicate: Replicate, origin: string, reason: string): Promise<Reply> {
  const now = Date.now()
  try {
    const pred = await createRvcPrediction(replicate, rvcEngine(), await rvcStepInput(t, origin, 'fb'), 'hd')  // the L40S woken at SoulX start
    console.log(`[hd-voice] FALLBACK to today's engine: ${reason} (at ${secs(now - t.t0)} from start) → ${pred.id} on ${rvcPoolName('hd')}`)
    // Today's engine = the Standard price (step 5): an HD-priced charge is re-priced; a preview is
    // marked Standard so saving it costs the Standard price.
    let ch = t.ch
    if (t.ch && t.hp) ch = (await downgradeToStandard(t.u, t.ch, FULL_SWAP_CREDITS, t.pv)) ?? undefined
    else if (t.ch && t.hq !== undefined) ch = (await downgradeToStandard(t.u, t.ch, PREVIEW_CREDITS, undefined, { trackKey: t.hq })) ?? undefined
    else if (t.ch) await setChargeEngine(t.ch, 'standard')
    return { status: 'processing', nextId: sign({ ...t, s: 'fb', id: pred.id, ts: now, fr: reason, r: 0, ch, hp: undefined, pv: undefined, hq: undefined }), note: HD_NOTE_FALLBACK }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[hd-voice] FAILED: ${reason}; today's engine didn't start either (${msg})`)
    await refundIfCharged(t)
    return { status: 'failed', error: `Voice conversion failed (${reason})` }
  }
}

// GET side: one poll. Returns the JSON the client expects from /api/voice-convert GET,
// plus `nextId` (switch to this ticket), `note` (progress message), and on success
// `predictionId` (the Replicate prediction of the delivered voice). A delivered voice
// settles the charge first; a cancelled (refunded) ticket is never handed over.
export async function pollHdVoice(id: string, userId: string, origin: string): Promise<{ body: Reply; status: number }> {
  const t = verify(id)
  if (!t) return { body: { error: 'Bad HD voice ticket' }, status: 400 }
  if (t.u !== userId) return { body: { error: 'Not allowed' }, status: 403 }
  const r = await pollStage(t, origin)
  if (r.body.status !== 'succeeded' || !t.ch) return r
  const settled = await settleSwap(t.u, { chargeId: t.ch }, String(r.body.predictionId ?? t.id))
  if (settled === 'refunded') return { body: { status: 'canceled', error: 'This swap was cancelled' }, status: 200 }
  if (settled === 'error') return { body: { status: 'processing' }, status: 200 }  // database hiccup: the next poll asks again
  return r
}

// The page gave up on this ticket: stop its current job and give the charge back
// (nothing happens to a charge already settled by a delivered voice).
export async function cancelHdVoice(id: string, userId: string): Promise<{ body: Reply; status: number }> {
  const t = verify(id)
  if (!t) return { body: { error: 'Bad HD voice ticket' }, status: 400 }
  if (t.u !== userId) return { body: { error: 'Not allowed' }, status: 403 }
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  await replicate.predictions.cancel(t.id).catch(() => {})
  const credits = t.ch ? await refundSwap(t.u, { chargeId: t.ch }, 'hd-voice: cancelled by the page') : null
  console.log(`[hd-voice] cancelled by the page at stage ${t.s} (${t.id})${credits !== null ? ' — refunded' : ''}`)
  return { body: { refunded: credits !== null, ...(credits !== null ? { creditsRemaining: credits } : {}) }, status: 200 }
}

async function pollStage(t: Ticket, origin: string): Promise<{ body: Reply; status: number }> {
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
      try {
        const next: Ticket = { ...t, s: 'rvc', so: out, r: 0 }
        const rvc = await createRvcPrediction(replicate, 'indexed', await rvcStepInput(next, origin, 'rvc'), 'hd')
        console.log(`[hd-voice] RVC started ${rvc.id} on ${rvcPoolName('hd')} (your voice: protect 0.2, index 0.3, ${HD_RVC_F0_METHOD}, pitch ${HD_RVC_PITCH})`)
        // wake the finishing machine now, so it's up when the RVC step is done (only the create is awaited)
        if (!t.nf) await replicate.deployments.predictions.create(HD_FINISH_DEPLOYMENT.owner, HD_FINISH_DEPLOYMENT.name, { input: { warm: true } }).catch(() => {})
        return { body: { status: 'processing', nextId: sign({ ...next, id: rvc.id, ts: now }), note: HD_NOTE_VOICE }, status: 200 }
      } catch (err) {
        return { body: await fallback(t, replicate, origin, `RVC step didn't start (${err instanceof Error ? err.message : String(err)})`), status: 200 }
      }
    }
    if (pred.status === 'failed' || pred.status === 'canceled' || pred.status === 'aborted') {
      const err = String(pred.error ?? '')
      if (INPUT_FETCH_ERROR.test(err)) {
        const again = await restart(t, replicate, origin, `SoulX couldn't fetch an input (${err.slice(0, 120)})`).catch(() => null)
        if (again) return { body: again, status: 200 }
      }
      // duet: SoulX failed its own quality check (e.g. "5.3 % of the sung moments came out silent", just over
      // the 5 % limit — it varies run to run) → once more before today's engine (founder, 2026-10-24)
      if (t.nf && SOULX_CHECK_ERROR.test(err)) {
        const again = await restart(t, replicate, origin, `SoulX failed its quality check (${err.slice(0, 120)})`).catch(() => null)
        if (again) return { body: again, status: 200 }
      }
      return { body: await fallback(t, replicate, origin, `SoulX ${pred.status}: ${err.slice(0, 160)}`), status: 200 }
    }
    if (!Number.isFinite(started) && now - created > HD_START_TIMEOUT_MS) {
      await replicate.predictions.cancel(t.id).catch(() => {})
      return { body: await fallback(t, replicate, origin, `SoulX not started after ${secs(now - created)}`), status: 200 }
    }
    if (Number.isFinite(started) && now - started > HD_RUN_TIMEOUT_MS) {
      await replicate.predictions.cancel(t.id).catch(() => {})
      return { body: await fallback(t, replicate, origin, `SoulX not finished ${secs(now - started)} after starting`), status: 200 }
    }
    if (Number.isFinite(started) && (!t.wk || now - t.wk > HD_RVC_WAKE_EVERY_MS)) {
      await fireWarmPing(origin, 'hd-voice', 'hd')
      return { body: { status: 'processing', nextId: sign({ ...t, wk: now }), note: HD_NOTE_SINGING }, status: 200 }
    }
    return { body: { status: 'processing', note: Number.isFinite(started) ? HD_NOTE_SINGING : HD_NOTE_STARTING }, status: 200 }
  }

  if (t.s === 'rvc') {
    if (pred.status === 'succeeded' && outputUrl(pred.output)) {
      console.log(`[hd-voice] RVC done ${t.id}: waited ${Number.isFinite(started) ? secs(started - created) : 'n/a'}, ran ${pred.metrics?.predict_time?.toFixed(0) ?? 'n/a'} s`)
      if (t.nf) {
        console.log(`[hd-voice] HD duet voice delivered (no finishing): ${t.id} | total ${secs(now - t.t0)} from start`)
        return { body: { status: 'succeeded', convertedVocalsUrl: outputUrl(pred.output), predictionId: t.id, hd: true, finished: false }, status: 200 }
      }
      try {
        const finId = await startFinishing(t, replicate, outputUrl(pred.output))
        return { body: { status: 'processing', nextId: sign({ ...t, s: 'fin', id: finId, ts: now, ro: outputUrl(pred.output), r: 0 }), note: HD_NOTE_FINISH }, status: 200 }
      } catch (err) {
        return { body: await fallback(t, replicate, origin, `finishing didn't start (${err instanceof Error ? err.message : String(err)})`), status: 200 }
      }
    }
    if (pred.status === 'succeeded' || pred.status === 'failed' || pred.status === 'canceled' || pred.status === 'aborted') {
      const why = pred.status === 'succeeded' ? 'no audio in the result' : `${pred.status}: ${String(pred.error ?? '').slice(0, 160)}`
      if (INPUT_FETCH_ERROR.test(String(pred.error ?? ''))) {
        const again = await restart(t, replicate, origin, `RVC step couldn't fetch an input (${why.slice(0, 120)})`).catch(() => null)
        if (again) return { body: again, status: 200 }
      }
      return { body: await fallback(t, replicate, origin, `RVC step after SoulX ${why}`), status: 200 }
    }
    const stuck = rvcStuck(pred, now, created, started)
    if (stuck) {
      await replicate.predictions.cancel(t.id).catch(() => {})
      const again = await restart(t, replicate, origin, `RVC step ${stuck}`).catch(() => null)
      if (again) return { body: again, status: 200 }
      return { body: await fallback(t, replicate, origin, `RVC step ${stuck}, twice`), status: 200 }
    }
    return { body: { status: 'processing', note: HD_NOTE_VOICE }, status: 200 }
  }

  if (t.s === 'fin') {
    const std = t.m === 'std'
    // Standard flow: the finishing failed → deliver today's unfinished voice (today's mix)
    const unfinished = (why: string): Reply => {
      console.warn(`[hd-voice] STANDARD delivered UNFINISHED (finishing ${why}): ${t.rid} | total ${secs(now - t.t0)} from start`)
      return { status: 'succeeded', convertedVocalsUrl: t.ro, predictionId: t.rid, hd: false, finished: false }
    }
    const out = pred.status === 'succeeded' ? outputUrl(pred.output) : ''
    if (out) {
      console.log(`[hd-voice] ${std ? 'STANDARD + finishing' : 'HD voice'} delivered: finishing ${t.id} waited ${Number.isFinite(started) ? secs(started - created) : 'n/a'}, ran ${pred.metrics?.predict_time?.toFixed(0) ?? 'n/a'} s | ${logLine(pred.logs, 'FINISH')} | total ${secs(now - t.t0)} from start`)
      return { body: { status: 'succeeded', convertedVocalsUrl: out, predictionId: t.id, hd: !std, finished: true }, status: 200 }
    }
    if (pred.status === 'succeeded' || pred.status === 'failed' || pred.status === 'canceled' || pred.status === 'aborted') {
      const why = pred.status === 'succeeded' ? 'no audio in the result' : `${pred.status}: ${String(pred.error ?? '').slice(0, 160)}`
      if (t.ro && INPUT_FETCH_ERROR.test(String(pred.error ?? ''))) {
        const again = await restart(t, replicate, origin, `finishing couldn't fetch an input (${why.slice(0, 120)})`).catch(() => null)
        if (again) return { body: again, status: 200 }
      }
      if (std) return { body: unfinished(why), status: 200 }
      return { body: await fallback(t, replicate, origin, `finishing ${why}`), status: 200 }
    }
    if (now - created > HD_FINISH_TIMEOUT_MS) {
      await replicate.predictions.cancel(t.id).catch(() => {})
      if (std) return { body: unfinished(`not done after ${secs(now - created)}`), status: 200 }
      return { body: await fallback(t, replicate, origin, `finishing not done after ${secs(now - created)}`), status: 200 }
    }
    return { body: { status: 'processing', note: std ? STD_NOTE_FINISH : HD_NOTE_FINISH }, status: 200 }
  }

  if (t.s === 'std') {
    const out = pred.status === 'succeeded' ? outputUrl(pred.output) : ''
    if (out) {
      console.log(`[hd-voice] STANDARD voice done ${t.id}: waited ${Number.isFinite(started) ? secs(started - created) : 'n/a'}, ran ${pred.metrics?.predict_time?.toFixed(0) ?? 'n/a'} s`)
      if (!t.ip) {
        console.warn(`[hd-voice] STANDARD delivered UNFINISHED (no studio instrumental): ${t.id}`)
        return { body: { status: 'succeeded', convertedVocalsUrl: out, predictionId: t.id, hd: false, finished: false }, status: 200 }
      }
      try {
        const finId = await startFinishing(t, replicate, out)
        return { body: { status: 'processing', nextId: sign({ ...t, s: 'fin', id: finId, ts: now, ro: out, rid: t.id, r: 0 }), note: STD_NOTE_FINISH }, status: 200 }
      } catch (err) {
        console.warn(`[hd-voice] STANDARD delivered UNFINISHED (finishing didn't start: ${err instanceof Error ? err.message : String(err)}): ${t.id}`)
        return { body: { status: 'succeeded', convertedVocalsUrl: out, predictionId: t.id, hd: false, finished: false }, status: 200 }
      }
    }
    if (pred.status === 'succeeded' || pred.status === 'failed' || pred.status === 'canceled' || pred.status === 'aborted') {
      const why = pred.status === 'succeeded' ? 'no audio in the result' : `${pred.status}: ${String(pred.error ?? '').slice(0, 160)}`
      if (INPUT_FETCH_ERROR.test(String(pred.error ?? ''))) {
        const again = await restart(t, replicate, origin, `today's engine couldn't fetch an input (${why.slice(0, 120)})`).catch(() => null)
        if (again) return { body: again, status: 200 }
      }
      console.error(`[hd-voice] FAILED: STANDARD today's engine ${why}`)
      await refundIfCharged(t)
      return { body: { status: 'failed', error: `Voice conversion failed (${why})` }, status: 200 }
    }
    const stuck = rvcStuck(pred, now, created, started)
    if (stuck && (t.r ?? 0) < HD_RESTARTS) {
      await replicate.predictions.cancel(t.id).catch(() => {})
      const again = await restart(t, replicate, origin, `today's engine ${stuck}`).catch(() => null)
      if (again) return { body: again, status: 200 }
    }
    return { body: { status: 'processing', note: STD_NOTE_VOICE }, status: 200 }
  }

  // 'fb' — today's engine
  if (pred.status === 'succeeded') {
    const out = outputUrl(pred.output)
    if (out) {
      console.log(`[hd-voice] fallback delivered (${t.fr}): ${t.id} waited ${Number.isFinite(started) ? secs(started - created) : 'n/a'}, ran ${pred.metrics?.predict_time?.toFixed(0) ?? 'n/a'} s | total ${secs(now - t.t0)} from start`)
      return { body: { status: 'succeeded', convertedVocalsUrl: out, predictionId: t.id, hd: false, finished: false }, status: 200 }
    }
  }
  if (pred.status === 'succeeded' || pred.status === 'failed' || pred.status === 'canceled' || pred.status === 'aborted') {
    const why = pred.status === 'succeeded' ? 'no audio in the result' : `${pred.status}: ${String(pred.error ?? '').slice(0, 160)}`
    if (INPUT_FETCH_ERROR.test(String(pred.error ?? ''))) {
      const again = await restart(t, replicate, origin, `today's engine couldn't fetch an input (${why.slice(0, 120)})`).catch(() => null)
      if (again) return { body: again, status: 200 }
    }
    console.error(`[hd-voice] FAILED: today's engine ${why} after fallback (${t.fr}) — every path failed`)
    await refundIfCharged(t)
    return { body: { status: 'failed', error: `Voice conversion failed (${why})` }, status: 200 }
  }
  const stuck = rvcStuck(pred, now, created, started)
  if (stuck && (t.r ?? 0) < HD_RESTARTS) {   // no restart left: let it finish, slow or not
    await replicate.predictions.cancel(t.id).catch(() => {})
    const again = await restart(t, replicate, origin, `today's engine ${stuck}`).catch(() => null)
    if (again) return { body: again, status: 200 }
  }
  return { body: { status: 'processing', note: HD_NOTE_FALLBACK }, status: 200 }
}
