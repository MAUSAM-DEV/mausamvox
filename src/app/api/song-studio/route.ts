import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { ADMIN_EMAILS } from '@/lib/admin'
import {
  songEngine,
  isMiniMaxEngine,
  autoDurationSeconds,
  engineMaxSeconds,
  withVocalStyle,
  SONG_VOCALS,
  SONG_AGES,
  type SongVocals,
  type SongAge,
  ACE_STEP_VERSION,
  SONG_STUDIO_CREDITS,
  SONG_MIN_SECONDS,
  SONG_TITLE_MAX_CHARS,
  UNTITLED_SONG,
  resolveSongTitle,
  songStyleLabel,
} from '@/lib/song-engine'
import { limitTruePeak, measureAudioSeconds, trimWithFadeOut } from '@/lib/audio-length'
import { composeSongElevenLabs } from '@/lib/song-engine-elevenlabs'
import { buildMiniMaxInput, MINIMAX_MAX_LYRICS_CHARS, MINIMAX_VERSION, MINIMAX_26_VERSION } from '@/lib/song-engine-minimax'
import { buildLyriaPrompt, isLyriaBlocked, LYRIA_BLOCKED_MSG, LYRIA_MODEL, LYRIA_VERSION } from '@/lib/song-engine-lyria'
import { normalizeLoudness } from '@/lib/loudness'

// Song Studio: AI full-song generation — engine selected by SONG_ENGINE (see
// song-engine.ts): 'lyria' (Google Lyria 3 Pro), 'minimax' / 'minimax26'
// (MiniMax Music 2.5 / 2.6), 'acestep' (also the fallback for an unset or
// unrecognised value) — all on Replicate with the same create+poll flow —
// or 'elevenlabs' (synchronous).
//
// "Make 2 versions": POST charges SONG_STUDIO_CREDITS PER SONG (one atomic
// deduct_credits() call each) and starts one prediction per song; each job
// then refunds itself independently if it fails (same marker-row rule).
//
// elevenlabs: the API returns audio bytes synchronously, so POST does the
// whole job (charge → compose → persist) and returns the finished song; the
// client skips polling when POST already carries status='succeeded'.
//
// acestep: POST creates the Replicate prediction and returns immediately;
// GET is the status poll (stem-split's create+poll shape, so the client
// never hits a 504). The GET path is ACE-Step-only.
//
// Credits follow the gender-split charge+refund pattern: deduct_credits()
// atomically BEFORE the paid Replicate work (each run costs real money), and
// add_credits() refunds if the job fails or never starts — a failed generation
// is never charged. Refund idempotency across repeated polls of the same
// failed prediction rides on voice_swaps' unique replicate_prediction_id
// index: the failure marker row (result_path null, invisible to every list
// query) inserts exactly once, and only that first insert refunds.
//
// On success the audio is copied into the voice-swaps bucket and a
// kind='song_studio' row is inserted, so the result is a normal saved track:
// playable through the sign-on-read proxy (never expires), listed in
// Recent/Saved Tracks, shareable, deletable, 90-day retention.
export const maxDuration = 60

// MiniMax target trimming: only when the song overshoots the target by more
// than this (a couple of seconds over isn't worth a re-encode), with a fade.
const TRIM_TOLERANCE_SECONDS = 3
const TRIM_FADE_SECONDS = 2.5

// ── User-facing errors never name the engine/model ──────────────────────────
// The raw reason (engine errors, missing keys, Replicate throttling) is logged
// server-side; the user sees plain language. See stripEngineNames().
const UNAVAILABLE_MSG = 'Song Studio is temporarily unavailable — please try again later.'
function publicCreateError(internal: string, refunded: boolean): string {
  const refund = refunded ? ' Your credits were refunded.' : ''
  if (/\b429\b|throttl|rate limit/i.test(internal)) return `Song Studio is busy right now — please try again in a minute.${refund}`
  if (/timed out|timeout|abort/i.test(internal)) return `The song took too long to create.${refund} Please try again.`
  return `The song couldn’t be created.${refund} Please try again.`
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Generous input caps — validation, not creativity limits.
const MAX_LYRICS_CHARS = 5000
const MAX_TAGS_CHARS = 300

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

// Best-effort atomic refund — never throws; a failed refund must not mask the
// original error (mirrors gender-split's refundCredits).
async function refundCredits(userId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('add_credits', {
      p_user_id: userId,
      p_amount: SONG_STUDIO_CREDITS,
    })
    if (error) console.error('[song-studio] refund failed:', error.message)
  } catch (err) {
    console.error('[song-studio] refund threw:', err instanceof Error ? err.message : String(err))
  }
}

