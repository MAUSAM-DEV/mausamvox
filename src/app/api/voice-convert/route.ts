import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { ADMIN_EMAILS } from '@/lib/admin'
import { logReplicateTiming, logReplicateStageTiming } from '@/lib/replicate-timing'
import { createRvcPrediction, rvcEngine, RVC_DEPLOYMENT } from '@/lib/rvc-engine'
import { resolveVoiceModelUrl, rvcInput } from '@/lib/rvc-convert'
import { cancelHdVoice, isHdTicket, pollHdVoice, startHdVoice, startStandardVoice } from '@/lib/hd-voice'
import { newEnginesFor } from '@/lib/new-engines'
import { attachSwapJob, chargeSwap, refundSwap, settleSwap } from '@/lib/swap-charges'
import { FULL_SWAP_CREDITS, HD_SWAPS_PER_DAY, PREVIEW_CREDITS, SWAP_LOCK_MINUTES } from '@/lib/swap-prices'

export const maxDuration = 30

// Charging (2026-10-24, engine rollout step 1 — lib/swap-charges.ts): every swap of a
// non-admin account is charged by POST below BEFORE any machine starts (can't afford
// it → refused, nothing starts): previews (first FREE_PREVIEWS_PER_TRACK of a track
// free, then PREVIEW_CREDITS), full swaps FULL_SWAP_CREDITS per voice (minus what a
// paid preview of the same take cost). The charge is refunded, at most once, when the
// job can't start, when a poll sees it failed, or when the page cancels it (DELETE)
// before the voice was delivered. A delivered voice is settled and never refunded.
// Guards (2026-10-25, step 2), checked in the same atomic step: one swap at a time per
// account (the two voices of one duet share a pairId), at most HD_SWAPS_PER_DAY HD
// Voice full swaps in 24 h.

// Replicate SDK v1 wraps file outputs in a FileOutput class whose .url()
// method returns a URL object. JSON.stringify() shows {} because the URL
// is stored as a non-enumerable private field — so we must call .url() explicitly.
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

// Clamp a number into [lo, hi].

