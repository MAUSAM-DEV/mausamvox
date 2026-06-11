'use client'

import { useEffect, useRef } from 'react'
import type { Persona } from './OnboardingPage'

// ─── content ─────────────────────────────────────────────────────────────────
const RESULT_META = {
  artist: {
    eyebrow: 'The magic moment',
    sub:     'We swapped the vocals on a demo song with your instant clone.',
    cover:   '🎵',
    track:   'Golden Hour — Demo',
    byLabel: 'Now singing:',
    byValue: 'Your Voice (instant clone)',
  },
  producer: {
    eyebrow: 'The magic moment',
    sub:     'A licensed library voice — recorded by a real artist, cleared for commercial use.',
    cover:   '🔥',
    track:   'Midnight Trap — Your Mix',
    byLabel: 'Vocals:',
    byValue: 'Aria (Licensed Library Voice)',
  },
  creator: {
    eyebrow: 'The magic moment',
    sub:     'Your clip with the Hype Voice style — vertical-ready with a branded waveform card.',
    cover:   '😤',
    track:   'Hype Intro — Your Clip',
    byLabel: 'Style:',
    byValue: 'Hype Voice · 9:16 export ready',
  },
}

// ─── result bars canvas ────────────────────────────────────────────────────────
function ResultBarsCanvas({ playing }: { playing: boolean }) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const rafRef     = useRef<number>()
  const tRef       = useRef(0)
  const playingRef = useRef(playing)

  useEffect(() => { playingRef.current = playing }, [playing])

  useEffect(() => {
    function draw() {
      const c = canvasRef.current
      if (!c) { rafRef.current = requestAnimationFrame(draw); return }
      const dpr = window.devicePixelRatio || 1
      const W = c.offsetWidth, H = c.offsetHeight
      if (c.width !== W * dpr) c.width = W * dpr
      if (c.height !== H * dpr) c.height = H * dpr
      const ctx = c.getContext('2d')
      if (!ctx) { rafRef.current = requestAnimationFrame(draw); return }
      ctx.clearRect(0, 0, c.width, c.height)
      ctx.save()
      ctx.scale(dpr, dpr)
      const bw = 2.5, gap = 2, step = bw + gap
      const count = Math.floor(W / step)
      const grd = ctx.createLinearGradient(0, 0, W, 0)
      grd.addColorStop(0,   'rgba(139,92,246,.85)')
      grd.addColorStop(0.5, 'rgba(236,72,153,.85)')
      grd.addColorStop(1,   'rgba(6,182,212,.85)')
      ctx.fillStyle = grd
      for (let i = 0; i < count; i++) {
        const h = playingRef.current
          ? Math.max(4, (Math.sin(tRef.current / 2.6 + i * 0.35) * 0.5 + 0.55) * 32)
          : Math.max(4, (Math.sin(i * 0.3) * 0.4 + 0.55) * 30 + 4)
        ctx.fillRect(i * step, (H - h) / 2, bw, h)
      }
      if (playingRef.current) tRef.current++
      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  return <canvas ref={canvasRef} style={{ flex: 1, height: 38, display: 'block' }} />
}

// ─── component ────────────────────────────────────────────────────────────────
interface MagicMomentScreenProps {
  persona: Persona
  resultPlaying: boolean
  setResultPlaying: (v: boolean) => void
  onNext: () => void
  onToast: (m: string) => void
}

export function MagicMomentScreen({
  persona, resultPlaying, setResultPlaying, onNext, onToast,
}: MagicMomentScreenProps) {
  const meta = RESULT_META[persona]
  const playTimerRef = useRef<ReturnType<typeof setTimeout>>()

  function handlePlay() {
    const next = !resultPlaying
    setResultPlaying(next)
    if (next) {
      onToast('Playing your track…')
      clearTimeout(playTimerRef.current)
      playTimerRef.current = setTimeout(() => setResultPlaying(false), 11000)
    } else {
      clearTimeout(playTimerRef.current)
      onToast('Paused')
    }
  }

  useEffect(() => () => clearTimeout(playTimerRef.current), [])

  return (
    <>
      <div className="ob-screen ob-sc-center">
        <div className="ob-eyebrow">{meta.eyebrow}</div>

        {persona === 'artist' && (
          <h1 className="ob-h1">
            Hear <span className="ob-gt">your voice</span><br />on a real track.
          </h1>
        )}
        {persona === 'producer' && (
          <h1 className="ob-h1">
            Your beat.<br /><span className="ob-gt">Pro vocals.</span>
          </h1>
        )}
        {persona === 'creator' && (
          <h1 className="ob-h1">
            Ready for<br /><span className="ob-gt">Reels &amp; Shorts.</span>
          </h1>
        )}

        <p className="ob-sub">{meta.sub}</p>

        <div className="obm-result-stage">
          <div className="obm-result-head">
            <div className="obm-cover">{meta.cover}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="obm-track">{meta.track}</div>
              <div className="obm-by">
                {meta.byLabel} <b>{meta.byValue}</b>
              </div>
            </div>
            <div className="obm-score">87</div>
          </div>

          <div className="obm-player-line">
            <button className="obm-pl-btn" onClick={handlePlay}>
              {resultPlaying ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
                  <rect x="6"  y="4" width="4" height="16" />
                  <rect x="14" y="4" width="4" height="16" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="white">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <ResultBarsCanvas playing={resultPlaying} />
            <span className="obm-pl-time">0:30</span>
          </div>
        </div>

        <div className="ob-btn-row">
          <button className="ob-btn-big" onClick={onNext}>
            This is amazing →
          </button>
          <button
            className="ob-btn-quiet"
            onClick={() => onToast('Regenerating with different settings…')}
          >
            Try another style
          </button>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .obm-result-stage {
          max-width: 560px; margin: 0 auto 28px;
          background: #121225; border: 1px solid #1E1E3A; border-radius: 16px;
          padding: 30px 28px; position: relative; overflow: hidden;
        }
        .obm-result-stage::before {
          content: ''; position: absolute; top: -90px; left: 50%; transform: translateX(-50%);
          width: 400px; height: 220px; border-radius: 50%;
          background: radial-gradient(ellipse, rgba(139,92,246,.14), transparent 70%);
          pointer-events: none;
        }
        .obm-result-head {
          display: flex; align-items: center; gap: 12px; margin-bottom: 18px; position: relative;
        }
        .obm-cover {
          width: 52px; height: 52px; border-radius: 12px; flex-shrink: 0;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          display: flex; align-items: center; justify-content: center; font-size: 22px;
        }
        .obm-track {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 16px; font-weight: 600; text-align: left; color: #F0F0FF;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .obm-by { font-size: 11px; color: #5A5A80; text-align: left; margin-top: 2px; }
        .obm-by b {
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          font-weight: 600;
        }
        .obm-score {
          margin-left: auto; flex-shrink: 0;
          padding: 5px 12px; border-radius: 7px;
          background: rgba(16,185,129,.1); border: 1px solid rgba(16,185,129,.25);
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 14px; font-weight: 700; color: #10B981;
        }
        .obm-player-line { display: flex; align-items: center; gap: 12px; position: relative; }
        .obm-pl-btn {
          width: 44px; height: 44px; border-radius: 50%; border: none; flex-shrink: 0;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          cursor: pointer; transition: all .25s;
          display: flex; align-items: center; justify-content: center;
        }
        .obm-pl-btn:hover { transform: scale(1.08); box-shadow: 0 7px 22px rgba(139,92,246,.4); }
        .obm-pl-time { font-size: 11px; color: #5A5A80; flex-shrink: 0; }
        @media (max-width: 760px) { .obm-result-stage { padding: 22px 16px; } }
      `}</style>
    </>
  )
}