// Insert a voice_swaps row, tolerating a deploy that outruns a migration:
// if Postgres/PostgREST rejects an OPTIONAL column it doesn't know yet
// (`kind` — 20260712000003, `duration_seconds` — 20261002000001), retry the
// same row without it (the row is then unlabeled / length-less but works).
const OPTIONAL_COLUMNS = ['duration_seconds', 'kind'] as const
async function insertSwapRow(row: Record<string, unknown>): Promise<{ error: { code?: string; message: string } | null }> {
  let current = { ...row }
  let result = await supabaseAdmin.from('voice_swaps').insert(current)
  for (const col of OPTIONAL_COLUMNS) {
    if (!result.error || !(col in current) || !result.error.message.includes(col)) continue
    const { [col]: _dropped, ...rest } = current
    current = rest
    console.warn(`[song-studio] voice_swaps.${col} missing — saved without it (apply its migration)`)
    result = await supabaseAdmin.from('voice_swaps').insert(current)
  }
  return result
}

// Replicate prediction create with one polite retry on 429. The account is
// throttled to 1-burst / 6 per minute while its credit is under $5, so the
// 2nd version of "Make 2 versions" can hit it; wait the advertised
// retry_after (capped) and try again. Anything else throws to the caller.
async function createPrediction(replicate: Replicate, version: string, input: Record<string, unknown>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await replicate.predictions.create({ version, input })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (attempt >= 2 || !/\b429\b|throttl/i.test(msg)) throw err
      const wait = Math.min(15, Number(msg.match(/"retry_after":\s*(\d+)/)?.[1] ?? 10)) + 1
      console.warn(`[song-studio] create throttled (429) — retrying in ${wait}s`)
      await new Promise((r) => setTimeout(r, wait * 1000))
    }
  }
}

