'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { StepSlider } from '@/components/ui/StepSlider'
import { createClient } from '@/lib/supabase/client'
import { ADMIN_EMAILS } from '@/lib/admin'
import { VSidebar } from '@/components/voice-swap/VSidebar'
import { VToast } from '@/components/voice-swap/VToast'
import {
  SONG_STUDIO_CREDITS,
  SONG_VOCALS,
  SONG_VOCAL_LABELS,
  SONG_AGES,
  SONG_AGE_LABELS,
  isMiniMaxEngine,
  styleMentionsAge,
  SONG_MIN_SECONDS,
  SONG_LENGTH_STEP_SECONDS,
  autoDurationSeconds,
  countSungLines,
  engineMaxSeconds,
  formatMSS,
  resolveSongTitle,
  withVocalStyle,
  type SongEngine,
  type SongVocals,
  type SongAge,
} from '@/lib/song-engine'
import { lyriaLyricsLookTooLong } from '@/lib/song-engine-lyria'
import { MINIMAX_MAX_LYRICS_CHARS, estimateMiniMaxSeconds } from '@/lib/song-engine-minimax'
import {
  clearPending,
  isNetworkError,
  loadPending,
  pollUntilDone,
  ResumableError,
  savePending,
  type PendingSong,
} from '@/lib/song-poll'
import {
  LYRICS_GEN_CREDITS,
  LYRICS_THEME_MAX,
  LYRICS_MOOD_MAX,
  LYRICS_CUSTOM_LANGUAGE_MAX,
  LYRICS_GEN_LANGUAGES,
  LYRICS_GEN_STRUCTURES,
} from '@/lib/lyrics-gen'
import { STYLE_CHIPS, TEMPO_OPTIONS, KEY_OPTIONS, composeStyle, parseSavedStyle, styleHasChip, toggleChip } from '@/lib/song-style'
import { SongList, songStyleText, type SongRow, type GeneratingRow } from './SongList'
import { PlayerBar, type PlayerTrack } from './PlayerBar'

// Song Studio — create panel (left), "My songs" (right), player (bottom).
// The engine (SONG_ENGINE, passed from the server page) is never named in the
// UI. The server charges SONG_STUDIO_CREDITS per song atomically up front and
// refunds on failure; results are normal saved tracks (Saved Tracks, Share,
// Share as Video).
//
// Simple mode: describe the song + pick a language → the AI lyrics writer
// drafts lyrics (shown, editable) → generate. Advanced mode: write lyrics and
// style yourself, plus voice age. Style chips are musical only — no mix words
// ("punchy", "crisp", "wide stereo" made songs sound worse in testing).

type Phase = 'idle' | 'generating' | 'done' | 'error'
type Mode = 'simple' | 'advanced'

const STRUCTURE_TAGS = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Outro', 'Instrumental']
const DESCRIBE_MAX = 300
const STYLE_MAX = 300

const LYRICS_PLACEHOLDER = `[Verse]
Neon lights on empty streets
Echoes of a distant beat

[Chorus]
We keep on running through the night
Chasing every fading light`