// Starts a voice-conversion job. Returns immediately with a prediction id —
// RVC runs can take longer than a serverless function is allowed to stay
// open, so the client polls GET below instead of us blocking here.
export async function POST(req: NextRequest) {
  // A charge taken below that no job has taken over yet (refunded if anything throws).
  let chargeId: string | null = null
  let chargeUser: string | null = null
  try {
    let body: {
      vocalsUrl?: string
      vocalsPath?: string
      voiceModelUrl?: string
      voiceId?: string
      pitchShift?: number
      autotune?: number
      isPreview?: boolean
      trackKey?: string
      // The app's one automatic retry after a conversion FAILED on the engine:
      // the id of that failed prediction (logged). Nobody pays twice: the failed
      // job was refunded when its poll saw the failure.
      retryOf?: string
      // Full swap of a take that was previewed: the preview's delivered prediction id —
      // what that preview cost counts toward this swap (once; checked in the ledger).
      previewId?: string
      // One voice of a 2-voice duet (charged FULL_SWAP_CREDITS per voice, kind 'duet').
      twoVoice?: boolean
      // Shared by the two voices of one duet: they may run at the same time (one-swap guard).
      pairId?: string
      // HD voice (SoulX → the user's RVC voice → finishing) for this take —
      // single-voice swaps only; used only for accounts newEnginesFor() lets
      // through. The finishing needs the song's music: its durable stem paths.
      hd?: boolean
      instrumentalPath?: string
      backingPath?: string
      // Admin-only live test switch (?hdtest=… on the Voice Swap page), e.g.
      // 'soulx-download' = SoulX gets a missing file → retry → fallback.
      hdTest?: string
      // Which engine for a single-voice admin take: 'standard' = today's engine + the
      // balanced finishing; anything else = HD (SoulX → RVC → finishing).
      engine?: string
      engineChoice?: string   // 'Auto' | 'HD Voice' | 'Standard' (logged)
      songLanguage?: string   // detected song language (logged)
      languageSource?: string // 'detected' | 'title-english' | 'title-other' (Auto's last resort; logged)
      duet?: boolean          // one voice of a 2-voice duet (admin HD): SoulX → RVC, no finishing
    }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { vocalsUrl, vocalsPath, voiceModelUrl, voiceId, pitchShift = 0, autotune = 0, isPreview = false, trackKey, retryOf, previewId, twoVoice = false, pairId, hd = false, instrumentalPath, backingPath, hdTest, engine: engineChoice, engineChoice: engineUiChoice, songLanguage, languageSource, duet } = body
    if (!vocalsUrl) {
      return NextResponse.json({ error: 'vocalsUrl is required' }, { status: 400 })
    }
    if (!voiceId && !voiceModelUrl) {
      return NextResponse.json({ error: 'voiceId or voiceModelUrl is required' }, { status: 400 })
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    // Every swap needs a signed-in account: it is charged to that account. (Until
    // 2026-10-24 a full swap with a client-supplied voiceModelUrl and no voiceId
    // skipped sign-in — anyone could start jobs on our Replicate account.)
    if (!adminConfigured) {
      console.error('[voice-convert] SUPABASE_SERVICE_ROLE_KEY is not configured')
      return NextResponse.json(
        { error: 'Server configuration error: service role key is missing. Contact support.' },
        { status: 500 }
      )
    }
    const sessionClient = await createClient()
    const { data: { user: sessionUser }, error: authError } = await sessionClient.auth.getUser()
    if (authError) {
      return NextResponse.json({ error: 'Auth error: ' + authError.message }, { status: 401 })
    }
    if (!sessionUser) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }
    const user = sessionUser
    const isAdmin = ADMIN_EMAILS.includes(user.email ?? '')
    // New engines (lib/new-engines.ts: NEW_ENGINES off / testers / all). English HD duets stay
    // admin-only (Duet is frozen): a non-admin duet voice always runs today's engine.
    const newEngines = newEnginesFor(user.email)
    const hdTake = hd && !!voiceId && newEngines && (duet !== true || isAdmin)

    // ── Model URL resolution ──────────────────────────────────────────────────
    // Prefer the durable Supabase copy (model_path, signed on read) so the voice
    // still works after the ephemeral replicate.delivery URL expires. Fall back to
    // model_url from DB (older voices not yet persisted), then to the client-supplied
    // voiceModelUrl as a last resort for backwards compatibility.
    let effectiveModelUrl = voiceModelUrl ?? ''
    if (voiceId && user) {
      const resolved = await resolveVoiceModelUrl(voiceId, user.id, new URL(req.url).origin, 'voice-convert')
      if (resolved) effectiveModelUrl = resolved
      // else: clone not found or both null — keep client-supplied voiceModelUrl
    }

    if (!effectiveModelUrl) {
      return NextResponse.json({ error: 'No model URL available for this voice' }, { status: 400 })
    }

    // ── CHARGE (before any machine starts) ────────────────────────────────────
    // The user comes from the session cookie (never the body); balance check +
    // charge + ledger row are one atomic RPC (lib/swap-charges.ts). Admin accounts
    // are never charged. Manual-extracted-stems tracks have no storagePath: their
    // previews are free and never touch preview_uses.
    let creditsRemaining: number | null = null
    // Credits this preview cost (0 = free preview / admin / full swap) — shown by the
    // page; the server counts it toward the full swap of the same take (previewId).
    let previewCharged = 0
    if (!isAdmin) {
      const kind = isPreview ? 'preview' : twoVoice ? 'duet' : 'full'
      // The engine this take will start on (the same test as the HD branch below) — for the HD cap.
      const engine = hdTake && engineChoice !== 'standard' ? 'hd' : 'standard'
      const charge = await chargeSwap({
        userId: user.id, kind, price: isPreview ? PREVIEW_CREDITS : FULL_SWAP_CREDITS,
        trackKey: trackKey ?? '', previewId: isPreview ? undefined : previewId,
        guard: { engine, pairId: twoVoice && typeof pairId === 'string' ? pairId.slice(0, 64) : undefined },
      })
      if (!charge.ok) {
        if (charge.insufficient) {
          const price = isPreview ? PREVIEW_CREDITS : FULL_SWAP_CREDITS
          return NextResponse.json({ error: `Not enough credits — this ${isPreview ? 'preview' : 'swap'} costs up to ${price} credits and you have ${charge.creditsRemaining}. Top up to continue.`, creditsRemaining: charge.creditsRemaining }, { status: 402 })
        }
        if (charge.blocked === 'running') {
          const freeIn = Math.max(1, Math.ceil(SWAP_LOCK_MINUTES - (Date.now() - Date.parse(charge.runningSince)) / 60_000))
          return NextResponse.json({ error: `You already have a swap running — wait for it to finish (one swap at a time). If you closed that page, you can start a new one in about ${freeIn} min.` }, { status: 409 })
        }
        if (charge.blocked === 'hd_cap') {
          const hours = Math.max(1, Math.ceil((Date.parse(charge.hdFreeAt) - Date.now()) / 3_600_000))
          return NextResponse.json({ error: `You've used your ${HD_SWAPS_PER_DAY} HD Voice swaps for today. Choose Standard on Configure, or try HD again in about ${hours} h.` }, { status: 429 })
        }
        return NextResponse.json({ error: "Couldn't check your credits — please try again in a minute." }, { status: 500 })
      }
      chargeId = charge.chargeId
      chargeUser = user.id
      creditsRemaining = charge.creditsRemaining
      if (isPreview) previewCharged = charge.charged
      if (retryOf) console.log(`[voice-convert] retry of failed prediction ${retryOf} (that one was refunded when it failed)`)
    }

    // Re-sign the vocal stem from its durable Supabase path so RVC always fetches
    // a fresh URL. The client-supplied vocalsUrl can be a long-dead Replicate URL
    // (the Demucs output expires ~1h) or a stale signed URL by the time a swap is
    // submitted — especially after a localStorage cache restore. Falls back to the
    // supplied URL for derived stems (lead/male/female) and manual/legacy results,
    // which carry no vocalsPath yet (those land in Increment B).
    let effectiveVocalsUrl = vocalsUrl
    if (vocalsPath && !vocalsPath.includes('..')) {
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from('audio-uploads')
        .createSignedUrl(vocalsPath, 21600)
      if (signErr || !signed?.signedUrl) {
        console.warn('[voice-convert] vocalsPath re-sign failed, using supplied URL:', signErr?.message)
      } else {
        effectiveVocalsUrl = signed.signedUrl
      }
    }

    // ── New engines (lib/hd-voice.ts): HD Voice, or Standard + balanced finishing. Anything
    // that stops it from starting falls through to today's engine below.
    if (hdTake && voiceId) {
      try {
        const common = {
          userId: user.id, voiceId, leadPath: vocalsPath && !vocalsPath.includes('..') ? vocalsPath : '', leadUrl: effectiveVocalsUrl,
          instrumentalPath: instrumentalPath && !instrumentalPath.includes('..') ? instrumentalPath : '',
          backingPath: backingPath && !backingPath.includes('..') ? backingPath : '',
          pitch: pitchShift, autotune: Number(autotune) || 0, chargeId: chargeId ?? undefined, origin: new URL(req.url).origin,
        }
        console.log(`[engine] choice: ${String(engineUiChoice ?? 'Auto').slice(0, 12)} → ${engineChoice === 'standard' ? 'Standard' : 'HD Voice'} (song language ${String(songLanguage ?? 'unknown').slice(0, 8)}${languageSource && languageSource !== 'detected' ? ` — not detected in time, judged from the title: ${String(languageSource).slice(0, 14)}` : ''}, ${isPreview ? 'preview' : 'full swap'})`)
        // The ticket carries the charge from here (settled on delivery, refunded if every path fails).
        if (engineChoice === 'standard') {
          const ticket = await startStandardVoice(common)
          chargeId = null
          return NextResponse.json({ predictionId: ticket, status: 'starting', creditsRemaining, previewCharged })
        }
        const ticket = await startHdVoice({
          userId: user.id, voiceId, leadPath: vocalsPath && !vocalsPath.includes('..') ? vocalsPath : '', leadUrl: effectiveVocalsUrl,
          instrumentalPath: instrumentalPath && !instrumentalPath.includes('..') ? instrumentalPath : '',
          backingPath: backingPath && !backingPath.includes('..') ? backingPath : '',
          pitch: pitchShift, autotune: Number(autotune) || 0, chargeId: chargeId ?? undefined,
          origin: new URL(req.url).origin, test: typeof hdTest === 'string' ? hdTest.slice(0, 40) : undefined,
          noFinish: duet === true,
        })
        chargeId = null
        return NextResponse.json({ predictionId: ticket, status: 'starting', creditsRemaining, previewCharged })
      } catch (hdErr) {
        console.warn(`[hd-voice] FALLBACK to today's engine: SoulX didn't start (${hdErr instanceof Error ? hdErr.message : String(hdErr)})`)
      }
    }

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

    // Engine inputs (fixed server-side settings + this take's pitch and
    // auto-tune) — shared with Compare keys, lib/rvc-convert.ts.
    const engine = rvcEngine()
    const input = rvcInput(engine, effectiveVocalsUrl, effectiveModelUrl, pitchShift, autotune)

    let prediction
    try {
      // new-engine accounts: our own deployment (no shared queue) — rvc-engine.ts
      prediction = await createRvcPrediction(replicate, engine, input, newEngines)
    } catch (createErr) {
      // The job never started — give the charge back (a poll-time failure is
      // refunded by GET, a cancel by DELETE).
      if (chargeId) await refundSwap(user.id, { chargeId }, "job didn't start")
      chargeId = null
      const msg = createErr instanceof Error ? createErr.message : String(createErr)
      console.error('[voice-convert] prediction create failed:', msg)
      return NextResponse.json({ error: msg }, { status: 502 })
    }

    // The ledger must know this job, or its refund / delivery can't be matched to the
    // charge: if that fails, stop the job and give the charge back.
    if (chargeId && !(await attachSwapJob(user.id, chargeId, prediction.id))) {
      await replicate.predictions.cancel(prediction.id).catch(() => {})
      await refundSwap(user.id, { chargeId }, "couldn't record the job")
      chargeId = null
      return NextResponse.json({ error: "Couldn't start the swap — please try again in a minute." }, { status: 500 })
    }
    chargeId = null // handed to the job: from here GET / DELETE settle or refund it

    console.log(`[voice-convert] started prediction ${prediction.id} (voice=${voiceId ?? 'unknown'}, status=${prediction.status}${newEngines && engine === 'indexed' ? `, on ${RVC_DEPLOYMENT.name}` : ''})`)

    return NextResponse.json({ predictionId: prediction.id, status: prediction.status, creditsRemaining, previewCharged })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-convert] unhandled error:', msg)
    // Charged but no job started → give it back.
    if (chargeId && chargeUser) await refundSwap(chargeUser, { chargeId }, 'error before the job started')
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Polled by the client to check on a job started via POST above.
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    const sessionClient = await createClient()
    const { data: { user: sessionUser } } = await sessionClient.auth.getUser()
    if (!sessionUser) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    // HD voice ticket (lib/hd-voice.ts): each poll may advance it to the next stage.
    if (isHdTicket(id)) {
      const r = await pollHdVoice(id, sessionUser.id, new URL(req.url).origin)
      return NextResponse.json(r.body, { status: r.status })
    }

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const prediction = await replicate.predictions.get(id)

    // A failed job gives its charge back (at most once — repeat polls find nothing to refund).
    const failed = async (status: string, error: string, httpStatus = 200) => {
      const credits = await refundSwap(sessionUser.id, { jobId: id }, `job ${status}`)
      return NextResponse.json({ status, error, ...(credits !== null ? { creditsRemaining: credits } : {}) }, { status: httpStatus })
    }

    if (prediction.status === 'succeeded') {
      logReplicateTiming('voice-convert', prediction)
      logReplicateStageTiming('rvc', prediction)
      const convertedVocalsUrl = toUrlString(prediction.output)
      if (!convertedVocalsUrl) {
        return failed('failed', `Could not parse Replicate output. Shape: ${safeStringify(prediction.output)}`, 502)
      }
      // Handing the voice over: its charge can't be refunded from now on. A job the
      // page cancelled (refunded) is never handed over; a database hiccup → ask again.
      const settled = await settleSwap(sessionUser.id, { jobId: id }, id)
      if (settled === 'refunded') return NextResponse.json({ status: 'canceled', error: 'This swap was cancelled' })
      if (settled === 'error') return NextResponse.json({ status: 'processing' })
      return NextResponse.json({ status: 'succeeded', convertedVocalsUrl })
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      return failed(prediction.status, safeStringify(prediction.error))
    }

    return NextResponse.json({ status: prediction.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-convert] poll error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// The page gave up on a job (timed out, lost contact, or the other voice of a duet
// failed): stop it and give its charge back — unless its voice was already done, which
// is then settled (a finished job is never refunded; GET won't hand over a refunded one).
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
    const sessionClient = await createClient()
    const { data: { user: sessionUser } } = await sessionClient.auth.getUser()
    if (!sessionUser) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

    if (isHdTicket(id)) {
      const r = await cancelHdVoice(id, sessionUser.id)
      return NextResponse.json(r.body, { status: r.status })
    }

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const prediction = await replicate.predictions.get(id).catch(() => null)
    if (prediction?.status === 'succeeded') {
      await settleSwap(sessionUser.id, { jobId: id }, id)
      return NextResponse.json({ refunded: false })
    }
    await replicate.predictions.cancel(id).catch(() => {})
    const credits = await refundSwap(sessionUser.id, { jobId: id }, 'cancelled by the page')
    return NextResponse.json({ refunded: credits !== null, ...(credits !== null ? { creditsRemaining: credits } : {}) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-convert] cancel error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
