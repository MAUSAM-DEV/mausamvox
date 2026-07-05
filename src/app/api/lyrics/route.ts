import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'
import { ADMIN_EMAILS } from '@/lib/admin'
import { logReplicateTiming } from '@/lib/replicate-timing'

export const maxDuration = 30

// Timed-lyrics transcription for Performance Mode (v1, single-color).
//
// POST  { stemPath, language?, force? } → { cached: true, lyrics } if a row
//                                        already exists for this user+stem,
//                                        else { predictionId } (client polls).
//                                        force: true skips the cache check —
//                                        the regenerate flow deliberately
//                                        re-transcribes an already-stored track.
// GET   ?stemPath=…                    → stored lyrics, or 404
// GET   ?id=…&stemPath=…&language=…[&force=1]
//                                      → poll; on success parses the chunks,
//                                        stores the row (force = REPLACES the
//                                        existing row in place, wiping edits),
//                                        charges credits, returns { status, lyrics }
// PATCH { stemPath, lines }            → user edit (text fixes / line
//                                        deletions), sets edited = true
//
// Engine: vaibhavs10/incredibly-fast-whisper (Whisper large-v3) with
// timestamp: 'chunk' — phrase-level lines are exactly the granularity the
// overlay highlights, and its native word timestamps (no per-language
// alignment model) keep a word-level upgrade path open for every language,
// unlike WhisperX's aligner (no Tamil/Bengali/Punjabi/Marathi).
//
// track_lyrics access follows the voice_swaps pattern: no RLS, service_role
// admin client, ownership enforced in app code via .eq('user_id', …).
// Stem paths themselves are session-gated but not per-user (same exposure as
// /api/stems/download); the transcription is keyed AND charged to the caller.
const WHISPER_VERSION = '3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c'
const LYRICS_COST = 25

// UI hint values → the cog's language enum ('None' = auto-detect).
// 'hindi-rom' and 'hindi-deva' both transcribe with language=hindi; the -rom
// variant then transliterates the Devanagari output to Latin server-side
// before storing (src/lib/romanize.ts). The stored track_lyrics.language is
// the UI hint value itself, so each row records which variant (language +
// script) it was generated with. 'hindi' is the legacy pre-romanization value
// (kept for old rows' labels; no longer offered by the UI).
const LANGUAGE_MAP: Record<string, string> = {
  auto: 'None',
  'hindi-rom': 'hindi',
  'hindi-deva': 'hindi',
  hindi: 'hindi',
  english: 'english',
}

export type LyricLine = { start: number; end: number; text: string }

function validStemPath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && p.length < 512 && !p.includes('..')
}

// incredibly-fast-whisper output: { text, chunks: [{ text, timestamp: [start, end] }] }.
// The final chunk's end is occasionally null — fall back to start + 3s.
function parseChunks(output: unknown): LyricLine[] {
  const chunks = (output as { chunks?: Array<{ text?: unknown; timestamp?: unknown }> } | null)?.chunks
  if (!Array.isArray(chunks)) return []
  const lines: LyricLine[] = []
  for (const c of chunks) {
    const text = typeof c?.text === 'string' ? c.text.trim() : ''
    const ts = Array.isArray(c?.timestamp) ? c.timestamp : []
    const start = typeof ts[0] === 'number' && isFinite(ts[0]) ? ts[0] : null
    if (!text || start === null) continue
    const end = typeof ts[1] === 'number' && isFinite(ts[1]) && ts[1] > start ? ts[1] : start + 3
    lines.push({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, text })
  }
  lines.sort((a, b) => a.start - b.start)
  return lines
}

async function getUser() {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  return user
}

async function fetchExisting(userId: string, sourceKey: string) {
  const { data } = await supabaseAdmin
    .from('track_lyrics')
    .select('lines, language, edited')
    .eq('user_id', userId)
    .eq('source_key', sourceKey)
    .maybeSingle()
  return data ?? null
}