export function SongStudioPage({ engine = 'elevenlabs' }: { engine?: SongEngine }) {
  // ── Create-panel state ────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('simple')
  const [describe, setDescribe] = useState('')
  const [language, setLanguage] = useState<string>('english')
  const [customLanguage, setCustomLanguage] = useState('')
  const [title, setTitle] = useState('')
  const [stylePrompt, setStylePrompt] = useState('')
  const [tempo, setTempo] = useState(0)
  const [musicKey, setMusicKey] = useState('')
  const [lyrics, setLyrics] = useState('')
  const lyricsRef = useRef<HTMLTextAreaElement>(null)
  // Male by default — users reported every song came out female when the
  // style prompt didn't say otherwise.
  const [vocals, setVocals] = useState<SongVocals>('male')
  // Voice age: "Auto — match the song" adds no age words (the model decides).
  const [age, setAge] = useState<SongAge>('auto')
  // "Make 2 versions" — charged SONG_STUDIO_CREDITS per song.
  const [twoVersions, setTwoVersions] = useState(false)
  const songCount = twoVersions && engine !== 'elevenlabs' ? 2 : 1
  const minimaxLike = isMiniMaxEngine(engine)
  const instrumental = vocals === 'instrumental'
  // Length: Auto (default) or a slider target up to the engine's limit.
  const [autoLength, setAutoLength] = useState(true)
  const [lengthSeconds, setLengthSeconds] = useState(120)
  const maxLengthSeconds = engineMaxSeconds(engine)
  const lengthValue = Math.min(lengthSeconds, maxLengthSeconds)
  const sungLines = countSungLines(lyrics)
  const lyricsShortForTarget = estimateMiniMaxSeconds(sungLines) < lengthValue - 20
  const lyricsTooLongForLyria = engine === 'lyria' && !instrumental && lyriaLyricsLookTooLong(sungLines)

  // AI lyrics writer — Advanced mode's inline panel (Simple mode drives the
  // same writer from the description + language).
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTheme, setAiTheme] = useState('')
  const [aiLang, setAiLang] = useState<string>('english')
  const [aiCustomLang, setAiCustomLang] = useState('')
  const [aiMood, setAiMood] = useState('')
  const [aiStructure, setAiStructure] = useState<string>('auto')
  const [aiBusy, setAiBusy] = useState(false)

  // ── Account ───────────────────────────────────────────────────────────────
  const [userId, setUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [plan, setPlan] = useState<string | null>(null)
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null)
  const [creditsTotal, setCreditsTotal] = useState<number | null>(null)

  // ── Generation / list / player ────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [songs, setSongs] = useState<SongRow[]>([])
  const [songsLoading, setSongsLoading] = useState(true)
  const [inFlight, setInFlight] = useState<GeneratingRow[]>([])
  const [track, setTrack] = useState<PlayerTrack | null>(null)
  const [playKey, setPlayKey] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const [toast, setToast] = useState({ visible: false, message: '' })
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const showToast = useCallback((message: string, ms = 4200) => {
    clearTimeout(toastTimerRef.current)
    setToast({ visible: true, message })
    toastTimerRef.current = setTimeout(() => setToast((p) => ({ ...p, visible: false })), ms)
  }, [])
  useEffect(() => () => clearTimeout(toastTimerRef.current), [])

  // Plan/credits for the sidebar + affordability check.
  const refetchCredits = useCallback(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user
      if (!u) { setSongsLoading(false); return }
      setUserId(u.id)
      setIsAdmin(ADMIN_EMAILS.includes(u.email ?? ''))
      supabase
        .from('users')
        .select('plan, credits_remaining, credits_total')
        .eq('id', u.id)
        .maybeSingle()
        .then(({ data: row, error }) => {
          if (row) { setPlan(row.plan); setCreditsRemaining(row.credits_remaining); setCreditsTotal(row.credits_total) }
          else if (error) console.error('credits fetch failed', error)
        })
    })
  }, [])
  useEffect(() => { refetchCredits() }, [refetchCredits])

  // "My songs": this user's finished Song Studio tracks, newest first.
  const loadSongs = useCallback(async (uid: string) => {
    const { data, error } = await createClient()
      .from('voice_swaps')
      .select('id, song_name, voice_used, duration_seconds, created_at, share_token')
      .eq('user_id', uid)
      .eq('kind', 'song_studio')
      .not('result_path', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) console.error('[song-studio] songs load failed:', error.message)
    else setSongs((data ?? []) as SongRow[])
    setSongsLoading(false)
  }, [])
  useEffect(() => { if (userId) void loadSongs(userId) }, [userId, loadSongs])

  // Elapsed ticker while generating.
  useEffect(() => {
    if (phase !== 'generating') return
    setElapsed(0)
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  const generating = phase === 'generating'

  // ── AI lyrics writer (shared by both modes) ───────────────────────────────
  // Server charges LYRICS_GEN_CREDITS atomically and refunds on failure.
  async function writeLyrics(opts: { theme: string; language: string; customLanguage?: string; mood: string; structure: string }) {
    if (aiBusy || generating) return false
    const theme = opts.theme.trim()
    if (theme.length < 3) { showToast('Describe the song first — a few words is enough.'); return false }
    if (opts.language === 'other' && opts.customLanguage?.trim().length === 0) { showToast('Type the language name.'); return false }
    if (!isAdmin && creditsRemaining !== null && creditsRemaining < LYRICS_GEN_CREDITS) {
      showToast(`Not enough credits — writing lyrics costs ${LYRICS_GEN_CREDITS}.`)
      return false
    }
    setAiBusy(true)
    try {
      const res = await fetch('/api/lyrics-gen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, language: opts.language, customLanguage: opts.customLanguage, mood: opts.mood.trim().slice(0, LYRICS_MOOD_MAX), structure: opts.structure }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? `Lyrics couldn’t be written (${res.status})`)
      setLyrics(String(d.lyrics ?? ''))
      refetchCredits()
      showToast('Lyrics ready — read and edit them, then generate.')
      return true
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lyrics couldn’t be written — please try again.')
      return false
    } finally {
      setAiBusy(false)
    }
  }

  // The language name used in the style ("sung in …") for Simple mode.
  function sungLanguage(): string {
    if (language === 'other') return customLanguage.trim()
    return LYRICS_GEN_LANGUAGES.find((l) => l.id === language)?.sung ?? ''
  }

  // Style text actually sent. Simple: the description leads, then chips;
  // Advanced: the style field. Both: optional tempo/key as words.
  function buildStyle(): string {
    const base = mode === 'simple'
      ? [describe.trim(), stylePrompt.trim()].filter(Boolean).join(', ')
      : stylePrompt.trim()
    return composeStyle(base, {
      tempo: tempo || undefined,
      key: musicKey || undefined,
      language: mode === 'simple' && !instrumental ? sungLanguage() || undefined : undefined,
    })
  }

  // Insert a [Section] tag at the cursor in the lyrics box.
  function insertTag(tag: string) {
    const el = lyricsRef.current
    const text = `[${tag}]`
    if (!el) { setLyrics((l) => (l ? `${l.trimEnd()}\n\n${text}\n` : `${text}\n`)); return }
    const start = el.selectionStart ?? lyrics.length
    const end = el.selectionEnd ?? lyrics.length
    const before = lyrics.slice(0, start)
    const after = lyrics.slice(end)
    const lead = before && !before.endsWith('\n') ? (before.endsWith('\n\n') ? '' : '\n\n') : before && !before.endsWith('\n\n') ? '\n' : ''
    const next = `${before}${lead}${text}\n${after}`
    setLyrics(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = (before + lead + text + '\n').length
      el.setSelectionRange(pos, pos)
    })
  }

  // ── Generate (unchanged money/poll flow) ──────────────────────────────────
  async function handleGenerate() {
    if (generating) return
    const trimmedLyrics = lyrics.trim()
    const finalStyle = buildStyle()
    // MiniMax turns empty lyrics into an instrumental; Instrumental mode never
    // sings lyrics. Every other case still needs lyrics.
    if (!trimmedLyrics && !minimaxLike && !instrumental) {
      showToast(mode === 'simple' ? 'Write the lyrics first — or pick Instrumental.' : 'Add lyrics — or pick Instrumental for a song without vocals.'); return
    }
    if (!finalStyle) {
      showToast(mode === 'simple' ? 'Describe your song first.' : 'Describe the style, e.g. “Pop, Romantic, Acoustic guitar”.'); return
    }
    const totalCost = songCount * SONG_STUDIO_CREDITS
    if (!isAdmin && creditsRemaining !== null && creditsRemaining < totalCost) {
      showToast(songCount === 2
        ? `Not enough credits — 2 versions cost ${totalCost}.`
        : `Not enough credits — a song costs ${SONG_STUDIO_CREDITS}.`)
      return
    }

    setPhase('generating')
    setErrorMsg('')
    try {
      // The user's title (as typed); else the first lyric line; else
      // "Untitled song" — never the style text (same rule as the server).
      const songTitle = resolveSongTitle(title, trimmedLyrics)
      let startRes: Response
      try {
        startRes = await fetch('/api/song-studio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lyrics: trimmedLyrics, stylePrompt: finalStyle, title: songTitle, vocals,
            age: mode === 'advanced' ? age : 'auto',
            versions: songCount,
            lengthMode: autoLength ? 'auto' : 'fixed',
            duration: autoLength ? null : lengthValue,
          }),
        })
      } catch (err) {
        if (!isNetworkError(err)) throw err
        // We can't know whether the server received it — say so honestly.
        throw new Error('Couldn’t reach MausamVox — check your connection. Before trying again, look in My songs: if the request got through, your song may already be on its way.')
      }
      const startData = await startRes.json().catch(() => ({}))
      if (!startRes.ok) throw new Error(startData.error ?? `Failed to start (${startRes.status})`)
      refetchCredits() // server deducted up front — reflect it

      // Synchronous engine: POST already carries the finished song.
      if (startData.status === 'succeeded' && startData.swapId) {
        setPhase('done')
        if (userId) void loadSongs(userId)
        showToast('Your song is ready — it’s at the top of My songs.')
        return
      }

      const started: { predictionId: string; title: string }[] =
        Array.isArray(startData.predictions) && startData.predictions.length
          ? startData.predictions
          : startData.predictionId ? [{ predictionId: startData.predictionId, title: startData.title ?? songTitle }] : []
      if (!started.length) throw new Error('No song was started — please try again.')
      if (startData.partial) showToast('Only one version could be started — the other one’s credits were refunded.', 6000)
      // style labels the saved row — the same voice-prefixed text the server sent.
      const style = withVocalStyle(finalStyle, vocals, mode === 'advanced' ? age : 'auto')
      const pendings: PendingSong[] = started.map((s) => ({
        predictionId: s.predictionId, title: s.title, style, startedAt: Date.now(),
        targetSeconds: typeof startData.targetSeconds === 'number' ? startData.targetSeconds : null,
      }))
      pendings.forEach(savePending)
      await runPolls(pendings)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[song-studio] generate failed:', msg)
      setErrorMsg(msg)
      setPhase('error')
      refetchCredits()
    }
  }

  // Polls started generations (1 or 2) to the end — in parallel. Shared by
  // Generate and by the resume-on-open effect. Each job is independent: one
  // can succeed while the other fails (and refunds itself server-side).
  async function runPolls(list: PendingSong[]) {
    setInFlight(list.map((p) => ({ key: p.predictionId, title: p.title })))
    const outcomes = await Promise.allSettled(list.map(async (p) => {
      try {
        const done = await pollUntilDone(p)
        clearPending(p.predictionId)
        return done
      } catch (err) {
        // Keep the pending entry only when the job may still be running.
        if (!(err instanceof ResumableError)) clearPending(p.predictionId)
        throw err
      } finally {
        setInFlight((rows) => rows.filter((r) => r.key !== p.predictionId))
      }
    }))
    const ok = outcomes.filter((o) => o.status === 'fulfilled').length
    const errors = Array.from(new Set(outcomes.flatMap((o) =>
      o.status === 'rejected' ? [o.reason instanceof Error ? o.reason.message : String(o.reason)] : [])))
    setErrorMsg(errors.join(' '))
    setPhase(ok ? 'done' : 'error')
    if (userId) await loadSongs(userId)
    if (ok) showToast(ok === 2 ? 'Both versions are ready — they’re at the top of My songs.' : 'Your song is ready — it’s at the top of My songs.')
    if (errors.length) console.error('[song-studio] poll ended without a song:', errors.join(' | '))
    refetchCredits() // a refund (failure) or nothing changed — reflect it
  }

  // Resume generations interrupted by a dropped connection, reload or closed
  // tab (ref-guarded so React dev StrictMode can't start two poll loops).
  const resumedRef = useRef(false)
  useEffect(() => {
    if (resumedRef.current) return
    resumedRef.current = true
    const pending = loadPending()
    if (!pending.length) return
    setPhase('generating')
    setErrorMsg('')
    showToast(pending.length === 2 ? 'Picking up your songs from earlier…' : 'Picking up your song from earlier…')
    void runPolls(pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── List actions ──────────────────────────────────────────────────────────
  function playSong(s: SongRow) {
    if (track?.swapId === s.id && isPlaying) {
      // Clicking the playing song pauses it (the player owns playback).
      document.querySelector<HTMLAudioElement>('.pb-bar audio')?.pause()
      return
    }
    setTrack({ swapId: s.id, url: `/api/voice-swaps/${s.id}/result.mp3`, title: s.song_name, subtitle: songStyleText(s.voice_used) })
    setPlayKey((k) => k + 1)
  }
  function reuseStyle(s: SongRow) {
    const parsed = parseSavedStyle(s.voice_used)
    setMode('advanced')
    setStylePrompt(parsed.style.slice(0, STYLE_MAX))
    setTempo(0)
    setMusicKey('')
    if (parsed.vocals) setVocals(parsed.vocals)
    if (parsed.age) setAge(parsed.age)
    showToast('Style copied — add lyrics and generate.')
    document.querySelector('.ss-create')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  // Track playing state for list icons (the bar's <audio> is the source of truth).
  useEffect(() => {
    const a = document.querySelector<HTMLAudioElement>('.pb-bar audio')
    if (!a) return
    const on = () => setIsPlaying(true)
    const off = () => setIsPlaying(false)
    a.addEventListener('play', on); a.addEventListener('pause', off); a.addEventListener('ended', off)
    return () => { a.removeEventListener('play', on); a.removeEventListener('pause', off); a.removeEventListener('ended', off) }
  }, [])

  // ── Derived UI bits ───────────────────────────────────────────────────────
  const needsLyricsStep = mode === 'simple' && !instrumental && !lyrics.trim()
  const costLabel = isAdmin ? 'free (founder)' : `${songCount * SONG_STUDIO_CREDITS} cr`
  const lyricsCostLabel = isAdmin ? 'free (founder)' : `${LYRICS_GEN_CREDITS} cr`

  async function primaryAction() {
    if (needsLyricsStep) {
      await writeLyrics({ theme: describe, language, customLanguage, mood: stylePrompt, structure: 'auto' })
      return
    }
    await handleGenerate()
  }

  const vocalsPicker = (
    <>
      <label className="ss-lbl">Vocals</label>
      <div className="ss-pills" role="radiogroup" aria-label="Vocals">
        {SONG_VOCALS.map((v) => (
          <button key={v} type="button" role="radio" aria-checked={vocals === v}
            className={`ss-pill${vocals === v ? ' ss-pill--on' : ''}`} onClick={() => setVocals(v)} disabled={generating}>
            {SONG_VOCAL_LABELS[v]}
          </button>
        ))}
      </div>
    </>
  )

  const lyricsBox = (
    <>
      <label className="ss-lbl" htmlFor="ss-lyrics">
        Lyrics
        <span className="ss-hint">{instrumental ? 'Instrumental — lyrics won’t be sung' : `${sungLines} sung line${sungLines === 1 ? '' : 's'}`}</span>
      </label>
      <div className="ss-tags" aria-label="Insert a section">
        {STRUCTURE_TAGS.map((tag) => (
          <button key={tag} type="button" className="ss-tag" onClick={() => insertTag(tag)} disabled={generating || instrumental}>
            [{tag}]
          </button>
        ))}
      </div>
      <textarea
        id="ss-lyrics"
        ref={lyricsRef}
        className="ss-textarea"
        value={lyrics}
        onChange={(e) => setLyrics(e.target.value)}
        placeholder={LYRICS_PLACEHOLDER}
        rows={9}
        maxLength={minimaxLike ? MINIMAX_MAX_LYRICS_CHARS : 5000}
        disabled={generating || instrumental}
      />
      {lyricsTooLongForLyria && (
        <p className="ss-note ss-note--warn">Songs can be up to about 3 minutes — try trimming a verse.</p>
      )}
    </>
  )

  return (
    <>
      <div className="ss-shell">
        <VSidebar creditsRemaining={creditsRemaining} creditsTotal={creditsTotal} plan={plan} activeTool="Song Studio" />

        <div className="ss-body">
          <header className="ss-head">
            <h1 className="ss-h1">Song Studio</h1>
            <p className="ss-sub">Write or describe a song in any language — full songs up to about 3 minutes.</p>
          </header>

          <div className="ss-grid">
            {/* ── LEFT: create panel ───────────────────────────────────── */}
            <section className="ss-create" aria-label="Create a song">
              <div className="ss-modes" role="tablist" aria-label="Mode">
                {(['simple', 'advanced'] as Mode[]).map((m) => (
                  <button key={m} role="tab" aria-selected={mode === m} className={`ss-mode${mode === m ? ' ss-mode--on' : ''}`}
                    onClick={() => setMode(m)} disabled={generating}>
                    {m === 'simple' ? 'Simple' : 'Advanced'}
                  </button>
                ))}
              </div>

              {mode === 'simple' ? (
                <>
                  <label className="ss-lbl" htmlFor="ss-describe">Describe your song <span className="ss-hint">theme, mood, story</span></label>
                  <textarea
                    id="ss-describe"
                    className="ss-textarea ss-textarea--short"
                    value={describe}
                    onChange={(e) => setDescribe(e.target.value)}
                    placeholder="A romantic song about waiting for someone in the monsoon rain"
                    rows={3}
                    maxLength={DESCRIBE_MAX}
                    disabled={generating}
                  />
                  <div className="ss-row">
                    <div className="ss-col">
                      <label className="ss-lbl" htmlFor="ss-lang">Language</label>
                      <select id="ss-lang" className="ss-input" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={generating}>
                        {LYRICS_GEN_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                      </select>
                    </div>
                    {language === 'other' && (
                      <div className="ss-col">
                        <label className="ss-lbl" htmlFor="ss-lang-other">Which language?</label>
                        <input id="ss-lang-other" className="ss-input" value={customLanguage} onChange={(e) => setCustomLanguage(e.target.value)}
                          placeholder="e.g. Assamese" maxLength={LYRICS_CUSTOM_LANGUAGE_MAX} disabled={generating} />
                      </div>
                    )}
                  </div>
                  {vocalsPicker}
                  {!instrumental && (lyrics.trim() ? (
                    <>
                      {lyricsBox}
                      <button type="button" className="ss-link-btn"
                        onClick={() => writeLyrics({ theme: describe, language, customLanguage, mood: stylePrompt, structure: 'auto' })}
                        disabled={aiBusy || generating}>
                        {aiBusy ? 'Writing…' : `↻ Rewrite lyrics · ${lyricsCostLabel}`}
                      </button>
                    </>
                  ) : (
                    <p className="ss-note">Next, we&rsquo;ll write lyrics in your language from the description. You can read and edit them before the song is made.</p>
                  ))}
                </>
              ) : (
                <>
                  {lyricsBox}
                  <button type="button" className="ss-ai-toggle" onClick={() => setAiOpen((o) => !o)} disabled={generating}>
                    ✨ Write lyrics with AI · {lyricsCostLabel} {aiOpen ? '▴' : '▾'}
                  </button>
                  {aiOpen && (
                    <div className="ss-ai-panel">
                      <label className="ss-lbl" htmlFor="ss-ai-theme">Theme</label>
                      <input id="ss-ai-theme" className="ss-input" value={aiTheme} onChange={(e) => setAiTheme(e.target.value)}
                        placeholder="missing home during the monsoon" maxLength={LYRICS_THEME_MAX} disabled={aiBusy} />
                      <div className="ss-row">
                        <div className="ss-col">
                          <label className="ss-lbl" htmlFor="ss-ai-lang">Language</label>
                          <select id="ss-ai-lang" className="ss-input" value={aiLang} onChange={(e) => setAiLang(e.target.value)} disabled={aiBusy}>
                            {LYRICS_GEN_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                          </select>
                        </div>
                        <div className="ss-col">
                          <label className="ss-lbl" htmlFor="ss-ai-structure">Structure</label>
                          <select id="ss-ai-structure" className="ss-input" value={aiStructure} onChange={(e) => setAiStructure(e.target.value)} disabled={aiBusy}>
                            {LYRICS_GEN_STRUCTURES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                          </select>
                        </div>
                      </div>
                      {aiLang === 'other' && (
                        <>
                          <label className="ss-lbl" htmlFor="ss-ai-lang-other">Which language?</label>
                          <input id="ss-ai-lang-other" className="ss-input" value={aiCustomLang} onChange={(e) => setAiCustomLang(e.target.value)}
                            placeholder="e.g. Assamese" maxLength={LYRICS_CUSTOM_LANGUAGE_MAX} disabled={aiBusy} />
                        </>
                      )}
                      <label className="ss-lbl" htmlFor="ss-ai-mood">Mood <span className="ss-hint">optional</span></label>
                      <input id="ss-ai-mood" className="ss-input" value={aiMood} onChange={(e) => setAiMood(e.target.value)}
                        placeholder="nostalgic, hopeful" maxLength={LYRICS_MOOD_MAX} disabled={aiBusy} />
                      <button type="button" className="ss-ai-go" disabled={aiBusy || aiTheme.trim().length < 3}
                        onClick={async () => { if (await writeLyrics({ theme: aiTheme, language: aiLang, customLanguage: aiCustomLang, mood: aiMood, structure: aiStructure })) setAiOpen(false) }}>
                        {aiBusy ? '⏳ Writing…' : `✨ Write lyrics · ${lyricsCostLabel}`}
                      </button>
                      <p className="ss-note">Fills the lyrics box (replaces what&rsquo;s there). AI lyrics are a starting point — they may need editing, and they must not copy existing songs.</p>
                    </div>
                  )}

                  <label className="ss-lbl" htmlFor="ss-style">Style</label>
                  <input id="ss-style" className="ss-input" value={stylePrompt} onChange={(e) => setStylePrompt(e.target.value)}
                    placeholder="Pop, Romantic, Acoustic guitar — or type your own" maxLength={STYLE_MAX} disabled={generating} />
                  {vocalsPicker}
                  {!instrumental && (
                    <>
                      <label className="ss-lbl">Voice age</label>
                      <div className="ss-pills" role="radiogroup" aria-label="Voice age">
                        {SONG_AGES.map((a) => (
                          <button key={a} type="button" role="radio" aria-checked={age === a}
                            className={`ss-pill${age === a ? ' ss-pill--on' : ''}`} onClick={() => setAge(a)} disabled={generating}>
                            {SONG_AGE_LABELS[a]}
                          </button>
                        ))}
                      </div>
                      {age !== 'auto' && styleMentionsAge(stylePrompt) && (
                        <p className="ss-note">Your style already describes the singer&rsquo;s age, so we&rsquo;ll keep yours.</p>
                      )}
                    </>
                  )}
                </>
              )}

              {/* Style chips — both modes; tap to add/remove, typing still works. */}
              <details className="ss-chips" open={mode === 'advanced'}>
                <summary className="ss-lbl ss-chips-sum">Style ideas <span className="ss-hint">tap to add</span></summary>
                {STYLE_CHIPS.map((g) => (
                  <div className="ss-chip-group" key={g.group}>
                    <div className="ss-chip-label">{g.group}</div>
                    <div className="ss-pills">
                      {g.chips.map((c) => {
                        const on = styleHasChip(stylePrompt, c)
                        return (
                          <button key={c} type="button" className={`ss-chip${on ? ' ss-chip--on' : ''}`} aria-pressed={on}
                            onClick={() => setStylePrompt((s) => toggleChip(s, c).slice(0, STYLE_MAX))} disabled={generating}>
                            {on ? '✓ ' : '+ '}{c}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
                <div className="ss-row">
                  <div className="ss-col">
                    <label className="ss-lbl" htmlFor="ss-tempo">Tempo <span className="ss-hint">optional</span></label>
                    <select id="ss-tempo" className="ss-input" value={tempo} onChange={(e) => setTempo(Number(e.target.value))} disabled={generating}>
                      {TEMPO_OPTIONS.map((t) => <option key={t} value={t}>{t ? `${t} BPM` : 'Auto'}</option>)}
                    </select>
                  </div>
                  <div className="ss-col">
                    <label className="ss-lbl" htmlFor="ss-key">Key <span className="ss-hint">optional</span></label>
                    <select id="ss-key" className="ss-input" value={musicKey} onChange={(e) => setMusicKey(e.target.value)} disabled={generating}>
                      {KEY_OPTIONS.map((k) => <option key={k || 'auto'} value={k}>{k || 'Auto'}</option>)}
                    </select>
                  </div>
                </div>
                {mode === 'simple' && stylePrompt && <p className="ss-note">Added to your description: {stylePrompt}</p>}
              </details>

              <label className="ss-lbl" htmlFor="ss-title">Title <span className="ss-opt">(optional)</span></label>
              <input id="ss-title" className="ss-input" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Leave empty to use the first lyric line" maxLength={120} disabled={generating} />

              <label className="ss-lbl" htmlFor="ss-length">Length</label>
              <div className="ss-len">
                <button type="button" role="switch" aria-checked={autoLength}
                  className={`ss-pill${autoLength ? ' ss-pill--on' : ''}`} onClick={() => setAutoLength((a) => !a)} disabled={generating}>
                  Auto
                </button>
                <StepSlider id="ss-length" className="ss-len-slider" min={SONG_MIN_SECONDS} max={maxLengthSeconds}
                  step={SONG_LENGTH_STEP_SECONDS} value={lengthValue} onChange={setLengthSeconds}
                  disabled={autoLength || generating} format={formatMSS} aria-valuetext={formatMSS(lengthValue)} />
                <span className={`ss-len-val${autoLength ? ' ss-len-val--off' : ''}`}>{formatMSS(lengthValue)}</span>
              </div>
              <p className="ss-note">
                {autoLength
                  ? engine === 'lyria'
                    ? 'Auto — follows your song (up to about 3 minutes)'
                    : minimaxLike
                      ? 'Auto — follows your lyrics'
                      : `Auto — follows your lyrics (about ${formatMSS(autoDurationSeconds(lyrics, engine))} for these lyrics)`
                  : engine === 'lyria'
                    ? 'Target length — the song will be about this long. Longer songs are trimmed to fit; shorter ones are never stretched.'
                    : minimaxLike
                      ? 'Target length — the song will be about this long if your lyrics are long enough. Longer songs are trimmed to fit; shorter ones are never stretched.'
                      : `The song will be about ${formatMSS(lengthValue)} long.`}
              </p>
              {!autoLength && minimaxLike && lyricsShortForTarget && (
                <p className="ss-note ss-note--warn">Your lyrics look short for {formatMSS(lengthValue)} — expect a shorter song. Add verses or a bridge to get closer.</p>
              )}

              {engine !== 'elevenlabs' && (
                <label className="ss-versions">
                  <input type="checkbox" checked={twoVersions} onChange={(e) => setTwoVersions(e.target.checked)} disabled={generating} />
                  <span>Make 2 versions <span className="ss-opt">— two different takes ({SONG_STUDIO_CREDITS} cr each)</span></span>
                </label>
              )}

              {phase === 'error' && errorMsg && (
                <div className="ss-error" role="alert"><strong>Couldn&rsquo;t create the song.</strong> {errorMsg}</div>
              )}
              {phase === 'done' && errorMsg && (
                <div className="ss-error" role="alert"><strong>One version didn&rsquo;t finish.</strong> {errorMsg}</div>
              )}

              <div className="ss-generate-wrap">
                <button className="ss-generate" onClick={primaryAction} disabled={generating || aiBusy}>
                  {generating
                    ? `⏳ Creating${songCount === 2 ? ' 2 songs' : ''}… ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
                    : aiBusy && needsLyricsStep
                      ? '⏳ Writing lyrics…'
                      : needsLyricsStep
                        ? `✨ Write lyrics · ${lyricsCostLabel}`
                        : `♪ Generate ${songCount === 2 ? '2 songs' : 'song'} · ${costLabel}`}
                </button>
                {generating && <div className="ss-progress-note">Usually under a minute. You can keep browsing — it&rsquo;ll appear in My songs.</div>}
                <p className="ss-disclaimer">
                  Songs are AI-generated and may contain mistakes. Don&rsquo;t submit copyrighted lyrics you don&rsquo;t have rights to — you&rsquo;re responsible for what you create.
                </p>
              </div>
            </section>

            {/* ── RIGHT: my songs ─────────────────────────────────────── */}
            <SongList
              songs={songs}
              generating={inFlight}
              loading={songsLoading}
              currentId={track?.swapId ?? null}
              playing={isPlaying}
              onPlay={playSong}
              onReuse={reuseStyle}
              onToast={showToast}
            />
          </div>
        </div>
      </div>

      <PlayerBar track={track} playKey={playKey} />
      <VToast visible={toast.visible} message={toast.message} />

      <style suppressHydrationWarning>{`
        body { background: #05050F; }
        .ss-shell { display: flex; min-height: 100vh; background: #05050F; }
        .ss-body { flex: 1; min-width: 0; padding: 28px 28px 110px; }
        .ss-head { margin-bottom: 18px; }
        .ss-h1 {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 24px; font-weight: 700; letter-spacing: -0.4px; color: #F0F0FF; margin: 0 0 4px;
        }
        .ss-sub { font-size: 13px; color: #A0A0C8; margin: 0; }
        .ss-grid { display: grid; grid-template-columns: minmax(340px, 460px) minmax(0, 1fr); gap: 24px; align-items: start; }
        .ss-create {
          background: #09091A; border: 1px solid #2E2E56; border-radius: 16px; padding: 18px 20px 20px;
          position: sticky; top: 20px; max-height: calc(100vh - 110px); overflow-y: auto;
          display: flex; flex-direction: column;
        }
        .ss-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; background: #0E0E20; border: 1px solid #2E2E56; border-radius: 10px; margin-bottom: 4px; }
        .ss-mode {
          padding: 8px 10px; border-radius: 7px; border: none; background: transparent; color: #A0A0C8;
          font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
        }
        .ss-mode--on { background: linear-gradient(135deg,#9D5CFF,#F9459E); color: #fff; }
        .ss-lbl {
          display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
          font-size: 12px; font-weight: 600; color: #A8A8CC; margin: 14px 0 7px;
        }
        .ss-opt { font-weight: 400; color: #8E8EB4; }
        .ss-hint { font-size: 10px; font-weight: 400; color: #8E8EB4; text-align: right; }
        .ss-input, .ss-textarea {
          width: 100%; background: #0E0E20; border: 1px solid #2E2E56;
          border-radius: 8px; padding: 10px 12px; font-size: 13px; color: #F0F0FF;
          outline: none; transition: border-color 0.2s; font-family: inherit;
        }
        .ss-input:focus, .ss-textarea:focus { border-color: rgba(157,92,255,.5); }
        .ss-input:disabled, .ss-textarea:disabled { opacity: 0.55; }
        .ss-textarea { resize: vertical; min-height: 150px; line-height: 1.6; }
        .ss-textarea--short { min-height: 76px; }
        .ss-row { display: flex; gap: 10px; }
        .ss-col { flex: 1; min-width: 0; }
        .ss-pills { display: flex; gap: 6px; flex-wrap: wrap; }
        .ss-pill {
          padding: 7px 13px; border-radius: 8px; border: 1px solid #2E2E56;
          background: #0E0E20; color: #A0A0C8; font-size: 12px; font-weight: 600; cursor: pointer; transition: all .2s;
          font-family: inherit;
        }
        .ss-pill:hover:not(:disabled) { color: #F0F0FF; border-color: rgba(157,92,255,.35); }
        .ss-pill--on { background: linear-gradient(135deg,#9D5CFF,#F9459E); color: #fff; border-color: transparent; }
        .ss-pill:disabled { opacity: .55; cursor: not-allowed; }
        .ss-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 7px; }
        .ss-tag {
          padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(157,92,255,.3);
          background: rgba(157,92,255,.06); color: #C4B5FD; font-size: 11px; font-weight: 600; cursor: pointer;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .ss-tag:hover:not(:disabled) { border-color: #9D5CFF; }
        .ss-tag:disabled { opacity: .45; cursor: not-allowed; }
        .ss-chips { border-top: 1px solid #1E1E3C; margin-top: 14px; padding-top: 2px; }
        .ss-chips-sum { cursor: pointer; list-style: none; }
        .ss-chips-sum::-webkit-details-marker { display: none; }
        .ss-chips-sum::before { content: '▸ '; color: #8E8EB4; }
        .ss-chips[open] > .ss-chips-sum::before { content: '▾ '; }
        .ss-chip-group { margin-bottom: 10px; }
        .ss-chip-label { font-size: 10px; text-transform: uppercase; letter-spacing: .8px; color: #6E6E98; margin: 4px 0 6px; font-weight: 700; }
        .ss-chip {
          padding: 5px 10px; border-radius: 999px; border: 1px solid #2E2E56; background: transparent;
          color: #B4B4D8; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all .15s;
        }
        .ss-chip:hover:not(:disabled) { border-color: rgba(157,92,255,.45); color: #F0F0FF; }
        .ss-chip--on { background: rgba(157,92,255,.16); border-color: rgba(157,92,255,.6); color: #F0F0FF; }
        .ss-chip:disabled { opacity: .5; }
        .ss-note { font-size: 11px; color: #8E8EB4; line-height: 1.6; margin: 8px 0 0; }
        .ss-note--warn { color: #E8B04A; }
        .ss-link-btn {
          align-self: flex-start; margin-top: 8px; padding: 0; border: none; background: none;
          color: #C4B5FD; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
        }
        .ss-link-btn:disabled { opacity: .5; cursor: default; }
        .ss-ai-toggle {
          align-self: flex-start; margin: 10px 0 4px; padding: 8px 14px; border-radius: 8px;
          border: 1px solid rgba(157,92,255,.4); background: rgba(157,92,255,.08);
          color: #C4B5FD; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
        }
        .ss-ai-toggle:disabled { opacity: .5; cursor: default; }
        .ss-ai-panel {
          display: flex; flex-direction: column; border: 1px solid rgba(157,92,255,.25); border-radius: 12px;
          padding: 4px 14px 14px; margin: 6px 0 4px; background: rgba(157,92,255,.04);
        }
        .ss-ai-go {
          align-self: flex-start; margin-top: 12px; padding: 9px 18px; border-radius: 9px; border: none;
          background: linear-gradient(135deg, #9D5CFF, #F9459E); color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif; font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .ss-ai-go:disabled { opacity: .45; cursor: default; }
        .ss-len { display: flex; align-items: center; gap: 12px; }
        .ss-len-slider { flex: 1; min-width: 0; accent-color: #9D5CFF; height: 28px; cursor: pointer; }
        .ss-len-slider:disabled { opacity: 0.35; cursor: not-allowed; }
        .ss-len-val { min-width: 40px; text-align: right; font-variant-numeric: tabular-nums; font-size: 13px; font-weight: 600; color: #F0F0FF; }
        .ss-len-val--off { color: #4A4A7A; }
        .ss-versions { display: flex; align-items: center; gap: 10px; margin-top: 16px; font-size: 13px; color: #C4C4E0; cursor: pointer; }
        .ss-versions input { width: 16px; height: 16px; accent-color: #9D5CFF; cursor: pointer; }
        .ss-error {
          margin-top: 14px; padding: 10px 12px; border-radius: 10px; font-size: 12px; line-height: 1.6; color: #FCA5A5;
          background: rgba(239,68,68,.08); border: 1px solid rgba(239,68,68,.3);
        }
        .ss-error strong { color: #F87171; }
        .ss-generate-wrap {
          position: sticky; bottom: -20px; margin: 16px -20px -20px; padding: 14px 20px 16px;
          background: linear-gradient(180deg, rgba(9,9,26,0), #09091A 22%);
        }
        .ss-generate {
          display: block; width: 100%; padding: 14px; border-radius: 12px; border: none;
          background: linear-gradient(135deg,#9D5CFF,#F9459E,#0CC7E8); color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 700;
          cursor: pointer; transition: opacity .2s, transform .1s; box-shadow: 0 8px 30px rgba(157,92,255,.25);
        }
        .ss-generate:active:not(:disabled) { transform: translateY(1px); }
        .ss-generate:disabled { opacity: .6; cursor: default; }
        .ss-progress-note { font-size: 11px; color: #A0A0C8; text-align: center; margin-top: 8px; }
        .ss-disclaimer { font-size: 10px; color: #6E6E98; line-height: 1.5; margin: 10px 0 0; text-align: center; }
        /* VSidebar becomes a full-width top bar at ≤900px — the shell must
           stack, or the content is pushed off-screen to the right. */
        @media (max-width: 900px) {
          .ss-shell { flex-direction: column; }
        }
        @media (max-width: 1000px) {
          .ss-grid { grid-template-columns: minmax(0, 1fr); }
          .ss-create { position: static; max-height: none; overflow: visible; }
          .ss-generate-wrap { position: static; margin: 16px 0 0; padding: 0; background: none; }
        }
        @media (max-width: 640px) {
          .ss-body { padding: 18px 14px 130px; }
          .ss-row { flex-direction: column; gap: 0; }
          .ss-create { padding: 14px; }
        }
      `}</style>
    </>
  )
}
