'use client'

import { useState, useRef, useEffect } from 'react'

// ── Animated waveform canvas ─────────────────────────────────────────────────
// Identical sine-wave animation to ResultStep's PlayerWaveCanvas so the visual
// language is consistent across all three player surfaces.
function WaveCanvas({ playing }: { playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const tRef = useRef(0)
  const playingRef = useRef(playing)

  useEffect(() => { playingRef.current = playing }, [playing])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function resize() {
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.offsetWidth * dpr
      canvas.height = canvas.offsetHeight * dpr
      ctx!.scale(dpr, dpr)
    }
    resize()
    window.addEventListener('resize', resize)

    const layers = [
      { a: 0.30, f: 0.013, s: 0.032, c: 'rgba(139,92,246,.9)', lw: 1.8 },
      { a: 0.16, f: 0.024, s: 0.058, c: 'rgba(236,72,153,.5)', lw: 1.3 },
      { a: 0.09, f: 0.038, s: 0.085, c: 'rgba(6,182,212,.3)',  lw: 1.0 },
    ]

    function frame() {
      if (!canvas || !ctx) return
      const W = canvas.offsetWidth, H = canvas.offsetHeight
      ctx.clearRect(0, 0, W, H)
      layers.forEach((l) => {
        ctx.beginPath()
        ctx.lineWidth = l.lw
        ctx.strokeStyle = l.c
        ctx.shadowColor = l.c
        ctx.shadowBlur = 7
        for (let x = 0; x <= W; x += 1.5) {
          const y =
            H / 2 +
            Math.sin(x * l.f + tRef.current * l.s) * H * l.a +
            Math.sin(x * l.f * 2.2 + tRef.current * l.s * 1.6) * H * l.a * 0.32 +
            Math.sin(x * 0.09 + tRef.current * 2.2) * 2 * 0.45
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.shadowBlur = 0
      })
      if (playingRef.current) tRef.current += 0.042
      rafRef.current = requestAnimationFrame(frame)
    }
    frame()

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '66px' }} />
}

// ── Shared custom audio player ───────────────────────────────────────────────

interface AudioPlayerProps {
  src: string | null
  /** Short label shown above the waveform (e.g. "Vocals", "Bass") */
  label?: string
  /** Auto-play immediately when src is mounted */
  autoPlay?: boolean
  /** Fires with the element's currentTime on every timeupdate (for external
   *  clocks, e.g. a synced-lyrics pane following this player). */
  onTimeUpdate?: (currentTime: number) => void
  /** Fires true on play, false on pause/end. */
  onPlayingChange?: (playing: boolean) => void
  /** Exposes the underlying <audio> element (or null on unmount) so a caller
   *  can read currentTime directly (e.g. a per-word rAF highlighter). */
  mediaRef?: (el: HTMLAudioElement | null) => void
}