// ── POST: start (or short-circuit to the cached row) ────────────────────────
export async function POST(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
  if (!process.env.REPLICATE_API_TOKEN) return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })

  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let body: { stemPath?: unknown; language?: unknown; force?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (!validStemPath(body.stemPath)) return NextResponse.json({ error: 'stemPath is required' }, { status: 400 })
  const language = LANGUAGE_MAP[typeof body.language === 'string' ? body.language : 'auto'] ?? 'None'

  // Cached? Second Performance Mode open of the same track is instant + free.
  // Regenerate (force) skips this on purpose — the user confirmed a paid
  // re-transcription that will replace the stored row.
  if (body.force !== true) {
    const existing = await fetchExisting(user.id, body.stemPath)
    if (existing) return NextResponse.json({ cached: true, lyrics: existing.lines, language: existing.language, edited: existing.edited })
  }

  const { data: signed, error: signErr } = await supabaseAdmin.storage
    .from('audio-uploads')
    .createSignedUrl(body.stemPath, 21600)
  if (signErr || !signed?.signedUrl) {
    return NextResponse.json({ error: `Could not sign the vocal stem: ${signErr?.message ?? 'unknown'}` }, { status: 500 })
  }

  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  const prediction = await replicate.predictions.create({
    version: WHISPER_VERSION,
    input: {
      audio: signed.signedUrl,
      // Pinned: the cog also offers task 'translate' — never use it. NOTE this
      // pin can't stop translation when the language hint mismatches the sung
      // language: hint = Whisper's DECODE language, so 'english' on a Hindi
      // song still comes out (part-)translated. The UI copy owns that honesty.
      task: 'transcribe',
      language,
      timestamp: 'chunk', // phrase-level lines; 'word' kept for a future word-karaoke pass
      batch_size: 24,
    },
  })
  console.log(`[lyrics] started prediction ${prediction.id} (lang=${language}) for ${body.stemPath}`)
  return NextResponse.json({ predictionId: prediction.id, status: prediction.status })
}

