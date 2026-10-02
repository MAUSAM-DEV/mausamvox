'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ADMIN_EMAILS } from '@/lib/admin'
import { VSidebar } from '@/components/voice-swap/VSidebar'
import { AudioPlayer } from '@/components/voice-swap/AudioPlayer'
import { VToast } from '@/components/voice-swap/VToast'
import { ShareControl } from '@/components/share/ShareControl'
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
  LYRICS_GEN_LANGUAGES,
  LYRICS_GEN_STRUCTURES,
} from '@/lib/lyrics-gen'

// Song Studio — AI full-song generation (music + optional vocals) via the
// engine selected by SONG_ENGINE (elevenlabs / acestep / minimax — passed in
// from the server page). Server route charges SONG_STUDIO_CREDITS atomically up front and
// refunds on failure; the result is persisted as a normal saved track
// (playable forever via the sign-on-read proxy, listed in Saved Tracks,
// shareable, deletable).

type Phase = 'idle' | 'generating' | 'done' | 'error'

const LYRICS_PLACEHOLDER = `[verse]
Neon lights on empty streets
Echoes of a distant beat

[chorus]
We keep on running through the night
Chasing every fading light

(…or just [instrumental] for a song without vocals)`

export function SongStudioPage({ engine = 'elevenlabs' }: { engine?: SongEngine }) {
  // Male by default — users reported every song came out female when the
  // style prompt didn't say otherwise.
  const [vocals, setVocals] = useState<SongVocals>('male')
  // Voice age: "Auto — match the song" adds no age words (the model decides).
  const [age, setAge] = useState<SongAge>('auto')
  // "Make 2 versions" — charged SONG_STUDIO_CREDITS per song.
  const [twoVersions, setTwoVersions] = useState(false)
  const songCount = twoVersions && engine !== 'elevenlabs' ? 2 : 1
  const minimaxLike = isMiniMaxEngine(engine)
  const targetEngine = minimaxLike || engine === 'lyria'
  // Length: "Auto" (default) or a slider value. On MiniMax the value is a
  // target (no duration input exists); on acestep/elevenlabs it's the real
  // duration. The slider tops out at the engine's limit.
  const [autoLength, setAutoLength] = useState(true)
  const [lengthSeconds, setLengthSeconds] = useState(120)
  const maxLengthSeconds = engineMaxSeconds(engine)
  const lengthValue = Math.min(lengthSeconds, maxLengthSeconds)
  const [isAdmin, setIsAdmin] = useState(false)
  const [plan, setPlan] = useState<string | null>(null)
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null)
  const [creditsTotal, setCreditsTotal] = useState<number | null>(null)

  const [title, setTitle] = useState('')
  const [stylePrompt, setStylePrompt] = useState('')
  const [lyrics, setLyrics] = useState('')
  // MiniMax: warn when the lyrics' estimated natural length falls well short
  // of the target (estimate fitted to real runs — rough, so a 20 s margin).
  const lyricsShortForTarget = estimateMiniMaxSeconds(countSungLines(lyrics)) < lengthValue - 20
  // Lyria: songs top out around 3:00 — friendly note when lyrics look longer.
  const lyricsTooLongForLyria = engine === 'lyria' && vocals !== 'instrumental' && lyriaLyricsLookTooLong(countSungLines(lyrics))

  // AI lyrics writer (inline panel above the lyrics box).
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTheme, setAiTheme] = useState('')
  const [aiLang, setAiLang] = useState<string>('english')
  const [aiMood, setAiMood] = useState('')
  const [aiStructure, setAiStructure] = useState<string>('auto')
  const [aiBusy, setAiBusy] = useState(false)

  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  // One finished song, or two with "Make 2 versions".
  type SongResult = { swapId: string; url: string; title: string }
  const [results, setResults] = useState<SongResult[]>([])
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const [toast, setToast] = useState({ visible: false, message: '' })
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const showToast = useCallback((message: string, ms = 4200) => {
    clearTimeout(toastTimerRef.current)
    setToast({ visible: true, message })
    toastTimerRef.current = setTimeout(() => setToast((p) => ({ ...p, visible: false })), ms)
  }, [])
  useEffect(() => () => clearTimeout(toastTimerRef.current), [])

  // Plan/credits for the sidebar + affordability check (StemStudio pattern).
  const refetchCredits = useCallback(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user
      if (!u) return
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

  // Elapsed ticker while generating.
  useEffect(() => {
    if (phase !== 'generating') return
    setElapsed(0)
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  // AI lyrics draft → fills the editable lyrics box. Server charges
  // LYRICS_GEN_CREDITS atomically and refunds itself on failure.
  async function handleWriteLyrics() {
    if (aiBusy || generating) return
    const theme = aiTheme.trim()
    if (theme.length < 3) { showToast('Give the song a theme — a few words is enough.'); return }
    if (!isAdmin && creditsRemaining !== null && creditsRemaining < LYRICS_GEN_CREDITS) {
      showToast(`Not enough credits — writing lyrics costs ${LYRICS_GEN_CREDITS}.`)
      return
    }
    setAiBusy(true)
    try {
      const res = await fetch('/api/lyrics-gen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, language: aiLang, mood: aiMood.trim(), structure: aiStructure }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error ?? `Lyrics generation failed (${res.status})`)
      setLyrics(String(d.lyrics ?? ''))
      setAiOpen(false)
      refetchCredits() // server deducted — reflect it
      showToast('Lyrics drafted — read and edit them before generating the song.')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Lyrics generation failed')
    } finally {
      setAiBusy(false)
    }
  }

  async function handleGenerate() {
    if (phase === 'generating') return
    const trimmedLyrics = lyrics.trim()
    const trimmedStyle = stylePrompt.trim()
    // MiniMax turns empty lyrics into an instrumental; Instrumental mode never
    // sings lyrics. Every other case still needs lyrics, exactly as before.
    if (!trimmedLyrics && !minimaxLike && vocals !== 'instrumental') {
      showToast('Add lyrics — or pick Instrumental for a song without vocals.'); return
    }
    if (!trimmedStyle) { showToast('Describe the style, e.g. "lo-fi hip hop, chill, acoustic guitar".'); return }
    const totalCost = songCount * SONG_STUDIO_CREDITS
    if (!isAdmin && creditsRemaining !== null && creditsRemaining < totalCost) {
      showToast(songCount === 2
        ? `Not enough credits — 2 versions cost ${totalCost}.`
        : `Not enough credits — generating a song costs ${SONG_STUDIO_CREDITS}.`)
      return
    }

    setPhase('generating')
    setErrorMsg('')
    setResults([])
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
            lyrics: trimmedLyrics, stylePrompt: trimmedStyle, title: songTitle, vocals, age,
            versions: songCount,
            lengthMode: autoLength ? 'auto' : 'fixed',
            duration: autoLength ? null : lengthValue,
          }),
        })
      } catch (err) {
        if (!isNetworkError(err)) throw err
        // We can't know whether the server received it — say so honestly.
        throw new Error('Couldn’t reach MausamVox — check your connection. Before trying again, look in Saved Tracks: if the request got through, your song may already be on its way.')
      }
      const startData = await startRes.json().catch(() => ({}))
      if (!startRes.ok) throw new Error(startData.error ?? `Failed to start (${startRes.status})`)
      refetchCredits() // server deducted up front — reflect it

      // Synchronous engine (elevenlabs): POST already carries the finished
      // song — no polling.
      if (startData.status === 'succeeded' && startData.swapId) {
        setResults([{ swapId: startData.swapId, url: startData.url, title: songTitle }])
        setPhase('done')
        showToast('Your song is ready — saved to Saved Tracks.')
        return
      }

      const started: { predictionId: string; title: string }[] =
        Array.isArray(startData.predictions) && startData.predictions.length
          ? startData.predictions
          : startData.predictionId ? [{ predictionId: startData.predictionId, title: startData.title ?? songTitle }] : []
      if (!started.length) throw new Error('No song was started — please try again.')
      if (startData.partial) showToast('Only one version could be started — the other one’s credits were refunded.', 6000)
      // style labels the saved row — the same voice-prefixed text the server sent.
      const style = withVocalStyle(trimmedStyle, vocals, age)
      const pendings: PendingSong[] = started.map((s) => ({
        predictionId: s.predictionId, title: s.title, style, startedAt: Date.now(),
        // Target length from the server (null on Auto / engines without one).
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
  // Generate and by the resume-on-open effect below. Each job is independent:
  // one can succeed while the other fails (and refunds itself server-side).
  async function runPolls(list: PendingSong[]) {
    const outcomes = await Promise.allSettled(list.map(async (p) => {
      try {
        const done = await pollUntilDone(p)
        clearPending(p.predictionId)
        return { swapId: done.swapId, url: done.url, title: p.title }
      } catch (err) {
        // Keep the pending entry only when the job may still be running.
        if (!(err instanceof ResumableError)) clearPending(p.predictionId)
        throw err
      }
    }))
    const ok = outcomes.flatMap((o) => (o.status === 'fulfilled' ? [o.value] : []))
    const errors = Array.from(new Set(outcomes.flatMap((o) =>
      o.status === 'rejected' ? [o.reason instanceof Error ? o.reason.message : String(o.reason)] : [])))
    setResults(ok)
    setErrorMsg(errors.join(' '))
    setPhase(ok.length ? 'done' : 'error')
    if (ok.length) showToast(ok.length === 2 ? 'Both versions are ready — saved to Saved Tracks.' : 'Your song is ready — saved to Saved Tracks.')
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

  // Proxy 307s to cross-origin storage where <a download> is ignored —
  // download via fetch → blob (SavedSwapPage pattern).
  async function handleDownload(result: SongResult) {
    if (downloadingId) return
    setDownloadingId(result.swapId)
    try {
      const res = await fetch(result.url)
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${result.title}.${blob.type.includes('mpeg') ? 'mp3' : 'wav'}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[song-studio] download failed:', err)
      showToast('Download failed — please try again')
    } finally {
      setDownloadingId(null)
    }
  }

  const generating = phase === 'generating'

  return (
    <>
      <div className="ss-shell">
        <VSidebar
          creditsRemaining={creditsRemaining}
          creditsTotal={creditsTotal}
          plan={plan}
          activeTool="Song Studio"
        />

        <main className="ss-main">
          <div className="ss-head">
            <h1 className="ss-h1">🎵 Song Studio</h1>
            <p className="ss-sub">
              Generate a full song — music and vocals — from your lyrics and a style
              description.
            </p>
          </div>

          <div className="ss-card">
            <label className="ss-lbl" htmlFor="ss-title">Title <span className="ss-opt">(optional)</span></label>
            <input
              id="ss-title"
              className="ss-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My midnight anthem"
              maxLength={120}
              disabled={generating}
            />

            <label className="ss-lbl" htmlFor="ss-style">Style / genre</label>
            <input
              id="ss-style"
              className="ss-input"
              value={stylePrompt}
              onChange={(e) => setStylePrompt(e.target.value)}
              placeholder="lo-fi hip hop, chill, acoustic guitar"
              maxLength={300}
              disabled={generating}
            />

            <label className="ss-lbl">Vocals</label>
            <div className="ss-durations" role="radiogroup" aria-label="Vocals">
              {SONG_VOCALS.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={vocals === v}
                  className={`ss-dur-btn${vocals === v ? ' ss-dur-btn--active' : ''}`}
                  onClick={() => setVocals(v)}
                  disabled={generating}
                >
                  {SONG_VOCAL_LABELS[v]}
                </button>
              ))}
            </div>

            {vocals !== 'instrumental' && (
              <>
                <label className="ss-lbl">Voice age</label>
                <div className="ss-durations" role="radiogroup" aria-label="Voice age">
                  {SONG_AGES.map((a) => (
                    <button
                      key={a}
                      type="button"
                      role="radio"
                      aria-checked={age === a}
                      className={`ss-dur-btn${age === a ? ' ss-dur-btn--active' : ''}`}
                      onClick={() => setAge(a)}
                      disabled={generating}
                    >
                      {SONG_AGE_LABELS[a]}
                    </button>
                  ))}
                </div>
                {age !== 'auto' && styleMentionsAge(stylePrompt) && (
                  <p className="ss-ai-note">Your style already describes the singer&rsquo;s age, so we&rsquo;ll keep yours.</p>
                )}
              </>
            )}

            <label className="ss-lbl" htmlFor="ss-lyrics">
              Lyrics
              <span className="ss-hint">
                {vocals === 'instrumental'
                  ? 'Instrumental — lyrics won’t be sung'
                  : minimaxLike
                    ? 'use [verse] / [chorus] / [bridge] — leave empty for an instrumental'
                    : engine === 'lyria'
                      ? 'use [verse] / [chorus] / [bridge] — or pick Instrumental above'
                      : 'use [verse] / [chorus] / [bridge] — or [instrumental] for no vocals'}
              </span>
            </label>

            <button
              type="button"
              className="ss-ai-toggle"
              onClick={() => setAiOpen((o) => !o)}
              disabled={generating}
            >
              ✨ Write lyrics with AI · {isAdmin ? 'free (founder)' : `${LYRICS_GEN_CREDITS} cr`} {aiOpen ? '▴' : '▾'}
            </button>

            {aiOpen && (
              <div className="ss-ai-panel">
                <label className="ss-lbl" htmlFor="ss-ai-theme">Theme</label>
                <input
                  id="ss-ai-theme"
                  className="ss-input"
                  value={aiTheme}
                  onChange={(e) => setAiTheme(e.target.value)}
                  placeholder="missing home during the monsoon"
                  maxLength={LYRICS_THEME_MAX}
                  disabled={aiBusy}
                />
                <div className="ss-ai-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label className="ss-lbl" htmlFor="ss-ai-lang">Language</label>
                    <select
                      id="ss-ai-lang"
                      className="ss-input"
                      value={aiLang}
                      onChange={(e) => setAiLang(e.target.value)}
                      disabled={aiBusy}
                    >
                      {LYRICS_GEN_LANGUAGES.map((l) => (
                        <option key={l.id} value={l.id}>{l.label}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <label className="ss-lbl" htmlFor="ss-ai-structure">Structure</label>
                    <select
                      id="ss-ai-structure"
                      className="ss-input"
                      value={aiStructure}
                      onChange={(e) => setAiStructure(e.target.value)}
                      disabled={aiBusy}
                    >
                      {LYRICS_GEN_STRUCTURES.map((s) => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="ss-lbl" htmlFor="ss-ai-mood">Mood / style <span className="ss-hint">optional</span></label>
                <input
                  id="ss-ai-mood"
                  className="ss-input"
                  value={aiMood}
                  onChange={(e) => setAiMood(e.target.value)}
                  placeholder="nostalgic, acoustic"
                  maxLength={LYRICS_MOOD_MAX}
                  disabled={aiBusy}
                />
                <button
                  type="button"
                  className="ss-ai-go"
                  onClick={handleWriteLyrics}
                  disabled={aiBusy || aiTheme.trim().length < 3}
                >
                  {aiBusy ? '⏳ Writing…' : `✨ Write lyrics · ${isAdmin ? 'free (founder)' : `${LYRICS_GEN_CREDITS} cr`}`}
                </button>
                <p className="ss-ai-note">
                  Fills the lyrics box below (replaces what&rsquo;s there). AI lyrics are a
                  starting point — they may need editing, and they must not copy existing
                  songs. You&rsquo;re responsible for what you use.
                </p>
              </div>
            )}

            <textarea
              id="ss-lyrics"
              className="ss-textarea"
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder={LYRICS_PLACEHOLDER}
              rows={10}
              maxLength={minimaxLike ? MINIMAX_MAX_LYRICS_CHARS : 5000}
              disabled={generating}
            />

            <label className="ss-lbl" htmlFor="ss-length">Length</label>
            <div className="ss-len">
              <button
                type="button"
                role="switch"
                aria-checked={autoLength}
                className={`ss-dur-btn${autoLength ? ' ss-dur-btn--active' : ''}`}
                onClick={() => setAutoLength((a) => !a)}
                disabled={generating}
              >
                Auto
              </button>
              <input
                id="ss-length"
                type="range"
                className="ss-len-slider"
                min={SONG_MIN_SECONDS}
                max={maxLengthSeconds}
                step={SONG_LENGTH_STEP_SECONDS}
                value={lengthValue}
                onChange={(e) => setLengthSeconds(Number(e.target.value))}
                disabled={autoLength || generating}
                aria-valuetext={formatMSS(lengthValue)}
              />
              <span className={`ss-len-val${autoLength ? ' ss-len-val--off' : ''}`}>{formatMSS(lengthValue)}</span>
            </div>
            {/* Honest copy per engine (never an engine name): MiniMax and the
                default engine have no duration input, so a value there is a
                TARGET — asked for in words, trimmed with a fade if the song
                runs long, never stretched. */}
            <p className="ss-ai-note">
              {autoLength
                ? engine === 'lyria'
                  ? 'Auto — follows your song (up to about 3 minutes)'
                  : minimaxLike
                    ? 'Auto — follows your lyrics'
                    : `Auto — follows your lyrics (about ${formatMSS(autoDurationSeconds(lyrics, engine))} for these lyrics)`
                : engine === 'lyria'
                  ? 'Target length — the song will be about this long. Longer songs are trimmed to fit; shorter ones are never stretched.'
                  : minimaxLike
                  // Real test 2026-10-02: 4 short lines with a 2:00 target came
                  // back at 1:00 — MiniMax can't be made to write a longer song
                  // than the lyrics support, and we never stretch audio. Longer
                  // songs ARE trimmed to the target. Copy says exactly that.
                  ? 'Target length — the song will be about this long if your lyrics are long enough. Longer songs are trimmed to fit; shorter ones are never stretched.'
                  : `The song will be about ${formatMSS(lengthValue)} long.`}
            </p>
            {lyricsTooLongForLyria && (
              <p className="ss-ai-note ss-len-warn">Songs can be up to about 3 minutes — try trimming a verse.</p>
            )}
            {!autoLength && minimaxLike && lyricsShortForTarget && (
              <p className="ss-ai-note ss-len-warn">
                Your lyrics look short for {formatMSS(lengthValue)} — expect a shorter song.
                Add verses or a bridge to get closer.
              </p>
            )}

            {engine !== 'elevenlabs' && (
              <label className="ss-versions">
                <input
                  type="checkbox"
                  checked={twoVersions}
                  onChange={(e) => setTwoVersions(e.target.checked)}
                  disabled={generating}
                />
                <span>Make 2 versions <span className="ss-opt">— two different takes to pick from ({SONG_STUDIO_CREDITS} cr each)</span></span>
              </label>
            )}

            <button className="ss-generate" onClick={handleGenerate} disabled={generating}>
              {generating
                ? `⏳ Generating${songCount === 2 ? ' 2 songs' : ''}… ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
                : `♪ Generate ${songCount === 2 ? '2 songs' : 'song'} · ${isAdmin ? 'free (founder)' : `${songCount * SONG_STUDIO_CREDITS} cr`}`}
            </button>
            {generating && (
              <div className="ss-progress-note">
                Composing takes about 30 seconds to 2 minutes. Keep this tab open.
              </div>
            )}

            <p className="ss-disclaimer">
              Songs are AI-generated and may contain mistakes. Don&rsquo;t submit
              copyrighted lyrics you don&rsquo;t have rights to — you&rsquo;re
              responsible for what you generate, and output is for permitted,
              lawful use only.
            </p>
          </div>

          {(phase === 'error' || (phase === 'done' && errorMsg)) && (
            <div className="ss-card ss-card--error">
              <div className="ss-err-title">{phase === 'done' ? 'One version didn’t finish' : 'Generation failed'}</div>
              <div className="ss-err-msg">{errorMsg}</div>
            </div>
          )}

          {phase === 'done' && results.map((result, i) => (
            <div className="ss-card" key={result.swapId}>
              <div className="ss-result-head">
                <span className="ss-result-ico">✅</span>
                <div>
                  <div className="ss-result-title">{result.title}{results.length > 1 && !/\(version 2\)$/.test(result.title) ? ` (version ${i + 1})` : ''}</div>
                  <div className="ss-result-sub">Saved to your tracks — plays from durable storage, never expires.</div>
                </div>
              </div>
              <AudioPlayer src={result.url} label="AI generated" />
              <div className="ss-actions">
                <button className="ss-btn-solid" onClick={() => handleDownload(result)} disabled={downloadingId !== null}>
                  {downloadingId === result.swapId ? 'Preparing…' : '⬇ Download'}
                </button>
                <ShareControl swapId={result.swapId} initialToken={null} onToast={showToast} />
                <Link href={`/swaps/${result.swapId}`} className="ss-btn-ghost">Open in Saved Tracks</Link>
              </div>
            </div>
          ))}
        </main>
      </div>

      <VToast visible={toast.visible} message={toast.message} />

      <style suppressHydrationWarning>{`
        body { background: #05050F; }
        .ss-shell { display: flex; min-height: 100vh; background: #05050F; }
        .ss-main {
          flex: 1; max-width: 760px; margin: 0 auto;
          padding: 40px 28px 80px; width: 100%;
        }
        .ss-head { margin-bottom: 22px; }
        .ss-h1 {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 24px; font-weight: 700; letter-spacing: -0.4px;
          color: #F0F0FF; margin: 0 0 6px;
        }
        .ss-sub { font-size: 13px; color: #A0A0C8; line-height: 1.6; margin: 0; }
        .ss-card {
          background: #09091A; border: 1px solid #2E2E56;
          border-radius: 16px; padding: 24px; margin-bottom: 18px;
        }
        .ss-card--error { border-color: rgba(239,68,68,.3); }
        .ss-err-title { font-size: 14px; font-weight: 700; color: #F87171; margin-bottom: 6px; }
        .ss-err-msg { font-size: 12px; color: #A0A0C8; line-height: 1.6; word-break: break-word; }
        .ss-lbl {
          display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
          font-size: 12px; font-weight: 600; color: #A8A8CC; margin: 16px 0 7px;
        }
        .ss-lbl:first-child { margin-top: 0; }
        .ss-opt { font-weight: 400; color: #8E8EB4; }
        .ss-hint { font-size: 10px; font-weight: 400; color: #8E8EB4; text-align: right; }
        .ss-input, .ss-textarea {
          width: 100%; background: #0E0E20; border: 1px solid #2E2E56;
          border-radius: 8px; padding: 10px 12px; font-size: 13px; color: #F0F0FF;
          outline: none; transition: border-color 0.2s; font-family: inherit;
        }
        .ss-input:focus, .ss-textarea:focus { border-color: rgba(157,92,255,.5); }
        .ss-input:disabled, .ss-textarea:disabled { opacity: 0.55; }
        .ss-textarea { resize: vertical; min-height: 160px; line-height: 1.6; }
        .ss-ai-toggle {
          align-self: flex-start;
          margin: 2px 0 4px;
          padding: 8px 14px; border-radius: 8px;
          border: 1px solid rgba(157,92,255,.4); background: rgba(157,92,255,.08);
          color: #C4B5FD; font-family: Inter, sans-serif;
          font-size: 12px; font-weight: 600; cursor: pointer;
          transition: all 0.2s;
        }
        .ss-ai-toggle:hover:not(:disabled) { border-color: #9D5CFF; background: rgba(157,92,255,.14); }
        .ss-ai-toggle:disabled { opacity: 0.5; cursor: default; }
        .ss-ai-panel {
          display: flex; flex-direction: column; gap: 4px;
          border: 1px solid rgba(157,92,255,.25); border-radius: 12px;
          padding: 14px 16px; margin-bottom: 8px;
          background: rgba(157,92,255,.04);
        }
        .ss-ai-row { display: flex; gap: 10px; }
        .ss-ai-go {
          align-self: flex-start;
          margin-top: 10px;
          padding: 10px 20px; border-radius: 9px; border: none;
          background: linear-gradient(135deg, #9D5CFF, #F9459E);
          color: #fff; font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: opacity 0.2s;
        }
        .ss-ai-go:disabled { opacity: 0.45; cursor: default; }
        .ss-ai-note { font-size: 11px; color: #8E8EB4; line-height: 1.6; margin: 10px 0 0; }
        @media (max-width: 640px) { .ss-ai-row { flex-direction: column; } }
        .ss-durations { display: flex; gap: 8px; flex-wrap: wrap; }
        .ss-dur-btn {
          padding: 8px 16px; border-radius: 8px; border: 1px solid #2E2E56;
          background: #0E0E20; color: #A0A0C8; font-size: 12px; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
        }
        .ss-dur-btn:hover:not(:disabled) { color: #F0F0FF; border-color: rgba(157,92,255,.35); }
        .ss-dur-btn--active {
          background: linear-gradient(135deg,#9D5CFF,#F9459E); color: #fff;
          border-color: transparent;
        }
        .ss-dur-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .ss-len { display: flex; align-items: center; gap: 12px; }
        .ss-len-slider { flex: 1; min-width: 0; accent-color: #9D5CFF; height: 28px; cursor: pointer; }
        .ss-len-slider:disabled { opacity: 0.35; cursor: not-allowed; }
        .ss-len-val {
          min-width: 44px; text-align: right; font-variant-numeric: tabular-nums;
          font-size: 13px; font-weight: 600; color: #F0F0FF;
        }
        .ss-len-val--off { color: #4A4A7A; }
        .ss-len-warn { color: #E8B04A; margin-top: 6px; }
        .ss-versions { display: flex; align-items: center; gap: 10px; margin-top: 18px; font-size: 13px; color: #C4C4E0; cursor: pointer; }
        .ss-versions input { width: 16px; height: 16px; accent-color: #9D5CFF; cursor: pointer; }
        .ss-generate {
          display: block; width: 100%; margin-top: 20px;
          padding: 13px 22px; border-radius: 10px; border: none;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          color: #fff; font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.25s;
        }
        .ss-generate:hover:not(:disabled) { box-shadow: 0 8px 24px rgba(157,92,255,.4); transform: translateY(-1px); }
        .ss-generate:disabled { opacity: 0.7; cursor: progress; }
        .ss-progress-note {
          margin-top: 10px; font-size: 12px; color: #A0A0C8; text-align: center;
        }
        .ss-disclaimer {
          margin: 14px 0 0; font-size: 11px; color: #8E8EB4; line-height: 1.6;
          border-top: 1px solid #2E2E56; padding-top: 12px;
        }
        .ss-result-head { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
        .ss-result-ico { font-size: 24px; }
        .ss-result-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 16px; font-weight: 700; color: #F0F0FF; word-break: break-word;
        }
        .ss-result-sub { font-size: 11px; color: #8E8EB4; margin-top: 2px; }
        .ss-actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; align-items: center; }
        .ss-btn-solid {
          padding: 11px 22px; border-radius: 9px; border: none;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          color: #fff; font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.25s;
        }
        .ss-btn-solid:hover:not(:disabled) { box-shadow: 0 8px 24px rgba(157,92,255,.4); transform: translateY(-1px); }
        .ss-btn-solid:disabled { opacity: 0.5; cursor: not-allowed; }
        .ss-btn-ghost {
          display: inline-block; padding: 11px 22px; border-radius: 9px;
          border: 1px solid #3C3C6A; background: transparent; color: #C4C4E0;
          text-decoration: none;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .ss-btn-ghost:hover { border-color: #9D5CFF; color: #9D5CFF; }
        @media (max-width: 900px) {
          .ss-shell { flex-direction: column; }
          .ss-main { padding: 24px 16px 60px; }
        }
      `}</style>
    </>
  )
}
