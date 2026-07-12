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
// timestamp: 'word' — one word per chunk. We regroup the words into
// phrase-level display lines (groupWordsIntoLines) exactly like before AND
// nest each word's timing under its line, so a single transcription serves
// both today's line display and the (deferred) word-level highlighter. Its
// native word timestamps need no per-language alignment model, unlike
// WhisperX's aligner (no Tamil/Bengali/Punjabi/Marathi).
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

// One transcribed word with its timing. Nested inside each line for the
// (deferred) word-level highlighting renderer; the line-level fields below
// are unchanged, so old rows (no `words`) and the current renderer keep
// working exactly as today.
export type WordTiming = { text: string; start: number; end: number }
export type LyricLine = { start: number; end: number; text: string; words?: WordTiming[] }

function validStemPath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && p.length < 512 && !p.includes('..')
}

const round2 = (n: number) => Math.round(n * 100) / 100

// incredibly-fast-whisper with timestamp: 'word' → { text, chunks: [{ text,
// timestamp: [start, end] }] } — SAME shape as 'chunk' mode, but one WORD per
// chunk. A word's end is occasionally null (last word / a boundary) — fall
// back to a short 0.4s so per-word highlighting still advances.
function parseWords(output: unknown): WordTiming[] {
  const chunks = (output as { chunks?: Array<{ text?: unknown; timestamp?: unknown }> } | null)?.chunks
  if (!Array.isArray(chunks)) return []
  const words: WordTiming[] = []
  for (const c of chunks) {
    const text = typeof c?.text === 'string' ? c.text.trim() : ''
    const ts = Array.isArray(c?.timestamp) ? c.timestamp : []
    const start = typeof ts[0] === 'number' && isFinite(ts[0]) ? ts[0] : null
    if (!text || start === null) continue
    const end = typeof ts[1] === 'number' && isFinite(ts[1]) && ts[1] > start ? ts[1] : start + 0.4
    words.push({ text, start: round2(start), end: round2(end) })
  }
  words.sort((a, b) => a.start - b.start)
  return words
}

// Group per-word timings back into the phrase-level display lines we render
// today. Word mode drops Whisper's own phrase segmentation, so we rebuild it
// heuristically: break on a silence gap, a hard cap on words/duration, or
// sentence-final punctuation. Each line keeps the joined word text (so it
// matches what we display and stays editable) PLUS the nested `words`.
const NEW_LINE_GAP_SECONDS = 0.8
const MAX_WORDS_PER_LINE = 9
const MAX_LINE_SECONDS = 8
const SENTENCE_END = /[.!?।॥]$/

function groupWordsIntoLines(words: WordTiming[]): LyricLine[] {
  const lines: LyricLine[] = []
  let cur: WordTiming[] = []
  const flush = () => {
    if (cur.length === 0) return
    const text = cur.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim()
    if (text) {
      lines.push({
        start: cur[0].start,
        end: cur[cur.length - 1].end,
        text,
        words: cur.map((w) => ({ ...w })),
      })
    }
    cur = []
  }
  for (const w of words) {
    if (cur.length > 0) {
      const prev = cur[cur.length - 1]
      const gap = w.start - prev.end
      const lineDuration = w.end - cur[0].start
      if (
        gap > NEW_LINE_GAP_SECONDS ||
        cur.length >= MAX_WORDS_PER_LINE ||
        lineDuration > MAX_LINE_SECONDS ||
        SENTENCE_END.test(prev.text)
      ) {
        flush()
      }
    }
    cur.push(w)
  }
  flush()
  return lines
}

// ── Conservative hum-hallucination filter ───────────────────────────────────
// Whisper invents repeated gibberish over non-verbal vocal stretches (humming,
// yodelling, held notes). We drop ONLY the clear machine signature: a run of
// the same normalized token — or a short A-B n-gram — crammed far denser than
// anything singable (high tokens/sec). Real repeated hooks (alaap, "la la la",
// "o o o", "na na na") are sung at a human pace and stay well under the density
// gate, so they survive. When unsure we KEEP the words; the edit modal is the
// backstop for whatever this misses (or, rarely, over-removes).
//
// Tunables — a run is stripped only when BOTH its repeat count AND its density
// clear the bar (report these when adjusting):
const HALLUCINATION_MIN_UNIGRAM_REPEATS = 6 // ≥6 identical tokens in a row
const HALLUCINATION_MIN_BIGRAM_REPEATS = 4  // ≥4 repeats of an A-B cycle (≥8 tokens)
const HALLUCINATION_MIN_DENSITY_TPS = 6     // AND ≥6 tokens/sec within that run