// ── GET: fetch stored lyrics, or poll a running transcription ───────────────
export async function GET(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })

  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const stemPath = req.nextUrl.searchParams.get('stemPath')
  const id = req.nextUrl.searchParams.get('id')
  if (!validStemPath(stemPath)) return NextResponse.json({ error: 'stemPath is required' }, { status: 400 })

  // Plain fetch — no prediction id.
  if (!id) {
    const existing = await fetchExisting(user.id, stemPath)
    if (!existing) return NextResponse.json({ error: 'No lyrics stored for this track' }, { status: 404 })
    return NextResponse.json({ lyrics: existing.lines, language: existing.language, edited: existing.edited })
  }

  // Poll path.
  if (!process.env.REPLICATE_API_TOKEN) return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
  const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
  const prediction = await replicate.predictions.get(id)

  if (prediction.status === 'failed' || prediction.status === 'canceled') {
    const msg = typeof prediction.error === 'string' ? prediction.error : JSON.stringify(prediction.error)
    console.error(`[lyrics] prediction ${id} ${prediction.status}:`, msg)
    return NextResponse.json({ status: prediction.status, error: msg })
  }
  if (prediction.status !== 'succeeded') {
    return NextResponse.json({ status: prediction.status })
  }

  logReplicateTiming('lyrics', prediction)
  let lines = parseChunks(prediction.output)
  if (lines.length === 0) {
    // Honest failure: instrumental-only stems or hallucination filtering can
    // leave nothing usable. Nothing is stored and nothing is charged.
    return NextResponse.json({ status: 'failed', error: 'No lyrics could be transcribed from this vocal — it may be instrumental or too quiet.' })
  }

  const rawLang = req.nextUrl.searchParams.get('language') ?? 'auto'
  const language = LANGUAGE_MAP[rawLang] !== undefined ? rawLang : 'auto'

  // Romanized Hindi: transcribed with language=hindi (Devanagari out), then
  // transliterated to Latin before storing — the stored lines ARE the
  // romanized ones, so caching/editing/display need no script awareness.
  if (language === 'hindi-rom') {
    const { romanizeDevanagari } = await import('@/lib/romanize')
    lines = lines
      .map((l) => ({ ...l, text: romanizeDevanagari(l.text) }))
      .filter((l) => l.text.length > 0) // a line that was ONLY danda marks romanizes to ''
    if (lines.length === 0) {
      return NextResponse.json({ status: 'failed', error: 'No lyrics could be transcribed from this vocal — it may be instrumental or too quiet.' })
    }
  }
  const force = req.nextUrl.searchParams.get('force') === '1'
  const engine = `vaibhavs10/incredibly-fast-whisper:${WHISPER_VERSION.slice(0, 8)}`

  if (force) {
    // Regenerate: REPLACE the stored row in place — same (user_id, source_key)
    // key, upsert = INSERT … ON CONFLICT DO UPDATE, covered by the table's
    // existing insert+update grants (no new migration). Prior edits are
    // overwritten and `edited` resets — the client's confirm dialog warned
    // about exactly this. Charged again below like a fresh run.
    const { error: upsertError } = await supabaseAdmin
      .from('track_lyrics')
      .upsert(
        { user_id: user.id, source_key: stemPath, language, engine, lines, edited: false },
        { onConflict: 'user_id,source_key' },
      )
    if (upsertError) {
      console.error('[lyrics] regenerate upsert failed:', upsertError.message)
      return NextResponse.json({ error: `Could not store lyrics: ${upsertError.message}` }, { status: 500 })
    }
  } else {
    const { error: insertError } = await supabaseAdmin
      .from('track_lyrics')
      .insert({ user_id: user.id, source_key: stemPath, language, engine, lines })

    if (insertError) {
      // Unique violation → a concurrent poll already stored (and charged) it.
      if (insertError.code === '23505') {
        const existing = await fetchExisting(user.id, stemPath)
        return NextResponse.json({ status: 'succeeded', lyrics: existing?.lines ?? lines })
      }
      console.error('[lyrics] insert failed:', insertError.message)
      return NextResponse.json({ error: `Could not store lyrics: ${insertError.message}` }, { status: 500 })
    }
  }

  // Charge AFTER a successful insert (the race loser above never charges) and
  // never on failure. Same read-then-update softness as the deduct route —
  // logged in PROJECT_STATUS. A charge failure doesn't take the lyrics away.
  if (!ADMIN_EMAILS.includes(user.email ?? '')) {
    try {
      const { data: u } = await supabaseAdmin
        .from('users')
        .select('credits_remaining')
        .eq('id', user.id)
        .single()
      if (u && u.credits_remaining >= LYRICS_COST) {
        await supabaseAdmin
          .from('users')
          .update({ credits_remaining: u.credits_remaining - LYRICS_COST })
          .eq('id', user.id)
      } else {
        console.warn(`[lyrics] balance too low to charge ${LYRICS_COST} — lyrics kept (transcription already ran)`)
      }
    } catch (err) {
      console.error('[lyrics] charge failed:', err instanceof Error ? err.message : String(err))
    }
  }

  console.log(`[lyrics] ${force ? 'regenerated (row replaced)' : 'stored'} ${lines.length} lines for ${stemPath}`)
  return NextResponse.json({ status: 'succeeded', lyrics: lines })
}

// ── PATCH: user edits — text fixes and line deletions, timestamps kept ──────
export async function PATCH(req: NextRequest) {
  if (!adminConfigured) return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })

  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  let body: { stemPath?: unknown; lines?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  if (!validStemPath(body.stemPath)) return NextResponse.json({ error: 'stemPath is required' }, { status: 400 })
  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 500) {
    return NextResponse.json({ error: 'lines must be a non-empty array' }, { status: 400 })
  }
  const lines: LyricLine[] = []
  for (const l of body.lines as Array<{ start?: unknown; end?: unknown; text?: unknown }>) {
    const start = typeof l?.start === 'number' && isFinite(l.start) ? l.start : null
    const end = typeof l?.end === 'number' && isFinite(l.end) ? l.end : null
    const text = typeof l?.text === 'string' ? l.text.trim().slice(0, 500) : ''
    if (start === null || end === null || !text) {
      return NextResponse.json({ error: 'Each line needs start, end and non-empty text' }, { status: 400 })
    }
    lines.push({ start, end, text })
  }

  const { data, error } = await supabaseAdmin
    .from('track_lyrics')
    .update({ lines, edited: true })
    .eq('user_id', user.id) // ownership gate — no RLS on this table
    .eq('source_key', body.stemPath)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[lyrics] edit failed:', error.message)
    return NextResponse.json({ error: `Could not save edits: ${error.message}` }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'No lyrics found to edit' }, { status: 404 })

  return NextResponse.json({ success: true, lyrics: lines })
}
