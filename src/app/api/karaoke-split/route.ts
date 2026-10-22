import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { logReplicateTiming, logReplicateStageTiming } from '@/lib/replicate-timing'
import { persistStemFile } from '@/lib/stem-persist'
import { KARAOKE_VERSION, KARAOKE_MODEL } from '@/lib/karaoke-engine'
import { createClient } from '@/lib/supabase/server'
import { ADMIN_EMAILS } from '@/lib/admin'
import { mvsepCreate, mvsepPoll, type MvsepFile } from '@/lib/mvsep'

// ── HD engine step 2 (2026-10-22): MVSEP Karaoke split, ADMIN ACCOUNTS ONLY ──
// The founder's frozen "balanced" recipe splits lead/backing with MVSEP Karaoke
// (BS-RoFormer 124 bands by MVSep Team: sep_type 49, add_opt1 8) instead of
// KARA_2. For admin accounts POST starts that job and returns it as a
// predictionId `mvsep_<hash>_<start ms>`, which the client polls unchanged;
// GET recognises the prefix. Everyone else gets the KARA_2 path exactly as
// before. If MVSEP can't start, the admin falls back to KARA_2 too.
const MVSEP_KARAOKE_SEP_TYPE = '49'
const MVSEP_KARAOKE_MODEL = '8'
const MVSEP_KARAOKE_OVERLAP = '0'   // as tested (q5/mvsep.mts default)
const MVSEP_OUTPUT_FLAC_16 = '2'    // a 5-min lead as WAV would pass the 50 MB storage cap
const MVSEP_ID = /^mvsep_([A-Za-z0-9]{4,64})_(\d{10,15})$/

async function sessionIsAdmin(): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    return !!user?.email && ADMIN_EMAILS.includes(user.email)
  } catch {
    return false
  }
}

// MVSEP names the karaoke stems "Vocals lead" / "Vocals back" (plus residue
// stems "Instrum only" / "Back instrum" on a vocals-only input — never these).
function karaokeFile(files: MvsepFile[], key: 'vocalslead' | 'vocalsback'): string {
  const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
  const f = files.find((x) => norm(x?.type) === key) ?? files.find((x) => norm(x?.type).includes(key))
  return typeof f?.url === 'string' ? f.url : ''
}

// GET buffers the lead/backing stems from Replicate into Supabase on success
// (two parallel ~5 MB download + re-uploads), so allow up to 60 s like stem-split.
export const maxDuration = 60

// erickluis00/all-in-one-audio — wraps python-audio-separator. We feed it an
// already-isolated full-vocal stem and ask the UVR karaoke model to split it
// into lead vs backing vocals. KARAOKE_VERSION + KARAOKE_MODEL now live in
// lib/karaoke-engine.ts (shared single source of truth with the pre-warm ping).

// Replicate SDK v1 wraps file outputs in a FileOutput class whose .url()
// method returns a URL object. JSON.stringify() shows {} because the URL
// is stored as a non-enumerable private field — so we must call .url() explicitly.
// (predictions.get usually returns plain string URLs, but we stay defensive.)
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

