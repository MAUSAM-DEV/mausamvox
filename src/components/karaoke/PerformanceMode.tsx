'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { encodeWav } from '@/components/voice-swap/audioClip'
import { sumBuffers } from './KaraokePanel'

// Performance Mode v1: a full-screen player for singing live over a backing
// track played OUT LOUD — karaoke nights, buskers, practice. It records
// NOTHING: there is no getUserMedia call anywhere in this file, by design
// (that's the whole difference from KaraokePanel, which needs headphones
// because its open mic picks up the speakers).
//
// Two backing sources:
//   • srcUrl   — streamed directly into the <audio> element, no decode. Used
//                for saved swaps (the signing proxy URL): instant start and
//                no ~40 MB decoded-WAV blob in a phone's memory.
//   • stemUrls — decoded + summed offline (KaraokePanel's sumBuffers) into an
//                instrumental, then played from a WAV object URL. Used for
//                Stem Studio's bass/drums/other.
//
// Lyrics (v1, single-color): when lyricsSourceKey (the durable vocal-stem
// path) is provided, the overlay offers on-demand auto-transcription via
// /api/lyrics and renders an auto-scrolling synced pane — dimmed done lines,
// highlighted current line, tap-to-seek, ♪ markers for long instrumental
// gaps, and a per-line edit modal (transcription of singing WILL have
// errors). Timestamps come from the ORIGINAL vocal stem; RVC preserves
// timing, so they fit the swapped track too.
//
// Deferred (recorded in PROJECT_STATUS): /swaps-row shortcut, playlists,
// v2 gender-colored lyrics (gender-split stems or diarization).

interface PerformanceModeProps {
  trackName: string
  // What the backing actually is, shown under the title — keep it honest
  // (the saved-swap entry point must say the recorded vocal is included).
  sourceNote: string
  srcUrl?: string | null
  stemUrls?: string[] | null
  // Durable vocal-stem path (track_lyrics.source_key). Null/absent = the
  // lyrics feature is simply not offered (legacy swaps, manual-stems uploads).
  lyricsSourceKey?: string | null
  onClose: () => void
}

type LyricLine = { start: number; end: number; text: string }

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
type DisplayItem = { kind: 'line' | 'gap'; start: number; end: number; text: string }

const GAP_MARKER_SECONDS = 8

function buildDisplayList(lines: LyricLine[]): DisplayItem[] {
  const items: DisplayItem[] = []
  let prevEnd = 0
  for (const l of lines) {
    if (l.start - prevEnd > GAP_MARKER_SECONDS) {
      items.push({ kind: 'gap', start: prevEnd, end: l.start, text: '♪' })
    }
    items.push({ kind: 'line', start: l.start, end: l.end, text: l.text })
    prevEnd = Math.max(prevEnd, l.end)
  }
  return items
}

