'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { encodeWav } from '@/components/voice-swap/audioClip'
import { sumBuffers } from './KaraokePanel'
import { LyricsPane } from './LyricsPane'

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
// Lyrics: the entire lyrics experience (load-if-stored, paid generate +
// regenerate, synced auto-scrolling display, edit modal) lives in the shared
// LyricsPane (also mounted by KaraokePanel); this overlay just feeds it the
// stem path, the playback clock, and a seek handler. Timestamps come from the
// ORIGINAL vocal stem; RVC preserves timing, so they fit the swapped track.
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
  function seekToSeconds(secs: number) {
    const a = audioRef.current
    if (!a) return
    a.currentTime = Math.max(0, secs)
    setTime(a.currentTime)
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

        <LyricsPane sourceKey={lyricsSourceKey} time={time} onSeek={seekToSeconds} audioRef={audioRef} playing={playing} />

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
        .pm-honest { font-size: 12px; color: #5A5A80; margin: 0 0 20px; }
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
      `}</style>
    </div>
  )
}