function fmtTime(t: number): string {
  const s = Math.max(0, Math.round(t))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function AudioPlayer({ src, label, autoPlay = false, onTimeUpdate, onPlayingChange, mediaRef }: AudioPlayerProps) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [audioError, setAudioError] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  // Reset visual state whenever src changes (audio element also remounts via key)
  useEffect(() => {
    setPlaying(false)
    setProgress(0)
    setCurrentTime(0)
    setDuration(0)
    setAudioError(false)
  }, [src])

  // Expose the underlying element to a caller that wants to read currentTime
  // directly (the element remounts via key=src, so re-expose on src change).
  useEffect(() => {
    mediaRef?.(audioRef.current)
    return () => mediaRef?.(null)
  }, [src, mediaRef])

  function handleTogglePlay() {
    const a = audioRef.current
    if (!a) return
    if (a.paused) a.play().catch(() => setAudioError(true))
    else a.pause()
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const a = audioRef.current
    if (!a?.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * a.duration
  }

  if (!src) {
    return (
      <div className="ap-shell ap-shell--empty">
        <span className="ap-empty-hint">Select a stem above to preview</span>
        <style suppressHydrationWarning>{AP_CSS}</style>
      </div>
    )
  }

  return (
    <div className="ap-shell">
      {label && (
        <div className="ap-label-row">
          <span className="ap-label-dot" />
          <span className="ap-label-txt">{label}</span>
        </div>
      )}

      {/* key=src forces a fresh audio element whenever the source changes */}
      <audio
        key={src}
        ref={audioRef}
        src={src}
        preload="metadata"
        autoPlay={autoPlay}
        onPlay={() => { setPlaying(true); onPlayingChange?.(true) }}
        onPause={() => { setPlaying(false); onPlayingChange?.(false) }}
        onEnded={() => {
          setPlaying(false)
          onPlayingChange?.(false)
          setProgress(0)
          setCurrentTime(0)
          if (audioRef.current) audioRef.current.currentTime = 0
        }}
        onTimeUpdate={() => {
          const a = audioRef.current
          if (!a) return
          setCurrentTime(a.currentTime)
          setProgress(a.duration ? a.currentTime / a.duration : 0)
          onTimeUpdate?.(a.currentTime)
        }}
        onLoadedMetadata={() => {
          const a = audioRef.current
          if (a && isFinite(a.duration)) setDuration(a.duration)
        }}
        onError={() => setAudioError(true)}
      />

      {audioError ? (
        <div className="ap-error">
          Couldn&rsquo;t load this audio — the link may have expired
        </div>
      ) : (
        <div className="ap-wave-container">
          <WaveCanvas playing={playing} />
          <div className="ap-seek-overlay" onClick={handleSeek} />
          <div className="ap-playhead" style={{ left: `${progress * 100}%` }} />
        </div>
      )}

      <div className="ap-controls">
        <span className="ap-time">{fmtTime(currentTime)}</span>
        <button
          className="ap-play-btn"
          onClick={handleTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          disabled={audioError}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <span className="ap-time">{duration ? fmtTime(duration) : '—:—'}</span>
      </div>

      <style suppressHydrationWarning>{AP_CSS}</style>
    </div>
  )
}

const AP_CSS = `
  .ap-shell {
    background: #0E0E20;
    border: 1px solid #1E1E3A;
    border-radius: 12px;
    overflow: hidden;
  }
  .ap-shell--empty {
    padding: 16px 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .ap-empty-hint {
    font-size: 11px;
    color: #3A3A60;
  }
  .ap-label-row {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 14px 0;
  }
  .ap-label-dot {
    width: 6px; height: 6px;
    border-radius: 50%;
    background: linear-gradient(135deg, #8B5CF6, #EC4899);
    flex-shrink: 0;
  }
  .ap-label-txt {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: #7878A0;
  }
  .ap-error {
    font-size: 11px;
    color: #F87171;
    background: rgba(248,113,113,.06);
    padding: 12px 14px;
    min-height: 66px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid rgba(248,113,113,.1);
  }
  .ap-wave-container {
    position: relative;
    cursor: pointer;
  }
  .ap-seek-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
  }
  .ap-playhead {
    position: absolute;
    top: 0; bottom: 0;
    width: 1.5px;
    background: rgba(255,255,255,.7);
    pointer-events: none;
    z-index: 3;
    transition: left 0.1s linear;
  }
  .ap-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    border-top: 1px solid #1E1E3A;
  }
  .ap-time {
    font-size: 11px;
    color: #5A5A80;
    font-variant-numeric: tabular-nums;
    min-width: 34px;
  }
  .ap-play-btn {
    width: 32px; height: 32px;
    border-radius: 50%;
    border: none;
    background: linear-gradient(135deg, #8B5CF6, #EC4899);
    color: #fff;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s, box-shadow 0.2s;
    box-shadow: 0 4px 12px rgba(139,92,246,.4);
    flex-shrink: 0;
  }
  .ap-play-btn:hover:not(:disabled) {
    transform: scale(1.1);
    box-shadow: 0 6px 18px rgba(139,92,246,.5);
  }
  .ap-play-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
`