// Minimal structural type for the Screen Wake Lock API — not yet in every TS
// dom lib, and absent in older browsers (feature-detected before use).
type WakeLockSentinelLike = { release: () => Promise<void> }
type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
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

  // Escape closes the MODAL, not the whole overlay — capture phase beats the
  // overlay's document-level bubble listener.
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
    const cleaned = draft
      .map((l) => ({ ...l, text: l.text.trim() }))
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
    <div className="pm-edit-overlay" role="dialog" aria-label="Edit lyrics">
      <div className="pm-edit-card">
        <div className="pm-edit-head">
          <span className="pm-edit-title">Edit lyrics</span>
          <span className="pm-edit-sub">Fix words or delete junk lines. Timings stay as transcribed.</span>
        </div>
        <div className="pm-edit-list">
          {draft.map((l, i) => (
            <div key={`${l.start}-${i}`} className="pm-edit-row">
              <span className="pm-edit-time">{fmt(l.start)}</span>
              <input
                className="pm-edit-input"
                value={l.text}
                maxLength={500}
                onChange={(e) => setText(i, e.target.value)}
              />
              <button
                className="pm-edit-del"
                onClick={() => removeLine(i)}
                aria-label={`Delete line at ${fmt(l.start)}`}
                title="Delete line"
              >
                🗑
              </button>
            </div>
          ))}
        </div>
        {error && <div className="pm-edit-err">{error}</div>}
        <div className="pm-edit-actions">
          <button className="pm-edit-cancel" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="pm-edit-save" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function PerformanceMode({ trackName, sourceNote, srcUrl, stemUrls, lyricsSourceKey, onClose }: PerformanceModeProps) {
  const [prep, setPrep] = useState<'preparing' | 'ready' | 'error'>(srcUrl ? 'ready' : 'preparing')
  const [playSrc, setPlaySrc] = useState<string | null>(srcUrl ?? null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState<number | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)
  const playingRef = useRef(false)

  // ── Lyrics state ───────────────────────────────────────────────────────────
  // 'unavailable' = no source key (legacy swap / manual stems) — feature absent.
  // 'offer' = no stored lyrics yet; show the generate button + honesty copy.
  const [lyricsState, setLyricsState] = useState<'unavailable' | 'checking' | 'offer' | 'generating' | 'ready' | 'error'>(
    lyricsSourceKey ? 'checking' : 'unavailable',
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

  const displayItems = lyricsState === 'ready' ? buildDisplayList(lyrics) : []
  // Current item = last one whose start we've passed. Done = anything before
  // it. Between a line's end and the next start (short gaps) the finished line
  // stays current — steadier to read than flicker-clearing the highlight.
  let currentIdx = -1
  for (let i = 0; i < displayItems.length; i++) {
    if (displayItems[i].start <= time + 0.3) currentIdx = i
    else break
  }

  // Load stored lyrics on open; 404 → offer to generate.
  useEffect(() => {
    if (!lyricsSourceKey) return
    lyricsAbortRef.current = false
    fetch(`/api/lyrics?stemPath=${encodeURIComponent(lyricsSourceKey)}`)
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
    if (!lyricsSourceKey || lyricsState === 'generating') return
    const prevLyrics = lyrics
    setRegenOpen(false)
    setRegenNotice('')
    setLyricsState('generating')
    setLyricsError('')
    try {
      const startRes = await fetch('/api/lyrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stemPath: lyricsSourceKey, language: langHint, force }),
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
          `/api/lyrics?id=${encodeURIComponent(predictionId)}&stemPath=${encodeURIComponent(lyricsSourceKey)}&language=${langHint}${force ? '&force=1' : ''}`,
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
  useEffect(() => {
    if (lyricsState !== 'ready' || currentIdx < 0 || userScrollingRef.current) return
    const el = lineRefs.current[currentIdx]
    if (!el) return
    programmaticScrollRef.current = true
    clearTimeout(progScrollTimerRef.current)
    // Smooth scrolling fires many scroll events; hold the flag until it settles.
    progScrollTimerRef.current = setTimeout(() => { programmaticScrollRef.current = false }, 700)
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentIdx, lyricsState])

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

  function seekToLine(item: DisplayItem) {
    const a = audioRef.current
    if (!a) return
    a.currentTime = Math.max(0, item.start)
    setTime(a.currentTime)
  }

  // ── Backing prep (stems path only; srcUrl streams untouched) ──────────────
  useEffect(() => {
    if (srcUrl || !stemUrls?.length) return
    let cancelled = false
    async function prepare() {
      try {
        const ctx = new AudioContext()
        const bufs = await Promise.all(
          (stemUrls ?? []).map(async (url) => {
            const res = await fetch(url)
            if (!res.ok) throw new Error(`backing fetch failed (${res.status})`)
            return ctx.decodeAudioData(await res.arrayBuffer())
          }),
        )
        await ctx.close()
        const mixed = bufs.length === 1 ? bufs[0] : await sumBuffers(bufs)
        if (cancelled) return
        const url = URL.createObjectURL(encodeWav(mixed))
        objectUrlRef.current = url
        setPlaySrc(url)
        setPrep('ready')
      } catch (err) {
        console.error('[performance-mode] backing prep failed:', err)
        if (!cancelled) setPrep('error')
      }
    }
    void prepare()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Wake lock: hold while playing and visible; browsers release it on tab
  //    hide, so re-acquire on visibilitychange. No-op where unsupported. ─────
  const acquireWakeLock = useCallback(async () => {
    const nav = navigator as NavigatorWithWakeLock
    if (!nav.wakeLock) return
    try {
      wakeLockRef.current = await nav.wakeLock.request('screen')
    } catch {
      // Denied (e.g. low battery) — playback still works, screen may dim.
    }
  }, [])
  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
  }, [])
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && playingRef.current) void acquireWakeLock()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [acquireWakeLock])

  // ── Media Session: lock-screen title + play/pause controls ────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    try {
      if (typeof MediaMetadata !== 'undefined') {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: trackName,
          artist: 'MausamVox — Performance Mode',
        })
      }
      navigator.mediaSession.setActionHandler('play', () => { void audioRef.current?.play() })
      navigator.mediaSession.setActionHandler('pause', () => { audioRef.current?.pause() })
    } catch { /* partial support — fine */ }
    return () => {
      try {
        navigator.mediaSession.setActionHandler('play', null)
        navigator.mediaSession.setActionHandler('pause', null)
        navigator.mediaSession.metadata = null
      } catch { /* ignore */ }
    }
  }, [trackName])

  // ── Overlay housekeeping: lock body scroll, Escape closes, cleanup ────────
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
      releaseWakeLock()
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Player wiring ──────────────────────────────────────────────────────────
  function onPlay() { playingRef.current = true; setPlaying(true); void acquireWakeLock() }
  function onPause() { playingRef.current = false; setPlaying(false); releaseWakeLock() }

  function togglePlay() {
    const a = audioRef.current
    if (!a) return
    if (a.paused) void a.play().catch((err) => console.error('[performance-mode] play failed:', err))
    else a.pause()
  }
  function restart() {
    const a = audioRef.current
    if (!a) return
    a.currentTime = 0
    void a.play().catch(() => {})
  }
  function seek(v: number) {
    const a = audioRef.current
    if (a && duration) a.currentTime = (v / 100) * duration
  }

  const pct = duration ? Math.min(100, (time / duration) * 100) : 0

  return (
    <div className="pm-overlay" role="dialog" aria-label="Performance Mode">
      <button className="pm-exit" onClick={onClose} aria-label="Exit Performance Mode">✕</button>

      <div className="pm-body">
        <div className="pm-kicker">🔊 Performance Mode</div>
        <h1 className="pm-track">{trackName}</h1>
        <p className="pm-note">{sourceNote}</p>
        <p className="pm-honest">Plays out loud — nothing is recorded.</p>

        {lyricsState === 'offer' && (
          <div className="pm-offer">
            <div className="pm-offer-row">
              <select
                className="pm-lang"
                value={langHint}
                onChange={(e) => setLangHint(e.target.value as LangHint)}
                aria-label="Lyrics language hint"
              >
                {LANG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <button className="pm-gen" onClick={() => generateLyrics()}>Generate lyrics · 25 cr</button>
            </div>
            <p className="pm-offer-note pm-offer-note--lang">{LANG_GUIDE}</p>
            <p className="pm-offer-note">
              Lyrics are auto-transcribed from the vocal by AI. Expect some mistakes —
              singing is hard to transcribe, mixed-language songs come out inconsistently,
              and humming or ad-libs can appear as odd words. You can edit every line afterwards.
            </p>
          </div>
        )}
        {lyricsState === 'generating' && (
          <div className="pm-offer"><p className="pm-offer-note">Transcribing the vocal — usually under a minute…</p></div>
        )}
        {lyricsState === 'error' && (
          <div className="pm-offer">
            <p className="pm-offer-note pm-offer-note--err">{lyricsError || 'Transcription failed.'}</p>
            <button className="pm-gen" onClick={() => generateLyrics()}>Try again · 25 cr</button>
          </div>
        )}
        {lyricsState === 'ready' && displayItems.length > 0 && (
          <>
            <div className="pm-lyrics" ref={paneRef} onScroll={onPaneScroll}>
              {displayItems.map((item, i) => (
                <button
                  key={`${item.start}-${i}`}
                  ref={(el) => { lineRefs.current[i] = el }}
                  className={[
                    'pm-line',
                    item.kind === 'gap' ? 'pm-line--gap' : '',
                    i < currentIdx ? 'pm-line--done' : i === currentIdx ? 'pm-line--current' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => seekToLine(item)}
                  title="Tap to jump here"
                >
                  {item.text}
                </button>
              ))}
            </div>
            {regenNotice && <div className="pm-regen-notice">{regenNotice}</div>}
            <div className="pm-lyrics-foot">
              <span>
                Auto-transcribed{lyricsLang && LANG_LABELS[lyricsLang] ? ` · ${LANG_LABELS[lyricsLang]}` : ''} — may contain mistakes
              </span>
              <span className="pm-foot-actions">
                <button className="pm-edit-btn" onClick={() => setRegenOpen(true)}>↻ Regenerate</button>
                <button className="pm-edit-btn" onClick={() => setEditOpen(true)}>✎ Edit lyrics</button>
              </span>
            </div>
          </>
        )}

        {prep === 'preparing' && <div className="pm-status">Preparing the backing track…</div>}
        {prep === 'error' && <div className="pm-status pm-status--err">Couldn&rsquo;t load the backing track — close and try again.</div>}

        {prep === 'ready' && playSrc && (
          <>
            <audio
              ref={audioRef}
              src={playSrc}
              preload="auto"
              onPlay={onPlay}
              onPause={onPause}
              onEnded={onPause}
              onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => { if (isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration) }}
            />

            <button className="pm-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? '❚❚' : '▶'}
            </button>

            <div className="pm-times">
              <span>{fmt(time)}</span>
              <span>-{duration === null ? '–:––' : fmt(Math.max(0, duration - time))}</span>
            </div>
            <input
              className="pm-seek"
              type="range"
              min={0}
              max={100}
              step={0.5}
              value={pct}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Seek"
            />

            <button className="pm-restart" onClick={restart}>↺ Restart</button>
          </>
        )}
      </div>

      {editOpen && lyricsSourceKey && (
        <LyricsEditModal
          lines={lyrics}
          stemPath={lyricsSourceKey}
          onCancel={() => setEditOpen(false)}
          onSaved={(newLines) => { setLyrics(newLines); setEditOpen(false) }}
        />
      )}

      {regenOpen && (
        <div className="pm-edit-overlay" role="dialog" aria-label="Regenerate lyrics">
          <div className="pm-edit-card pm-regen-card">
            <div className="pm-edit-head">
              <span className="pm-edit-title">Regenerate lyrics?</span>
              <span className="pm-edit-sub">
                This replaces the current lyrics for this track — any edits you made will be lost.
                Costs 25 credits again when it succeeds.
              </span>
            </div>
            <select
              className="pm-lang pm-regen-lang"
              value={langHint}
              onChange={(e) => setLangHint(e.target.value as LangHint)}
              aria-label="Lyrics language hint"
            >
              {LANG_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="pm-offer-note pm-offer-note--lang">{LANG_GUIDE}</p>
            <div className="pm-edit-actions">
              <button className="pm-edit-cancel" onClick={() => setRegenOpen(false)}>Cancel</button>
              <button className="pm-edit-save" onClick={() => generateLyrics(true)}>↻ Regenerate · 25 cr</button>
            </div>
          </div>
        </div>
      )}

      <style suppressHydrationWarning>{`
        .pm-overlay {
          position: fixed; inset: 0; z-index: 500;
          background: #05050F;
          display: flex; align-items: center; justify-content: center;
        }
        .pm-exit {
          position: absolute; top: 18px; right: 18px;
          width: 42px; height: 42px; border-radius: 50%;
          border: 1px solid #2A2A4A; background: rgba(255,255,255,.03);
          color: #C4C4E0; font-size: 16px; cursor: pointer;
          transition: all 0.2s;
        }
        .pm-exit:hover { border-color: #8B5CF6; color: #F0F0FF; }
        .pm-body {
          width: 100%; max-width: 460px;
          padding: 24px; text-align: center;
          display: flex; flex-direction: column; align-items: center;
        }
        .pm-kicker {
          font-size: 11px; font-weight: 700; letter-spacing: 2px;
          text-transform: uppercase; color: #8B5CF6; margin-bottom: 10px;
        }
        .pm-track {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 24px; font-weight: 700; letter-spacing: -0.4px;
          color: #F0F0FF; margin: 0 0 6px; word-break: break-word;
        }
        .pm-note { font-size: 13px; color: #7878A0; margin: 0 0 4px; line-height: 1.6; }
        .pm-honest { font-size: 12px; color: #5A5A80; margin: 0 0 34px; }
        .pm-status { font-size: 13px; color: #5A5A80; padding: 40px 0; }
        .pm-status--err { color: #F87171; }
        .pm-play {
          width: 110px; height: 110px; border-radius: 50%;
          border: none; cursor: pointer;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          color: #fff; font-size: 34px; line-height: 1;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.25s;
          margin-bottom: 26px;
        }
        .pm-play:hover { box-shadow: 0 14px 44px rgba(139,92,246,.5); transform: scale(1.03); }
        .pm-times {
          width: 100%; display: flex; justify-content: space-between;
          font-size: 13px; font-weight: 600; color: #C4C4E0;
          font-variant-numeric: tabular-nums; margin-bottom: 6px;
        }
        .pm-seek {
          width: 100%; height: 30px; cursor: pointer;
          -webkit-appearance: none; appearance: none; background: transparent;
          margin-bottom: 26px;
        }
        .pm-seek::-webkit-slider-runnable-track {
          height: 6px; border-radius: 3px; background: #1E1E3A;
        }
        .pm-seek::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 22px; height: 22px; border-radius: 50%;
          background: #F0F0FF; margin-top: -8px;
          box-shadow: 0 2px 8px rgba(0,0,0,.5);
        }
        .pm-seek::-moz-range-track {
          height: 6px; border-radius: 3px; background: #1E1E3A;
        }
        .pm-seek::-moz-range-thumb {
          width: 22px; height: 22px; border-radius: 50%; border: none;
          background: #F0F0FF;
        }
        .pm-restart {
          padding: 12px 26px; border-radius: 10px;
          border: 1px solid #2A2A4A; background: transparent; color: #C4C4E0;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 14px; font-weight: 600; cursor: pointer;
          transition: all 0.2s;
        }
        .pm-restart:hover { border-color: #8B5CF6; color: #8B5CF6; }
        .pm-offer { width: 100%; margin: -14px 0 26px; }
        .pm-offer-row {
          display: flex; gap: 10px; justify-content: center; align-items: stretch;
          margin-bottom: 10px;
        }
        .pm-lang {
          padding: 10px 12px; border-radius: 9px;
          border: 1px solid #2A2A4A; background: #0E0E20; color: #C4C4E0;
          font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .pm-gen {
          padding: 10px 18px; border-radius: 9px; border: none; cursor: pointer;
          background: linear-gradient(135deg, #8B5CF6, #EC4899);
          color: #fff; font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; transition: all 0.25s;
        }
        .pm-gen:hover { box-shadow: 0 6px 20px rgba(139,92,246,.4); }
        .pm-offer-note {
          font-size: 11px; color: #5A5A80; line-height: 1.6; margin: 0;
          max-width: 400px; margin-left: auto; margin-right: auto;
        }
        .pm-offer-note--err { color: #F87171; margin-bottom: 10px; }
        .pm-lyrics {
          width: 100%; max-height: min(32vh, 300px);
          overflow-y: auto; overscroll-behavior: contain;
          margin: -10px 0 6px; padding: 10px 4px;
          display: flex; flex-direction: column; gap: 2px;
          /* soft fade top/bottom so lines glide in and out */
          -webkit-mask-image: linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent);
          mask-image: linear-gradient(to bottom, transparent, #000 12%, #000 88%, transparent);
          scrollbar-width: none;
        }
        .pm-lyrics::-webkit-scrollbar { display: none; }
        .pm-line {
          border: none; background: transparent; cursor: pointer;
          padding: 5px 8px; border-radius: 8px;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 17px; font-weight: 600; line-height: 1.5;
          color: #7878A0; /* upcoming */
          transition: color 0.3s, opacity 0.3s, transform 0.3s;
          word-break: break-word;
        }
        .pm-line:hover { color: #C4C4E0; }
        .pm-line--done { color: #3A3A5C; opacity: 0.75; }
        .pm-line--current {
          color: #F0F0FF; transform: scale(1.04);
          text-shadow: 0 0 24px rgba(139,92,246,.45);
        }
        .pm-line--gap { font-size: 14px; letter-spacing: 6px; color: #5A5A80; }
        .pm-line--gap.pm-line--current { color: #8B5CF6; text-shadow: none; }
        .pm-lyrics-foot {
          width: 100%; display: flex; justify-content: space-between; align-items: center;
          font-size: 11px; color: #5A5A80; margin-bottom: 20px; padding: 0 4px;
          gap: 10px;
        }
        .pm-foot-actions { display: flex; gap: 14px; flex-shrink: 0; }
        .pm-regen-notice {
          width: 100%; font-size: 11px; color: #FBBF24;
          margin: 2px 0 6px; padding: 0 4px; text-align: left;
        }
        .pm-offer-note--lang { color: #9C9CC4; margin-bottom: 6px; }
        .pm-regen-card { max-width: 440px; }
        .pm-regen-lang { width: 100%; margin-bottom: 10px; }
        .pm-regen-card .pm-offer-note--lang { text-align: left; max-width: none; }
        .pm-edit-btn {
          border: none; background: transparent; cursor: pointer;
          font-size: 11px; font-weight: 600; color: #7878A0;
          transition: color 0.2s;
        }
        .pm-edit-btn:hover { color: #8B5CF6; }
        .pm-edit-overlay {
          position: fixed; inset: 0; z-index: 600;
          background: rgba(5,5,15,.82);
          display: flex; align-items: center; justify-content: center;
          padding: 20px;
        }
        .pm-edit-card {
          width: 100%; max-width: 560px; max-height: 80vh;
          display: flex; flex-direction: column;
          background: #09091A; border: 1px solid #2A2A4A; border-radius: 16px;
          padding: 20px;
        }
        .pm-edit-head { margin-bottom: 14px; }
        .pm-edit-title {
          display: block;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 17px; font-weight: 700; color: #F0F0FF; margin-bottom: 2px;
        }
        .pm-edit-sub { font-size: 11px; color: #5A5A80; }
        .pm-edit-list {
          flex: 1; overflow-y: auto; min-height: 0;
          display: flex; flex-direction: column; gap: 6px;
          padding-right: 4px;
        }
        .pm-edit-row { display: flex; align-items: center; gap: 8px; }
        .pm-edit-time {
          font-size: 11px; font-weight: 600; color: #5A5A80;
          font-variant-numeric: tabular-nums; width: 38px; flex-shrink: 0;
          text-align: right;
        }
        .pm-edit-input {
          flex: 1; min-width: 0;
          padding: 8px 10px; border-radius: 8px;
          border: 1px solid #1E1E3A; background: #0E0E20; color: #F0F0FF;
          font-size: 13px;
        }
        .pm-edit-input:focus { outline: none; border-color: #8B5CF6; }
        .pm-edit-del {
          border: none; background: transparent; cursor: pointer;
          font-size: 14px; opacity: 0.55; transition: opacity 0.2s;
          flex-shrink: 0;
        }
        .pm-edit-del:hover { opacity: 1; }
        .pm-edit-err { font-size: 12px; color: #F87171; margin-top: 10px; }
        .pm-edit-actions {
          display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px;
        }
        .pm-edit-cancel {
          padding: 10px 18px; border-radius: 9px;
          border: 1px solid #2A2A4A; background: transparent; color: #C4C4E0;
          font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .pm-edit-cancel:hover:not(:disabled) { border-color: #8B5CF6; color: #8B5CF6; }
        .pm-edit-save {
          padding: 10px 18px; border-radius: 9px; border: none; cursor: pointer;
          background: linear-gradient(135deg, #8B5CF6, #EC4899);
          color: #fff; font-size: 13px; font-weight: 600;
        }
        .pm-edit-save:disabled, .pm-edit-cancel:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  )
}