// ── POST: validate → deduct → create the prediction(s) ──────────────────────
export async function POST(req: NextRequest) {
  // Charges taken but not yet owned by a STARTED job (a started job refunds
  // itself on failure via GET). Every exit path before that refunds these.
  let unstartedCharges = 0
  let chargedUserId: string | null = null
  const refundUnstarted = async () => {
    while (chargedUserId && unstartedCharges > 0) { unstartedCharges--; await refundCredits(chargedUserId) }
  }
  try {
    if (!adminConfigured) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    const engine = songEngine()
    // Config gates BEFORE any charge — a misconfigured engine must cost nothing.
    if ((engine === 'acestep' || isMiniMaxEngine(engine) || engine === 'lyria') && !process.env.REPLICATE_API_TOKEN) {
      console.error('[song-studio] REPLICATE_API_TOKEN not configured')
      return NextResponse.json({ error: UNAVAILABLE_MSG }, { status: 500 })
    }
    if (engine === 'elevenlabs' && !process.env.ELEVENLABS_API_KEY) {
      console.error('[song-studio] ELEVENLABS_API_KEY not configured (or set SONG_ENGINE=acestep)')
      return NextResponse.json({ error: UNAVAILABLE_MSG }, { status: 500 })
    }

    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    let body: {
      lyrics?: string; stylePrompt?: string; duration?: number | null; title?: string; vocals?: string
      age?: string; versions?: number; lengthMode?: 'auto' | 'fixed'
    }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    let lyrics = (body.lyrics ?? '').trim()
    const stylePrompt = (body.stylePrompt ?? '').trim()
    const duration = body.duration
    // The song's name everywhere. The user's title (as typed — never
    // filtered); else the first lyric line; else "Untitled song" — never the
    // style text. Stored with each Replicate job in song_studio_jobs so the
    // GET save uses it regardless of who polls.
    const title = resolveSongTitle(body.title, lyrics)

    // Vocal + age selectors (optional — older clients don't send them).
    if (body.vocals !== undefined && !SONG_VOCALS.includes(body.vocals as SongVocals)) {
      return NextResponse.json({ error: `vocals must be one of: ${SONG_VOCALS.join(', ')}` }, { status: 400 })
    }
    const vocals = body.vocals as SongVocals | undefined
    if (body.age !== undefined && !SONG_AGES.includes(body.age as SongAge)) {
      return NextResponse.json({ error: `age must be one of: ${SONG_AGES.join(', ')}` }, { status: 400 })
    }
    const age = (body.age as SongAge | undefined) ?? 'auto'
    // "Make 2 versions" (create+poll engines only; elevenlabs is synchronous).
    const versions = body.versions === 2 && engine !== 'elevenlabs' ? 2 : 1

    // Instrumental = nothing is sung. MiniMax: empty lyrics → [Inst]; Lyria:
    // an "instrumental only" prompt with no lyrics block; ACE-Step/ElevenLabs
    // keep their documented [instrumental] convention.
    const instrumental = vocals === 'instrumental'
    if (instrumental) lyrics = isMiniMaxEngine(engine) || engine === 'lyria' ? '' : '[instrumental]'

    // MiniMax needs no lyrics (it generates an instrumental); the others need
    // them unless the song is instrumental.
    if (!lyrics && !isMiniMaxEngine(engine) && !instrumental) {
      return NextResponse.json({ error: 'Lyrics are required — use [instrumental] for a song without vocals' }, { status: 400 })
    }
    const maxLyrics = isMiniMaxEngine(engine) ? MINIMAX_MAX_LYRICS_CHARS : MAX_LYRICS_CHARS
    if (lyrics.length > maxLyrics) {
      return NextResponse.json({ error: `Lyrics are too long (max ${maxLyrics} characters)` }, { status: 400 })
    }
    if (!stylePrompt) {
      return NextResponse.json({ error: 'A style prompt is required (e.g. "lo-fi hip hop, chill, female vocals")' }, { status: 400 })
    }
    if (stylePrompt.length > MAX_TAGS_CHARS) {
      return NextResponse.json({ error: `Style prompt is too long (max ${MAX_TAGS_CHARS} characters)` }, { status: 400 })
    }
    // ── Length ("Auto + slider") ────────────────────────────────────────────
    // lengthMode 'auto'  → acestep/elevenlabs: duration picked from the lyrics;
    //                      minimax/lyria: no target (length follows the song).
    // lengthMode 'fixed' → `duration` seconds within the engine's range — a
    // real duration for acestep/elevenlabs, a TARGET for minimax/lyria (asked
    // for in words; trimmed with a fade if longer; never stretched).
    // No lengthMode = a legacy client: acestep/elevenlabs use `duration` as
    // before; minimax/lyria IGNORE it (old tabs send a hidden duration).
    const targetEngine = isMiniMaxEngine(engine) || engine === 'lyria'
    const maxSeconds = engineMaxSeconds(engine)
    const fixed = body.lengthMode === 'fixed' || (body.lengthMode === undefined && !targetEngine)
    if (fixed && (
      typeof duration !== 'number' || !Number.isFinite(duration) ||
      duration < SONG_MIN_SECONDS || duration > maxSeconds
    )) {
      return NextResponse.json({ error: `Length must be ${SONG_MIN_SECONDS}-${maxSeconds} seconds` }, { status: 400 })
    }
    const finalStyle = withVocalStyle(stylePrompt, vocals, age)
    // Seconds handed to engines that take a real duration.
    const engineSeconds = fixed ? Math.round(duration as number) : autoDurationSeconds(lyrics, engine)
    // MiniMax / Lyria target (null = Auto).
    const targetSeconds = targetEngine && fixed ? Math.round(duration as number) : null

    // ── Charge BEFORE the paid work — once PER SONG (atomic each) ───────────
    const isAdmin = ADMIN_EMAILS.includes(user.email ?? '')
    if (!isAdmin) {
      chargedUserId = user.id
      for (let i = 0; i < versions; i++) {
        const { error: debitError } = await supabaseAdmin.rpc('deduct_credits', {
          p_user_id: user.id,
          p_amount: SONG_STUDIO_CREDITS,
        })
        if (debitError) {
          await refundUnstarted() // a 2nd-song failure gives back the 1st charge
          if (debitError.message.includes('INSUFFICIENT_CREDITS')) {
            return NextResponse.json({
              error: versions === 2 ? `Not enough credits for 2 versions (${versions * SONG_STUDIO_CREDITS} cr).` : 'Insufficient credits',
            }, { status: 402 })
          }
          console.error('[song-studio] debit failed:', debitError.message)
          return NextResponse.json({ error: 'Failed to deduct credits' }, { status: 500 })
        }
        unstartedCharges++
      }
    }

    // ── elevenlabs: synchronous compose → persist → done ────────────────────
    if (engine === 'elevenlabs') {
      const audioBuffer = await composeSongElevenLabs(
        { stylePrompt: finalStyle, lyrics, durationSeconds: engineSeconds },
        '[song-studio]'
      )
      // No loudness pass here (deliberate): ElevenLabs output is already
      // mastered — running loudnorm again risks double-compression. The
      // normalizeLoudness helper stays for the ACE-Step path below.
      const finalSeconds = await measureAudioSeconds(audioBuffer, 'mp3')
      console.log(`[song-studio] length: elevenlabs requested ${engineSeconds}s → actual ${finalSeconds ?? '?'}s`)

      const swapId = crypto.randomUUID()
      const swapPath = `${user.id}/${swapId}.mp3`
      const { error: uploadError } = await supabaseAdmin.storage
        .from('voice-swaps')
        .upload(swapPath, audioBuffer, { contentType: 'audio/mpeg', upsert: true })
      if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`)

      const { error: insertError } = await insertSwapRow({
        id: swapId,
        user_id: user.id,
        song_name: title,
        voice_used: songStyleLabel(finalStyle),
        result_path: swapPath,
        // Satisfies the column + its unique index; 'el-' namespace can never
        // collide with real Replicate prediction ids.
        replicate_prediction_id: `el-${swapId}`,
        kind: 'song_studio',
        duration_seconds: finalSeconds,
      })
      if (insertError) {
        await supabaseAdmin.storage.from('voice-swaps').remove([swapPath]).catch(() => {})
        throw new Error(`Could not save the song: ${insertError.message}`)
      }

      unstartedCharges = 0 // the song exists — the charge is earned
      console.log(`[song-studio] elevenlabs song persisted as swap ${swapId} (${audioBuffer.length} bytes, user ${user.id})`)
      return NextResponse.json({
        status: 'succeeded',
        swapId,
        url: `/api/voice-swaps/${swapId}/result.mp3`,
      })
    }

    // ── Replicate engines (lyria / minimax / minimax26 / acestep) ───────────
    // One prediction per song. A started job owns its charge (GET refunds it
    // if the job fails); a job that fails to START is refunded right here.
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const { version, input } =
      engine === 'lyria'
        ? { version: LYRIA_VERSION, input: { prompt: buildLyriaPrompt({ style: finalStyle, lyrics, instrumental, targetSeconds }) } }
        : isMiniMaxEngine(engine)
          ? { version: engine === 'minimax26' ? MINIMAX_26_VERSION : MINIMAX_VERSION, input: buildMiniMaxInput(lyrics, finalStyle, targetSeconds) }
          : { version: ACE_STEP_VERSION, input: { tags: finalStyle, lyrics, duration: engineSeconds } }

    const started: { predictionId: string; title: string }[] = []
    let lastStartError = ''
    for (let i = 0; i < versions; i++) {
      const songTitle = i === 0 ? title : `${title} (version 2)`.slice(0, SONG_TITLE_MAX_CHARS)
      let prediction: Awaited<ReturnType<typeof createPrediction>>
      try {
        prediction = await createPrediction(replicate, version, input)
      } catch (err) {
        lastStartError = err instanceof Error ? err.message : String(err)
        console.error(`[song-studio] ${engine} create failed (song ${i + 1}/${versions}):`, lastStartError)
        if (chargedUserId && unstartedCharges > 0) { unstartedCharges--; await refundCredits(chargedUserId) }
        continue
      }
      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        lastStartError = safeStringify(prediction.error)
        console.error(`[song-studio] ${engine} prediction failed to start (song ${i + 1}/${versions}):`, lastStartError)
        if (chargedUserId && unstartedCharges > 0) { unstartedCharges--; await refundCredits(chargedUserId) }
        continue
      }
      if (chargedUserId && unstartedCharges > 0) unstartedCharges-- // the started job owns it now
      started.push({ predictionId: prediction.id, title: songTitle })

      // Store the job's title/style/target server-side (best-effort — never
      // fails a started, paid job; GET falls back to the poll's query params).
      const { error: jobError } = await supabaseAdmin.from('song_studio_jobs').insert({
        prediction_id: prediction.id,
        user_id: user.id,
        title: songTitle,
        style: finalStyle,
        target_seconds: targetSeconds,
      })
      if (jobError) console.warn(`[song-studio] job record not stored (${jobError.message}) — title falls back to the poll; apply migration 20261002000002`)
      const lengthNote = targetEngine
        ? (targetSeconds ? `target ${targetSeconds}s` : 'length follows the song')
        : `${engineSeconds}s${fixed ? '' : ' (auto)'}`
      console.log(`[song-studio] started ${engine} prediction ${prediction.id} "${songTitle}" (${lengthNote}, user ${user.id})`)
    }

    if (started.length === 0) {
      const blocked = engine === 'lyria' && isLyriaBlocked(lastStartError)
      const refunded = chargedUserId !== null
      return NextResponse.json({
        error: blocked
          ? `${LYRIA_BLOCKED_MSG}${refunded ? ' Your credits were refunded.' : ''}`
          : publicCreateError(lastStartError, refunded),
        refunded,
      }, { status: 502 })
    }

    // targetSeconds goes back so the client's poll can ask GET to trim.
    return NextResponse.json({
      predictions: started,
      predictionId: started[0].predictionId, // legacy single-song clients
      title: started[0].title,
      status: 'starting',
      targetSeconds,
      partial: started.length < versions, // one version couldn't start (refunded)
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[song-studio] create error:', msg)
    // Any failure after a debit that no started job owns yet (elevenlabs
    // compose/persist, or a throw before a prediction started) — refund it.
    const refunded = chargedUserId !== null && unstartedCharges > 0
    await refundUnstarted()
    return NextResponse.json({ error: publicCreateError(msg, refunded), refunded }, { status: 500 })
  }
}

// ── GET: poll → on success persist + return the durable proxy URL ───────────
// ACE-Step (Replicate) predictions only — the elevenlabs engine finishes
// inside POST and never polls. Kept fully intact for SONG_ENGINE=acestep and
// for any prediction still in flight across an engine flip.
// Query: id (prediction id); title/style/target are FALLBACKS only — the
// values stored with the job in song_studio_jobs at POST time win.
export async function GET(req: NextRequest) {
  try {
    if (!adminConfigured) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    if (!process.env.REPLICATE_API_TOKEN) {
      console.error('[song-studio] REPLICATE_API_TOKEN not configured')
      return NextResponse.json({ error: UNAVAILABLE_MSG }, { status: 500 })
    }

    const sessionClient = await createClient()
    const { data: { user } } = await sessionClient.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    const id = req.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }
    // The job's own record (stored at POST). Its title/style/target win over
    // the query string, so a save from a resumed tab, another device or a
    // recovery link still uses the user's title. Missing table/row (pre-
    // migration, or a job started before it) → query params, as before.
    const { data: job, error: jobReadError } = await supabaseAdmin
      .from('song_studio_jobs')
      .select('user_id, title, style, target_seconds')
      .eq('prediction_id', id)
      .maybeSingle()
    if (jobReadError) console.warn('[song-studio] job record unreadable, using poll params:', jobReadError.message)
    // Someone else's job: never save it into (or refund it to) this account.
    if (job && job.user_id !== user.id) {
      return NextResponse.json({ error: 'This song belongs to another account' }, { status: 403 })
    }

    const queryTitle = (req.nextUrl.searchParams.get('title') ?? '').trim().slice(0, SONG_TITLE_MAX_CHARS)
    const title = job?.title || queryTitle || UNTITLED_SONG // users' own titles are never filtered
    const stylePrompt = (job?.style ?? req.nextUrl.searchParams.get('style') ?? '').trim().slice(0, MAX_TAGS_CHARS)
    // MiniMax / Lyria target length (seconds); anything outside the slider
    // range is ignored (= no trim).
    const targetRaw = job ? Number(job.target_seconds) : Number(req.nextUrl.searchParams.get('target'))
    const targetSeconds = Number.isFinite(targetRaw) && targetRaw >= SONG_MIN_SECONDS && targetRaw <= engineMaxSeconds('minimax')
      ? Math.round(targetRaw) : null
    const isAdmin = ADMIN_EMAILS.includes(user.email ?? '')

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const prediction = await replicate.predictions.get(id)

    if (prediction.status === 'succeeded') {
      // Idempotency: a re-poll (or double-tab) of an already-persisted
      // generation returns the existing row instead of storing twice.
      const { data: existing } = await supabaseAdmin
        .from('voice_swaps')
        .select('id, result_path')
        .eq('replicate_prediction_id', id)
        .maybeSingle()
      if (existing) {
        if (!existing.result_path) {
          // The marker row from an earlier failure poll — a prediction can't
          // fail then succeed, so this is unreachable in practice; answer
          // honestly if it ever happens.
          return NextResponse.json({ status: 'failed', error: 'This generation was already marked failed' })
        }
        return NextResponse.json({
          status: 'succeeded',
          swapId: existing.id,
          url: `/api/voice-swaps/${existing.id}/result.mp3`,
        })
      }

      const outputUrl = typeof prediction.output === 'string' ? prediction.output : null
      if (!outputUrl) {
        console.error(`[song-studio] could not parse output for ${id}:`, safeStringify(prediction.output))
        return NextResponse.json(
          { status: 'failed', error: 'The finished song couldn’t be read — please try again.' },
          { status: 502 }
        )
      }

      // Copy the ephemeral Replicate output into durable storage (the
      // voice-swaps bucket), then serve it forever via the sign-on-read proxy.
      const audioRes = await fetch(outputUrl)
      if (!audioRes.ok) {
        return NextResponse.json({ status: 'failed', error: `Output download failed (http ${audioRes.status})` }, { status: 502 })
      }
      const rawBuffer = Buffer.from(await audioRes.arrayBuffer())
      const ext = new URL(outputUrl).pathname.split('.').pop()?.toLowerCase() === 'mp3' ? 'mp3' : 'wav'
      // Post-processing is decided from the prediction's OWN model, so a job in
      // flight across an engine flip is still handled correctly:
      //  • Lyria   — NO EQ / compression / loudness change: only a true-peak
      //              limiter (it ships above 0 dBTP), 320 kbps MP3; a target
      //              trims longer songs with a fade in the same pass. Limiter
      //              failure keeps the original (never fails a paid song).
      //  • MiniMax — already mastered (−11.5 LUFS measured): trim-to-target only.
      //  • ACE-Step — comes back much quieter than the rest of the app:
      //              loudness-normalized (falls back to raw on failure).
      // Shorter-than-target songs are never stretched or slowed.
      const model = prediction.model ?? ''
      const isLyria = model === LYRIA_MODEL
      const isMiniMax = model.startsWith('minimax/')
      let audioBuffer: Buffer = rawBuffer
      let saveExt = ext
      let rawSeconds: number | null = null
      let finalSeconds: number | null = null
      let note = ''
      if (isLyria) {
        rawSeconds = await measureAudioSeconds(rawBuffer, ext)
        const trimTo = targetSeconds && rawSeconds !== null && rawSeconds > targetSeconds + TRIM_TOLERANCE_SECONDS ? targetSeconds : null
        const limited = await limitTruePeak(rawBuffer, ext, { trimTo, fadeSeconds: TRIM_FADE_SECONDS })
        if (limited) {
          audioBuffer = limited.buffer
          saveExt = 'mp3'
          finalSeconds = limited.seconds ?? (await measureAudioSeconds(limited.buffer, 'mp3'))
          note = `true peak ${limited.truePeak} dBTP (ceiling ${limited.ceiling})${trimTo ? `, trimmed to ${trimTo}s` : ''}`
        } else {
          finalSeconds = rawSeconds
          note = 'limiter failed — original kept'
        }
      } else if (isMiniMax) {
        finalSeconds = rawSeconds = await measureAudioSeconds(audioBuffer, ext)
        if (targetSeconds && finalSeconds !== null && finalSeconds > targetSeconds + TRIM_TOLERANCE_SECONDS) {
          const trimmed = await trimWithFadeOut(audioBuffer, ext, targetSeconds, TRIM_FADE_SECONDS)
          if (trimmed) {
            audioBuffer = trimmed
            finalSeconds = (await measureAudioSeconds(trimmed, ext)) ?? targetSeconds
            note = `trimmed to ${targetSeconds}s`
          }
        }
      } else {
        audioBuffer = await normalizeLoudness(rawBuffer, ext, '[song-studio]')
        finalSeconds = rawSeconds = await measureAudioSeconds(audioBuffer, ext)
      }
      console.log(`[song-studio] length: ${isLyria ? 'lyria' : isMiniMax ? 'minimax' : 'acestep'} raw ${rawSeconds ?? '?'}s → final ${finalSeconds ?? '?'}s` +
        `${targetSeconds && (isLyria || isMiniMax) ? ` (target ${targetSeconds}s)` : ''}${note ? ` · ${note}` : ''}`)
      const swapId = crypto.randomUUID()
      const swapPath = `${user.id}/${swapId}.${saveExt}`

      const { error: uploadError } = await supabaseAdmin.storage
        .from('voice-swaps')
        .upload(swapPath, audioBuffer, { contentType: saveExt === 'mp3' ? 'audio/mpeg' : 'audio/wav', upsert: true })
      if (uploadError) {
        return NextResponse.json({ status: 'failed', error: `Storage upload failed: ${uploadError.message}` }, { status: 500 })
      }

      const { error: insertError } = await insertSwapRow({
        id: swapId,
        user_id: user.id,
        song_name: title,
        voice_used: songStyleLabel(stylePrompt),
        result_path: swapPath,
        replicate_prediction_id: id,
        kind: 'song_studio',
        duration_seconds: finalSeconds,
      })
      if (insertError) {
        if (insertError.code === '23505') {
          // Lost a persist race with a concurrent poll — return the winner.
          const { data: winner } = await supabaseAdmin
            .from('voice_swaps').select('id').eq('replicate_prediction_id', id).maybeSingle()
          // Our orphaned upload: best-effort cleanup.
          await supabaseAdmin.storage.from('voice-swaps').remove([swapPath]).catch(() => {})
          if (winner) {
            return NextResponse.json({ status: 'succeeded', swapId: winner.id, url: `/api/voice-swaps/${winner.id}/result.mp3` })
          }
        }
        console.error('[song-studio] row insert failed:', insertError.message)
        return NextResponse.json({ status: 'failed', error: `Could not save the song: ${insertError.message}` }, { status: 500 })
      }

      console.log(`[song-studio] prediction ${id} persisted as swap ${swapId} (${audioBuffer.length} bytes)`)
      return NextResponse.json({
        status: 'succeeded',
        swapId,
        url: `/api/voice-swaps/${swapId}/result.mp3`,
      })
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      const errMsg = safeStringify(prediction.error)
      console.error(`[song-studio] prediction ${id} ${prediction.status}:`, errMsg)
      // Refund exactly once across repeated polls: the failure marker row
      // (result_path null — excluded from all lists) can only insert once
      // thanks to the unique replicate_prediction_id index.
      if (!isAdmin) {
        const { error: markerError } = await insertSwapRow({
          id: crypto.randomUUID(),
          user_id: user.id,
          song_name: title,
          voice_used: 'AI generated (failed)',
          result_path: null,
          replicate_prediction_id: id,
          kind: 'song_studio',
        })
        if (!markerError) {
          await refundCredits(user.id)
          console.log(`[song-studio] refunded ${SONG_STUDIO_CREDITS} cr for failed prediction ${id}`)
        } else if (markerError.code !== '23505') {
          // Marker insert failed for a non-duplicate reason — refund anyway
          // rather than risk keeping a charge for failed work.
          console.error('[song-studio] refund marker insert failed:', markerError.message)
          await refundCredits(user.id)
        }
      }
      // errMsg (the engine's raw error) stays in the log above — never shown.
      // A Lyria safety-filter block gets the friendly "change the lyrics or
      // style" message; everything else the generic one. Both refunded.
      const blocked = (prediction.model ?? '') === LYRIA_MODEL && isLyriaBlocked(errMsg)
      return NextResponse.json({ status: prediction.status, error: blocked ? LYRIA_BLOCKED_MSG : 'The song couldn’t be generated.', refunded: !isAdmin, blocked })
    }

    // starting / processing — client keeps polling
    return NextResponse.json({ status: prediction.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[song-studio] poll error:', msg)
    return NextResponse.json({ error: 'Couldn’t check on your song right now.' }, { status: 500 })
  }
}
