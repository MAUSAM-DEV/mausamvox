'use client'

import { useState, useEffect, useRef, useMemo, memo, Fragment, type RefObject } from 'react'

// Shared synced-lyrics pane — the whole lyrics feature in one component:
// load-if-stored, "Generate lyrics · 25 cr" offer with the language choice +
// honesty copy, poll, the auto-scrolling synced display, ♪ gap markers, the
// per-line edit modal, and the paid Regenerate flow. Extracted from
// PerformanceMode so KaraokePanel (recording — where lyrics matter most) can
// mount the identical experience.
//
// Hosts drive it with three props: the durable vocal-stem path (sourceKey =
// track_lyrics.source_key; null/absent renders nothing — legacy swaps), the
// current playback time in seconds, and an optional onSeek (absent = lines
// are not tappable; KaraokePanel omits it because seeking the backing while
// recording would silently misalign the take).

interface LyricsPaneProps {
  sourceKey?: string | null
  time: number
  onSeek?: (seconds: number) => void
  // Card context (KaraokePanel): smaller type + shorter pane than the
  // full-screen Performance Mode overlay.
  compact?: boolean
  // Word-level highlighting (step 2): the host's <audio> element and whether
  // it is currently playing. When both are provided AND the current line has
  // per-word timings, each word lights up as it's sung — driven by rAF reading
  // audioRef.currentTime, never per-frame React state. Absent = line-only.
  audioRef?: RefObject<HTMLAudioElement | null>
  playing?: boolean
}

export type WordTiming = { text: string; start: number; end: number }
export type LyricLine = { start: number; end: number; text: string; words?: WordTiming[] }

type LangHint = 'auto' | 'hindi-rom' | 'hindi-deva' | 'english'

// Romanized is the default Hindi choice: Hindi songs are transcribed in
// Devanagari and transliterated to Latin server-side (/api/lyrics).
const LANG_OPTIONS: Array<{ value: LangHint; label: string }> = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'hindi-rom', label: 'Hindi (romanized)' },
  { value: 'hindi-deva', label: 'Hindi (Devanagari)' },
  { value: 'english', label: 'English' },
]

// Display labels for track_lyrics.language (what the STORED row was generated
// with) — includes the legacy 'hindi' value so old rows still label honestly.
const LANG_LABELS: Record<string, string> = {
  auto: 'Auto-detected',
  'hindi-rom': 'Hindi (romanized)',
  'hindi-deva': 'Hindi (Devanagari)',
  hindi: 'Hindi',
  english: 'English',
}

// Honest guidance: the language hint sets Whisper's DECODE language, so
// "English" on a Hindi song translates — it does not romanize.
const LANG_GUIDE =
  'Pick the language the song is SUNG in. Choosing English for a Hindi song will translate the lyrics, not write them in English letters — for that, pick Hindi (romanized).'

// What the pane renders: real lines plus ♪ markers for long instrumental
// gaps (intros, solos) so the highlight always has somewhere honest to sit.
// `words` rides along on line items (absent on gaps, old rows, edited lines).
type DisplayItem = { kind: 'line' | 'gap'; start: number; end: number; text: string; words?: WordTiming[] }

// Gaps longer than this get a ♪ marker; while sitting on that marker, the last
// COUNTDOWN_SECONDS turn it into a 3-2-1 "come in" countdown for the singer.
const GAP_MARKER_SECONDS = 5
const COUNTDOWN_SECONDS = 3

function buildDisplayList(lines: LyricLine[]): DisplayItem[] {
  const items: DisplayItem[] = []
  let prevEnd = 0
  for (const l of lines) {
    if (l.start - prevEnd > GAP_MARKER_SECONDS) {
      items.push({ kind: 'gap', start: prevEnd, end: l.start, text: '♪' })
    }
    items.push({ kind: 'line', start: l.start, end: l.end, text: l.text, words: l.words })
    prevEnd = Math.max(prevEnd, l.end)
  }
  return items
}