// Case- and Latin-diacritic-insensitive token; punctuation stripped. Only the
// Latin combining-marks block (U+0300–U+036F) is removed, so Devanagari matras
// stay intact and distinct Hindi syllables are not wrongly merged into a run.
function normToken(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // Latin combining diacritics (leaves Devanagari matras)
    .replace(/[\s'".,!?;:()[\]{}<>@#*_+=~`|/\\^%$&–—…।॥-]/g, '') // punctuation + whitespace
}

function dropHallucinatedWords(words: WordTiming[]): WordTiming[] {
  if (words.length < HALLUCINATION_MIN_UNIGRAM_REPEATS) return words
  const norm = words.map((w) => normToken(w.text))
  const drop = new Array<boolean>(words.length).fill(false)

  // Does the cycle norm[start .. start+k-1] repeat at position `pos`?
  const cycleAt = (start: number, pos: number, k: number): boolean => {
    for (let d = 0; d < k; d++) if (norm[pos + d] !== norm[start + d]) return false
    return true
  }

  for (const k of [1, 2] as const) {
    const minRepeats = k === 1 ? HALLUCINATION_MIN_UNIGRAM_REPEATS : HALLUCINATION_MIN_BIGRAM_REPEATS
    let i = 0
    while (i + k <= words.length) {
      // Punctuation-only tokens don't anchor a run.
      if (norm.slice(i, i + k).some((t) => t === '')) { i += 1; continue }
      // Extend the cycle as far as it keeps repeating.
      let end = i + k
      while (end + k <= words.length && cycleAt(i, end, k)) end += k
      const runLen = end - i
      const cycles = runLen / k
      if (cycles >= minRepeats) {
        const span = words[end - 1].end - words[i].start
        const density = span > 0 ? runLen / span : Infinity // crammed/degenerate = definitely garbage
        if (density >= HALLUCINATION_MIN_DENSITY_TPS) {
          for (let j = i; j < end; j++) drop[j] = true
        }
        i = end // skip past the whole run either way (it's one coherent repeat)
      } else {
        i += 1
      }
    }
  }

  const kept = words.filter((_, idx) => !drop[idx])
  const removed = words.length - kept.length
  if (removed > 0) console.log(`[lyrics] hum-filter dropped ${removed} repetitive token(s)`)
  return kept
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
      // Word-level timestamps: we regroup them into phrase lines server-side
      // (groupWordsIntoLines) AND nest each word under its line for the
      // word-highlighting renderer. One call, one charge, serves both.
      timestamp: 'word',
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

  // Passive probe: if the engine ever starts exposing confidence fields
  // (no_speech_prob / avg_logprob / compression_ratio), we learn for free.
  // Logs only — nothing branches on this.
  const out = prediction.output as { chunks?: Array<Record<string, unknown>> } | null
  console.log('[lyrics] output keys:', out && typeof out === 'object' ? Object.keys(out).join(',') : typeof out)
  const firstChunk = Array.isArray(out?.chunks) ? out?.chunks[0] : undefined
  if (firstChunk && typeof firstChunk === 'object') console.log('[lyrics] chunk keys:', Object.keys(firstChunk).join(','))

  const noLyrics = () => NextResponse.json({ status: 'failed', error: 'No lyrics could be transcribed from this vocal — it may be instrumental or too quiet.' })

  let words = parseWords(prediction.output)
  // Honest failure: instrumental-only stems or hallucination filtering can
  // leave nothing usable. Nothing is stored and nothing is charged.
  if (words.length === 0) return noLyrics()

  const rawLang = req.nextUrl.searchParams.get('language') ?? 'auto'
  const language = LANGUAGE_MAP[rawLang] !== undefined ? rawLang : 'auto'

  // Romanized Hindi: transcribed with language=hindi (Devanagari out), then
  // transliterated to Latin PER WORD before grouping — so romanize.ts's
  // whole-word corrections apply to each word, the nested word texts are the
  // romanized ones, and each line's text stays the join of its words. The
  // stored lines ARE romanized, so caching/editing/display need no script
  // awareness.
  if (language === 'hindi-rom') {
    const { romanizeDevanagari } = await import('@/lib/romanize')
    words = words
      .map((w) => ({ ...w, text: romanizeDevanagari(w.text) }))
      .filter((w) => w.text.length > 0) // a word that was ONLY danda marks romanizes to ''
    if (words.length === 0) return noLyrics()
  }

  // Drop the clear Whisper hum-hallucination signature at the WORD level (after
  // romanization, so it sees the final tokens) BEFORE grouping — removed words
  // never enter a line buffer, so the stretch falls through to the gap/♪ path
  // with no empty line objects. If everything is filtered, groupWordsIntoLines
  // returns [] and we hit the honest no-lyrics path below (nothing stored/charged).
  words = dropHallucinatedWords(words)

  // Regroup words into phrase lines; each line carries its nested `words`.
  const lines = groupWordsIntoLines(words)
  if (lines.length === 0) return noLyrics()

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
  // never on failure. Atomic via the deduct_credits RPC (migration
  // 20260712000000), but deliberately best-effort: the transcription already
  // ran, so an insufficient balance skips the charge and any other failure is
  // logged without taking the lyrics away.
  if (!ADMIN_EMAILS.includes(user.email ?? '')) {
    try {
      const { error: chargeError } = await supabaseAdmin.rpc('deduct_credits', {
        p_user_id: user.id,
        p_amount: LYRICS_COST,
      })
      if (chargeError) {
        if (chargeError.message.includes('INSUFFICIENT_CREDITS')) {
          console.warn(`[lyrics] balance too low to charge ${LYRICS_COST} — lyrics kept (transcription already ran)`)
        } else {
          console.error('[lyrics] charge failed:', chargeError.message)
        }
      }
    } catch (err) {
      console.error('[lyrics] charge failed:', err instanceof Error ? err.message : String(err))
    }
  }

  console.log(`[lyrics] ${force ? 'regenerated (row replaced)' : 'stored'} ${lines.length} lines for ${stemPath}`)
  return NextResponse.json({ status: 'succeeded', lyrics: lines })
}

// ── PATCH: user edits — text fixes and line deletions, timestamps kept ──────
// Only { start, end, text } is stored back, so an edit intentionally drops the
// nested per-word timings for the whole row (the edited text no longer matches
// them) — that line reverts to whole-line highlighting. Expected behaviour.
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