// Starts a karaoke (lead/backing) split job. Returns immediately with a
// prediction id — the all-in-one-audio cog runs ~1 min, longer than a
// serverless function should block for, so the client polls GET below.
//
// This stage is ADDITIVE and OPTIONAL: callers must treat any failure as
// "no lead/backing — fall back to the full vocal". This route never blocks
// a swap and is always free (no credit deduction here).
export async function POST(req: NextRequest) {
  try {
    let body: { vocalsUrl?: string; vocalsPath?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { vocalsUrl, vocalsPath } = body
    if (!vocalsUrl) {
      return NextResponse.json({ error: 'vocalsUrl is required' }, { status: 400 })
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    // Re-sign the vocal stem from its durable Supabase path so the karaoke split
    // always fetches a fresh URL — the client-cached vocalsUrl (Demucs output)
    // expires ~1h. Falls back to the supplied URL when no path is provided.
    let effectiveVocalsUrl = vocalsUrl
    if (vocalsPath && !vocalsPath.includes('..')) {
      const { data: signed, error: signErr } = await supabaseAdmin.storage
        .from('audio-uploads')
        .createSignedUrl(vocalsPath, 21600)
      if (signErr || !signed?.signedUrl) {
        console.warn('[karaoke-split] vocalsPath re-sign failed, using supplied URL:', signErr?.message)
      } else {
        effectiveVocalsUrl = signed.signedUrl
      }
    }

    if (await sessionIsAdmin()) {
      const job = await mvsepCreate({ url: effectiveVocalsUrl, sep_type: MVSEP_KARAOKE_SEP_TYPE, add_opt1: MVSEP_KARAOKE_MODEL, add_opt2: MVSEP_KARAOKE_OVERLAP, output_format: MVSEP_OUTPUT_FLAC_16 })
      if ('hash' in job) {
        console.log(`[karaoke-split] admin: MVSEP karaoke job ${job.hash} started`)
        return NextResponse.json({ predictionId: `mvsep_${job.hash}_${Date.now()}`, status: 'starting' })
      }
      console.error(`[karaoke-split] admin: MVSEP karaoke didn't start (${job.error}) — using KARA_2`)
    }

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })

    const prediction = await replicate.predictions.create({
      version: KARAOKE_VERSION,
      input: {
        music_input: effectiveVocalsUrl,
        audioSeparator: true,
        audioSeparatorModel: KARAOKE_MODEL,
      },
    })

    console.log(`[karaoke-split] started prediction ${prediction.id} (status=${prediction.status})`)

    return NextResponse.json({ predictionId: prediction.id, status: prediction.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[karaoke-split] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// Polled by the client to check on a job started via POST above.
// On success maps the cog's outputs:
//   mdx_vocals       -> leadVocalsUrl    (KARA primary "(Vocals)" stem = lead)
//   mdx_instrumental -> backingVocalsUrl (KARA secondary stem on a vocal-only
//                                         input = backing / harmonies)
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const mv = MVSEP_ID.exec(id)
    if (mv) {
      if (!(await sessionIsAdmin())) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
      const [, hash, startMs] = mv
      const elapsedMs = Date.now() - Number(startMs)
      const poll = await mvsepPoll(hash, elapsedMs)
      if (poll.state === 'processing') return NextResponse.json({ status: 'processing' })
      if (poll.state === 'failed') {
        console.error(`[karaoke-split] admin: MVSEP karaoke job ${hash} failed: ${poll.error}`)
        return NextResponse.json({ status: 'failed', error: poll.error })
      }
      const lead = karaokeFile(poll.files, 'vocalslead')
      const backing = karaokeFile(poll.files, 'vocalsback')
      if (!lead) return NextResponse.json({ status: 'failed', error: `No lead vocal in the MVSEP result (${poll.files.map((f) => f.type).join(', ')})` })
      const [persistedLead, persistedBacking] = await Promise.all([
        persistStemFile('karaoke-split', `stems/kmv-${hash}-lead.flac`, lead, 'audio/flac'),
        backing ? persistStemFile('karaoke-split', `stems/kmv-${hash}-backing.flac`, backing, 'audio/flac') : Promise.resolve(null),
      ])
      console.log(`[karaoke-split] admin: MVSEP karaoke job ${hash} done in ${Math.round(elapsedMs / 1000)}s (stored: lead ${!!persistedLead}, backing ${!!persistedBacking})`)
      return NextResponse.json({
        status: 'succeeded',
        leadVocalsUrl: persistedLead?.url ?? lead,
        backingVocalsUrl: persistedBacking?.url ?? backing,
        ...(persistedLead ? { leadVocalsPath: persistedLead.path } : {}),
        ...(persistedBacking ? { backingVocalsPath: persistedBacking.path } : {}),
      })
    }

    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const prediction = await replicate.predictions.get(id)

    if (prediction.status === 'succeeded') {
      logReplicateTiming('karaoke-split', prediction)
      logReplicateStageTiming('karaoke', prediction)
      const output = prediction.output as Record<string, unknown> | null
      const leadVocalsUrl = toUrlString(output?.mdx_vocals)
      const backingVocalsUrl = toUrlString(output?.mdx_instrumental)

      // Lead is the stem we actually swap — if it's missing the split is
      // unusable, so report failure and let the caller fall back.
      if (!leadVocalsUrl) {
        return NextResponse.json(
          { status: 'failed', error: `Could not parse lead vocals from output. Shape: ${safeStringify(prediction.output)}` },
          { status: 502 }
        )
      }

      // backingVocalsUrl may legitimately be '' (e.g. parse miss); still usable —
      // caller swaps the lead and simply has no backing to fold into the bed.
      //
      // Buffer both stems into durable storage so voice-convert (and the
      // full-song mix) can re-sign fresh URLs after the Replicate URLs expire
      // (~1h) — the lead is the DEFAULT input to a single-voice swap, so a
      // stale cached leadVocalsUrl previously went to RVC unchecked. Soft-
      // fallback per stem: on persist failure return the ephemeral URL and
      // omit that stem's path (callers behave as before).
      const [persistedLead, persistedBacking] = await Promise.all([
        persistStemFile('karaoke-split', `stems/${id}-lead.mp3`, leadVocalsUrl),
        backingVocalsUrl
          ? persistStemFile('karaoke-split', `stems/${id}-backing.mp3`, backingVocalsUrl)
          : Promise.resolve(null),
      ])
      return NextResponse.json({
        status: 'succeeded',
        leadVocalsUrl: persistedLead?.url ?? leadVocalsUrl,
        backingVocalsUrl: persistedBacking?.url ?? backingVocalsUrl,
        ...(persistedLead ? { leadVocalsPath: persistedLead.path } : {}),
        ...(persistedBacking ? { backingVocalsPath: persistedBacking.path } : {}),
      })
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      return NextResponse.json({ status: prediction.status, error: safeStringify(prediction.error) })
    }

    return NextResponse.json({ status: prediction.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[karaoke-split] poll error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