function fmt(secs: number): string {
  if (!isFinite(secs) || secs < 0) return '–:––'
  const s = Math.round(secs)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// Lyrics edit modal — sung-vocal transcription WILL have errors, so every
// line's text is editable and junk lines (humming heard as words, misheard
// ad-libs) are deletable. Timestamps are deliberately NOT editable here:
// they come from the audio and hand-tweaking them without a waveform is
// guesswork. Saves via PATCH /api/lyrics (ownership-checked, sets edited).
// ---------------------------------------------------------------------------
function LyricsEditModal({
  lines, stemPath, onCancel, onSaved,
}: {
  lines: LyricLine[]
  stemPath: string
  onCancel: () => void
  onSaved: (lines: LyricLine[]) => void
}) {
  const [draft, setDraft] = useState<LyricLine[]>(() => lines.map((l) => ({ ...l })))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Escape closes the MODAL, not a host overlay — capture phase beats any
  // document-level bubble listener the host (Performance Mode) registered.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  function setText(i: number, text: string) {
    setDraft((d) => d.map((l, j) => (j === i ? { ...l, text } : l)))
  }
  function removeLine(i: number) {
    setDraft((d) => d.filter((_, j) => j !== i))
  }

  async function save() {
    if (saving) return
    // Empty texts count as deletions; at least one real line must remain.
    // Drop any per-word timings — the edited text no longer matches them, so
    // the whole row reverts to line-level highlighting (mirrors what the PATCH
    // route stores: only start/end/text).
    const cleaned: LyricLine[] = draft
      .map((l) => ({ start: l.start, end: l.end, text: l.text.trim() }))
      .filter((l) => l.text.length > 0)
    if (cleaned.length === 0) {
      setError('At least one line is needed — delete the lyrics entirely by just not using them.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/lyrics', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stemPath, lines: cleaned }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Save failed (${res.status})`)
      onSaved(cleaned)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setSaving(false)
    }
  }

  return (
    <div className="lyr-edit-overlay" role="dialog" aria-label="Edit lyrics">
      <div className="lyr-edit-card">
        <div className="lyr-edit-head">
          <span className="lyr-edit-title">Edit lyrics</span>
          <span className="lyr-edit-sub">Fix words or delete junk lines. Timings stay as transcribed.</span>
        </div>
        <div className="lyr-edit-list">
          {draft.map((l, i) => (
            <div key={`${l.start}-${i}`} className="lyr-edit-row">
              <span className="lyr-edit-time">{fmt(l.start)}</span>
              <input
                className="lyr-edit-input"
                value={l.text}
                maxLength={500}
                onChange={(e) => setText(i, e.target.value)}
              />
              <button
                className="lyr-edit-del"
                onClick={() => removeLine(i)}
                aria-label={`Delete line at ${fmt(l.start)}`}
                title="Delete line"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
        {error && <div className="lyr-edit-err">{error}</div>}
        <div className="lyr-edit-actions">
          <button className="lyr-edit-cancel" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="lyr-edit-save" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// The current line rendered as per-word spans. Memoized on `words` so it does
// NOT re-render on the parent's ~4/s time-tick — that would reset the spans'
// className and wipe the classes the rAF loop imperatively sets. It only
// re-renders when the current line (its `words` array) actually changes, at
// which point the parent's rAF effect re-queries the spans and re-binds. The
// loop finds the spans by querying the current line's DOM node (`.lyr-word`),
// which is robust to seek direction — no shared ref array to get out of order.
const WordLine = memo(function WordLine({ words }: { words: WordTiming[] }) {
  return (
    <>
      {words.map((w, i) => (
        // The space is a sibling text node BETWEEN spans, not inside them: a
        // leading/trailing space inside an inline-block span is trimmed by CSS
        // (that's what ran the words together), but whitespace between inline
        // boxes renders as a normal, wrappable space — and being outside the
        // spans it never scales/highlights with the active word.
        <Fragment key={i}>
          {i > 0 ? ' ' : null}
          <span className="lyr-word">{w.text}</span>
        </Fragment>
      ))}
    </>
  )
})

export function LyricsPane({ sourceKey, time, onSeek, compact, audioRef, playing }: LyricsPaneProps) {
  // 'unavailable' = no source key (legacy swap / manual stems) — feature absent.
  // 'offer' = no stored lyrics yet; show the generate button + honesty copy.
  const [lyricsState, setLyricsState] = useState<'unavailable' | 'checking' | 'offer' | 'generating' | 'ready' | 'error'>(
    sourceKey ? 'checking' : 'unavailable',
  )
  const [lyrics, setLyrics] = useState<LyricLine[]>([])
  const [lyricsError, setLyricsError] = useState('')
  const [langHint, setLangHint] = useState<LangHint>('auto')
  const [editOpen, setEditOpen] = useState(false)
  // Regenerate: confirm dialog + a non-blocking failure notice (a failed
  // regenerate keeps the stored lyrics — the pane stays usable).
  const [regenOpen, setRegenOpen] = useState(false)
  const [regenNotice, setRegenNotice] = useState('')
  // Which variant the STORED lyrics were generated with (track_lyrics.language).
  const [lyricsLang, setLyricsLang] = useState<string | null>(null)
  const lyricsAbortRef = useRef(false)

  // Auto-scroll plumbing: pause while the user is manually scrolling the pane
  // (resume ~3s after they stop), and don't treat our own programmatic
  // scrollIntoView as a manual scroll.
  const paneRef = useRef<HTMLDivElement | null>(null)
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([])
  const userScrollingRef = useRef(false)
  const programmaticScrollRef = useRef(false)
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const progScrollTimerRef = useRef<ReturnType<typeof setTimeout>>()

  // Word-highlighting plumbing (step 2): the rAF handle + the last active-word
  // index (so we only touch the DOM when the active word changes, not every
  // frame). The spans themselves are queried from the current line's DOM node.
  const rafRef = useRef<number>()
  const lastActiveWordRef = useRef(-2)

  // Memoized so `words` arrays keep a stable identity across time-tick
  // re-renders (WordLine's memo depends on it) — rebuilt only when the lyrics
  // themselves change.
  const displayItems = useMemo(
    () => (lyricsState === 'ready' ? buildDisplayList(lyrics) : []),
    [lyricsState, lyrics],
  )
  // Current item = last one whose start we've passed. Done = anything before
  // it. Between a line's end and the next start (short gaps) the finished line
  // stays current — steadier to read than flicker-clearing the highlight.
  let currentIdx = -1
  for (let i = 0; i < displayItems.length; i++) {
    if (displayItems[i].start <= time + 0.3) currentIdx = i
    else break
  }

  // Load stored lyrics on mount; 404 → offer to generate.
  useEffect(() => {
    if (!sourceKey) return
    lyricsAbortRef.current = false
    fetch(`/api/lyrics?stemPath=${encodeURIComponent(sourceKey)}`)
      .then(async (res) => {
        if (lyricsAbortRef.current) return
        if (res.ok) {
          const data = await res.json()
          setLyrics(Array.isArray(data.lyrics) ? data.lyrics : [])
          setLyricsLang(typeof data.language === 'string' ? data.language : null)
          setLyricsState(Array.isArray(data.lyrics) && data.lyrics.length > 0 ? 'ready' : 'offer')
        } else {
          setLyricsState('offer') // 404 (none yet) or any error — offer, don't block
        }
      })
      .catch(() => { if (!lyricsAbortRef.current) setLyricsState('offer') })
    return () => { lyricsAbortRef.current = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // force = regenerate: skips the server cache and REPLACES the stored row
  // (the confirm dialog has already warned that current lyrics + edits go).
  async function generateLyrics(force = false) {
    if (!sourceKey || lyricsState === 'generating') return
    const prevLyrics = lyrics
    setRegenOpen(false)
    setRegenNotice('')
    setLyricsState('generating')
    setLyricsError('')
    try {
      const startRes = await fetch('/api/lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stemPath: sourceKey, language: langHint, force }),
      })
      const start = await startRes.json()
      if (!startRes.ok) throw new Error(start.error ?? `Failed to start (${startRes.status})`)
      if (start.cached && Array.isArray(start.lyrics)) {
        setLyrics(start.lyrics)
        setLyricsLang(typeof start.language === 'string' ? start.language : null)
        setLyricsState('ready')
        return
      }
      const predictionId = start.predictionId as string | undefined
      if (!predictionId) throw new Error('No prediction ID returned')

      // Poll — typically ~10-30s; generous ceiling covers a rare cold boot.
      for (let attempt = 0; attempt < 100; attempt++) {
        await new Promise((r) => setTimeout(r, 3000))
        if (lyricsAbortRef.current) return
        const pollRes = await fetch(
          `/api/lyrics?id=${encodeURIComponent(predictionId)}&stemPath=${encodeURIComponent(sourceKey)}&language=${langHint}${force ? '&force=1' : ''}`,
        )
        const poll = await pollRes.json()
        if (!pollRes.ok) throw new Error(poll.error ?? `Poll failed (${pollRes.status})`)
        if (poll.status === 'succeeded' && Array.isArray(poll.lyrics)) {
          setLyrics(poll.lyrics)
          setLyricsLang(langHint)
          setLyricsState('ready')
          return
        }
        if (poll.status === 'failed' || poll.status === 'canceled') {
          throw new Error(poll.error ?? 'Transcription failed')
        }
      }
      throw new Error('Transcription timed out — please try again')
    } catch (err) {
      if (lyricsAbortRef.current) return
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      if (force && prevLyrics.length > 0) {
        // Failed regenerate: nothing was replaced or charged server-side —
        // fall back to the still-stored lyrics instead of an error dead-end.
        setLyrics(prevLyrics)
        setRegenNotice(`Regenerate failed — kept the existing lyrics. (${msg})`)
        setLyricsState('ready')
        return
      }
      setLyricsError(msg)
      setLyricsState('error')
    }
  }

  // Auto-scroll the current line to the pane's center when it changes.
  // We scroll the PANE container directly (not el.scrollIntoView) because
  // scrollIntoView walks every scrollable ancestor up to the document: inside
  // Performance Mode the page is locked so only the pane moved, but in the
  // KaraokePanel mount (normal page flow) it scrolled the PAGE to center the
  // line in the viewport, leaving the pane visually still — the reported bug.
  // Computing the target scrollTop keeps every scroll confined to the pane, so
  // both mounts follow the clock identically.
  useEffect(() => {
    if (lyricsState !== 'ready' || currentIdx < 0 || userScrollingRef.current) return
    const pane = paneRef.current
    const el = lineRefs.current[currentIdx]
    if (!pane || !el) return
    const paneRect = pane.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    // Current line's centre, expressed in the pane's scrollable-content coords.
    const elCentre = (elRect.top - paneRect.top) + pane.scrollTop + el.clientHeight / 2
    const target = Math.max(0, elCentre - pane.clientHeight / 2)
    programmaticScrollRef.current = true
    clearTimeout(progScrollTimerRef.current)
    // Smooth scrolling fires many scroll events; hold the flag until it settles.
    progScrollTimerRef.current = setTimeout(() => { programmaticScrollRef.current = false }, 700)
    pane.scrollTo({ top: target, behavior: 'smooth' })
  }, [currentIdx, lyricsState])

  // ── Word-level highlighting (step 2) ───────────────────────────────────────
  // Within the CURRENT line only, light each word as it's sung. Driven by rAF
  // reading audioRef.currentTime — no per-frame setState; classes are toggled
  // imperatively on the memoized WordLine spans. Re-runs (and cleans up its
  // frame) on line change, play/pause, or lyrics change; falls back to nothing
  // for lines without `words` (old rows, edited lines), which keep whole-line
  // highlighting via the CSS on the button.
  useEffect(() => {
    if (lyricsState !== 'ready') return
    const item = displayItems[currentIdx]
    const words = item && item.kind === 'line' ? item.words : undefined
    if (!words || words.length === 0) return
    const audio = audioRef?.current ?? null

    // Query the current line's word spans once per line (after commit, so they
    // exist). Robust to seek direction — no cross-render ref bookkeeping.
    const button = lineRefs.current[currentIdx]
    const spans = button ? Array.from(button.querySelectorAll<HTMLElement>('.lyr-word')) : []
    if (spans.length === 0) return

    lastActiveWordRef.current = -2
    const paint = (t: number) => {
      let active = -1
      for (let i = 0; i < words.length; i++) {
        if (words[i].start <= t) active = i
        else break
      }
      if (active === lastActiveWordRef.current) return // nothing changed this frame
      lastActiveWordRef.current = active
      for (let i = 0; i < spans.length; i++) {
        spans[i].classList.toggle('lyr-word--sung', i < active)
        spans[i].classList.toggle('lyr-word--active', i === active)
      }
    }

    // One immediate paint so a paused / just-scrolled-to line shows the right
    // word without waiting for the loop (and so paused state stays correct).
    paint(audio ? audio.currentTime : time)

    if (!playing || !audio) return
    const tick = () => {
      paint(audio.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = undefined }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIdx, lyricsState, playing, displayItems])

  function onPaneScroll() {
    if (programmaticScrollRef.current) return
    userScrollingRef.current = true
    clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => { userScrollingRef.current = false }, 3000)
  }

  useEffect(() => () => {
    clearTimeout(resumeTimerRef.current)
    clearTimeout(progScrollTimerRef.current)
  }, [])

  if (lyricsState === 'unavailable') return null

  return (
    <div className={`lyr-root${compact ? ' lyr-root--compact' : ''}`}>
      {lyricsState === 'offer' && (
        <div className="lyr-offer">
          <div className="lyr-offer-row">
            <select
              className="lyr-lang"
              value={langHint}
              onChange={(e) => setLangHint(e.target.value as LangHint)}
              aria-label="Lyrics language hint"
            >
              {LANG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button className="lyr-gen" onClick={() => generateLyrics()}>Generate lyrics · 25 cr</button>
          </div>
          <p className="lyr-offer-note lyr-offer-note--lang">{LANG_GUIDE}</p>
          <p className="lyr-offer-note">
            Lyrics are auto-transcribed from the vocal by AI. Expect some mistakes —
            singing is hard to transcribe and mixed-language songs come out inconsistently.
            We filter out the repetitive gibberish it invents over humming, but a
            wrong-but-fluent guess can still slip through and a genuinely repeated
            phrase may rarely be dropped. You can edit every line afterwards.
          </p>
        </div>
      )}
      {lyricsState === 'generating' && (
        <div className="lyr-offer"><p className="lyr-offer-note">Transcribing the vocal — usually under a minute…</p></div>
      )}
      {lyricsState === 'error' && (
        <div className="lyr-offer">
          <p className="lyr-offer-note lyr-offer-note--err">{lyricsError || 'Transcription failed.'}</p>
          <button className="lyr-gen" onClick={() => generateLyrics()}>Try again · 25 cr</button>
        </div>
      )}
      {lyricsState === 'ready' && displayItems.length > 0 && (
        <>
          <div className="lyr-pane" ref={paneRef} onScroll={onPaneScroll}>
            {displayItems.map((item, i) => {
              // Countdown: while the highlight sits on a gap marker, the final
              // COUNTDOWN_SECONDS show a shrinking 3-2-1 so the singer knows
              // exactly when the next line lands. (item.end is that line's
              // start; the highlight jumps off the gap ~0.3s before, so "1"
              // reads through the last beat.)
              const isCurrent = i === currentIdx
              let text = item.text
              let counting = false
              if (item.kind === 'gap' && isCurrent) {
                const remaining = item.end - time
                if (remaining > 0 && remaining <= COUNTDOWN_SECONDS) {
                  text = String(Math.max(1, Math.ceil(remaining)))
                  counting = true
                }
              }
              // Per-word render ONLY for the current line, only when it has
              // word timings and the host wired an audio element. Everything
              // else (past/upcoming lines, gaps, old rows, edited lines) keeps
              // whole-line rendering + the existing CSS highlight.
              const useWords =
                isCurrent && item.kind === 'line' &&
                Array.isArray(item.words) && item.words.length > 0 && !!audioRef
              return (
                <button
                  key={`${item.start}-${i}`}
                  ref={(el) => { lineRefs.current[i] = el }}
                  className={[
                    'lyr-line',
                    item.kind === 'gap' ? 'lyr-line--gap' : '',
                    counting ? 'lyr-line--count' : '',
                    i < currentIdx ? 'lyr-line--done' : isCurrent ? 'lyr-line--current' : '',
                    useWords ? 'lyr-line--words' : '',
                    onSeek ? 'lyr-line--seekable' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={onSeek ? () => onSeek(Math.max(0, item.start)) : undefined}
                  title={onSeek ? 'Tap to jump here' : undefined}
                  disabled={!onSeek}
                >
                  {useWords ? <WordLine words={item.words!} /> : text}
                </button>
              )
            })}
          </div>
          {regenNotice && <div className="lyr-regen-notice">{regenNotice}</div>}
          <div className="lyr-foot">
            <span>
              Auto-transcribed{lyricsLang && LANG_LABELS[lyricsLang] ? ` · ${LANG_LABELS[lyricsLang]}` : ''} — may contain mistakes
            </span>
            <span className="lyr-foot-actions">
              <button className="lyr-foot-btn" onClick={() => setRegenOpen(true)}>↻ Regenerate</button>
              <button className="lyr-foot-btn" onClick={() => setEditOpen(true)}>✎ Edit lyrics</button>
            </span>
          </div>
        </>
      )}

      {editOpen && sourceKey && (
        <LyricsEditModal
          lines={lyrics}
          stemPath={sourceKey}
          onCancel={() => setEditOpen(false)}
          onSaved={(newLines) => { setLyrics(newLines); setEditOpen(false) }}
        />
      )}

      {regenOpen && (
        <div className="lyr-edit-overlay" role="dialog" aria-label="Regenerate lyrics">
          <div className="lyr-edit-card lyr-regen-card">
            <div className="lyr-edit-head">
              <span className="lyr-edit-title">Regenerate lyrics?</span>
              <span className="lyr-edit-sub">
                This replaces the current lyrics for this track — any edits you made will be lost.
                Costs 25 credits again when it succeeds.
              </span>
            </div>
            <select
              className="lyr-lang lyr-regen-lang"
              value={langHint}
              onChange={(e) => setLangHint(e.target.value as LangHint)}
              aria-label="Lyrics language hint"
            >
              {LANG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="lyr-offer-note lyr-offer-note--lang">{LANG_GUIDE}</p>
            <div className="lyr-edit-actions">
              <button className="lyr-edit-cancel" onClick={() => setRegenOpen(false)}>Cancel</button>
              <button className="lyr-edit-save" onClick={() => generateLyrics(true)}>↻ Regenerate · 25 cr</button>
            </div>
          </div>
        </div>
      )}

      <style suppressHydrationWarning>{`
        .lyr-root { width: 100%; }
        .lyr-offer { width: 100%; margin: 0 0 16px; text-align: center; }
        .lyr-offer-row {
          display: flex; gap: 10px; justify-content: center; align-items: stretch;
          margin-bottom: 10px;
        }
        .lyr-lang {
          padding: 10px 12px; border-radius: 9px;
          border: 1px solid #2A2A4A; background: #0E0E20; color: #C4C4E0;
          font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .lyr-gen {
          padding: 10px 18px; border-radius: 9px; border: none; cursor: pointer;
          background: linear-gradient(135deg, #8B5CF6, #EC4899);
          color: #fff; font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; transition: all 0.25s;
        }
        .lyr-gen:hover { box-shadow: 0 6px 20px rgba(139,92,246,.4); }
        .lyr-offer-note {
          font-size: 11px; color: #5A5A80; line-height: 1.6; margin: 0;
          max-width: 400px; margin-left: auto; margin-right: auto;
        }
        .lyr-offer-note--lang { color: #9C9CC4; margin-bottom: 6px; }
        .lyr-offer-note--err { color: #F87171; margin-bottom: 10px; }
        .lyr-pane {
          width: 100%; max-height: min(32vh, 300px);
          overflow-y: auto; overscroll-behavior: contain;
          margin: 0 0 6px; padding: 10px 4px;
          display: flex; flex-direction: column; gap: 2px;
          text-align: center;
          /* soft fade top/bottom so lines glide in and out */
          -webkit-mask-image: linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent);
          mask-image: linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent);
          scrollbar-width: none;
        }
        .lyr-root--compact .lyr-pane { max-height: 220px; }
        .lyr-pane::-webkit-scrollbar { display: none; }
        .lyr-line {
          border: none; background: transparent; cursor: default;
          padding: 5px 8px; border-radius: 8px;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 17px; font-weight: 600; line-height: 1.5;
          color: #7878A0; /* upcoming */
          transition: color 0.3s, opacity 0.3s, transform 0.3s;
          word-break: break-word;
        }
        .lyr-root--compact .lyr-line { font-size: 15px; }
        .lyr-line--seekable { cursor: pointer; }
        .lyr-line--seekable:hover { color: #C4C4E0; }
        /* Sung lines read as clearly "spent" — much dimmer + darker than the
           upcoming (#7878A0) lines so the eye is pulled forward. */
        .lyr-line--done { color: #2B2B45; opacity: 0.4; }
        /* Current line: bright brand gradient text fill (drop-shadow, not
           text-shadow, since the fill is transparent). Scoped away from gap
           markers so the ♪ / countdown keep their own solid colour. */
        .lyr-line--current:not(.lyr-line--gap) {
          background: linear-gradient(135deg, #A78BFA, #F472B6, #38BDF8);
          -webkit-background-clip: text; background-clip: text;
          -webkit-text-fill-color: transparent; color: transparent;
          transform: scale(1.06);
          filter: drop-shadow(0 0 16px rgba(139,92,246,.45));
        }
        .lyr-line--gap { font-size: 14px; letter-spacing: 6px; color: #5A5A80; }
        .lyr-line--gap.lyr-line--current { color: #8B5CF6; }
        /* Current line rendered as per-word spans: turn OFF the gradient text
           fill (declared after the gradient rule so it wins at equal
           specificity) — the child word spans set their own colours. Keep the
           scale + glow so the active line still reads as the focal line. */
        .lyr-line--current.lyr-line--words {
          background: none;
          -webkit-text-fill-color: initial;
          color: #6E6E98;
        }
        .lyr-word {
          display: inline-block;
          color: #6E6E98; /* not-yet-sung word in the current line */
          -webkit-text-fill-color: currentColor; /* defeat any inherited gradient transparency */
          transition: color 0.12s ease, transform 0.12s ease, text-shadow 0.12s ease;
        }
        .lyr-word--sung { color: #F0F0FF; } /* already sung, still lit */
        .lyr-word--active {
          color: #F472B6; transform: scale(1.14);
          text-shadow: 0 0 20px rgba(244,114,182,.6);
        } /* the word being sung — the focal point */
        /* Come-in countdown (3-2-1) on the current gap marker — big, pink,
           pulsing once a second so it doesn't read as a lyric. */
        .lyr-line--count {
          font-size: 30px; font-weight: 800; letter-spacing: 0;
          color: #F472B6; font-variant-numeric: tabular-nums;
          animation: lyrCount 1s ease-in-out infinite;
        }
        @keyframes lyrCount {
          0%, 100% { transform: scale(1); opacity: 0.85; }
          45% { transform: scale(1.25); opacity: 1; }
        }
        .lyr-foot {
          width: 100%; display: flex; justify-content: space-between; align-items: center;
          font-size: 11px; color: #5A5A80; margin-bottom: 14px; padding: 0 4px;
          gap: 10px; text-align: left;
        }
        .lyr-foot-actions { display: flex; gap: 14px; flex-shrink: 0; }
        .lyr-foot-btn {
          border: none; background: transparent; cursor: pointer;
          font-size: 11px; font-weight: 600; color: #7878A0;
          transition: color 0.2s;
        }
        .lyr-foot-btn:hover { color: #8B5CF6; }
        .lyr-regen-notice {
          width: 100%; font-size: 11px; color: #FBBF24;
          margin: 2px 0 6px; padding: 0 4px; text-align: left;
        }
        .lyr-edit-overlay {
          position: fixed; inset: 0; z-index: 600;
          background: rgba(5,5,15,.82);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
        }
        .lyr-edit-card {
          width: 100%; max-width: 560px; max-height: 80vh;
          display: flex; flex-direction: column;
          background: #09091A; border: 1px solid #2A2A4A; border-radius: 16px;
          padding: 20px; text-align: left;
        }
        .lyr-regen-card { max-width: 440px; }
        .lyr-regen-lang { width: 100%; margin-bottom: 10px; }
        .lyr-regen-card .lyr-offer-note--lang { text-align: left; max-width: none; }
        .lyr-edit-head { margin-bottom: 14px; }
        .lyr-edit-title {
          display: block;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 17px; font-weight: 700; color: #F0F0FF; margin-bottom: 2px;
        }
        .lyr-edit-sub { font-size: 11px; color: #5A5A80; }
        .lyr-edit-list {
          flex: 1; overflow-y: auto; min-height: 0;
          display: flex; flex-direction: column; gap: 6px;
          padding-right: 4px;
        }
        .lyr-edit-row { display: flex; align-items: center; gap: 8px; }
        .lyr-edit-time {
          font-size: 11px; font-weight: 600; color: #5A5A80;
          font-variant-numeric: tabular-nums; width: 38px; flex-shrink: 0;
          text-align: right;
        }
        .lyr-edit-input {
          flex: 1; min-width: 0;
          padding: 8px 10px; border-radius: 8px;
          border: 1px solid #1E1E3A; background: #0E0E20; color: #F0F0FF;
          font-size: 13px;
        }
        .lyr-edit-input:focus { outline: none; border-color: #8B5CF6; }
        .lyr-edit-del {
          border: none; background: transparent; cursor: pointer;
          font-size: 14px; opacity: 0.55; transition: opacity 0.2s;
          flex-shrink: 0;
        }
        .lyr-edit-del:hover { opacity: 1; }
        .lyr-edit-err { font-size: 12px; color: #F87171; margin-top: 10px; }
        .lyr-edit-actions {
          display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px;
        }
        .lyr-edit-cancel {
          padding: 10px 18px; border-radius: 9px;
          border: 1px solid #2A2A4A; background: transparent; color: #C4C4E0;
          font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .lyr-edit-cancel:hover:not(:disabled) { border-color: #8B5CF6; color: #8B5CF6; }
        .lyr-edit-save {
          padding: 10px 18px; border-radius: 9px; border: none; cursor: pointer;
          background: linear-gradient(135deg, #8B5CF6, #EC4899);
          color: #fff; font-size: 13px; font-weight: 600;
        }
        .lyr-edit-save:disabled, .lyr-edit-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  )
}
