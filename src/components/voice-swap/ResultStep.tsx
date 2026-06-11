'use client'

import { useEffect, useRef, useState } from 'react'

type PlayerTab = 'Original' | 'Swapped' | 'A/B Compare'

interface ResultStepProps {
  playerTab: PlayerTab
  setPlayerTab: (t: PlayerTab) => void
  playing: boolean
  playProgress: number
  onTogglePlay: () => void
  onSeek: (pct: number) => void
  onNewSwap: () => void
  onToast: (msg: string) => void
}

const SCORE_BARS = [
  { label: 'Voice Match', pct: 94 },
  { label: 'Pitch Accuracy', pct: 87 },
  { label: 'Naturalness', pct: 78 },
  { label: 'Emotion Transfer', pct: 71 },
]

const PLAYER_TABS: PlayerTab[] = ['Original', 'Swapped', 'A/B Compare']

function PlayerWaveCanvas({ playing }: { playing: boolean }) {
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

    const layers = [
      { a: 0.30, f: 0.013, s: 0.032, c: 'rgba(139,92,246,.9)', lw: 1.8 },
      { a: 0.16, f: 0.024, s: 0.058, c: 'rgba(236,72,153,.5)', lw: 1.3 },
      { a: 0.09, f: 0.038, s: 0.085, c: 'rgba(6,182,212,.3)',  lw: 1.0 },
    ]

    function frame() {
      if (!canvas || !ctx) return
      const W = canvas.offsetWidth
      const H = canvas.offsetHeight
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

    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '66px' }}
    />
  )
}

function ScoreRing({ score }: { score: number }) {
  const r = 28
  const cx = 34
  const circ = 2 * Math.PI * r
  const dashOffset = circ * (1 - score / 100)

  return (
    <svg width="68" height="68" viewBox="0 0 68 68" style={{ flexShrink: 0 }}>
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke="#1E1E3A"
        strokeWidth="5"
      />
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke="url(#rg)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={dashOffset}
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: 'stroke-dashoffset 1s ease' }}
      />
      <defs>
        <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="50%" stopColor="#EC4899" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <text
        x={cx}
        y={cx + 5}
        textAnchor="middle"
        fill="#F0F0FF"
        fontSize="14"
        fontWeight="700"
        fontFamily="var(--font-grotesk), 'Space Grotesk', sans-serif"
      >
        {score}
      </text>
    </svg>
  )
}

export function ResultStep({
  playerTab, setPlayerTab, playing, playProgress,
  onTogglePlay, onSeek, onNewSwap, onToast,
}: ResultStepProps) {
  const [barsAnimated, setBarsAnimated] = useState(false)
  const [regenCountdown, setRegenCountdown] = useState(600) // 10 min in seconds

  useEffect(() => {
    const t = setTimeout(() => setBarsAnimated(true), 300)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setRegenCountdown((n) => Math.max(0, n - 1)), 1000)
    return () => clearInterval(id)
  }, [])

  const mins = Math.floor(regenCountdown / 60)
  const secs = String(regenCountdown % 60).padStart(2, '0')

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    onSeek(Math.max(0, Math.min(1, pct)))
  }

  const elapsed = Math.round(playProgress * 272)
  const elapsedMins = Math.floor(elapsed / 60)
  const elapsedSecs = String(elapsed % 60).padStart(2, '0')

  return (
    <>
      <div className="vs-panel">
        {/* Score row */}
        <div className="vs-result-top">
          <ScoreRing score={82} />
          <div>
            <div className="vs-result-score-lbl">Quality Score</div>
            <div
              className="grad-text"
              style={{
                fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
                fontSize: '36px',
                fontWeight: 700,
                letterSpacing: '-1px',
                lineHeight: 1,
              }}
            >
              82
              <span
                style={{
                  fontSize: '14px',
                  fontWeight: 400,
                  color: '#5A5A80',
                  letterSpacing: 0,
                  marginLeft: '6px',
                  background: 'none',
                  WebkitTextFillColor: '#5A5A80',
                }}
              >
                / 100
              </span>
            </div>
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
              {['✓ Ready to download', '✓ High fidelity'].map((c) => (
                <span key={c} className="vs-result-chip">{c}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Score bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '20px 0' }}>
          {SCORE_BARS.map((bar, i) => (
            <div key={bar.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#7878A0', marginBottom: '5px' }}>
                <span>{bar.label}</span>
                <span>{bar.pct}%</span>
              </div>
              <div style={{ height: '5px', background: '#1E1E3A', borderRadius: '3px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    borderRadius: '3px',
                    background: 'linear-gradient(135deg,#8B5CF6,#EC4899,#06B6D4)',
                    width: barsAnimated ? `${bar.pct}%` : '0%',
                    transition: `width 1.4s ease ${i * 150}ms`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Player */}
        <div className="vs-player">
          <div className="vs-player-tabs">
            {PLAYER_TABS.map((t) => (
              <button
                key={t}
                className={`vs-ptab ${playerTab === t ? 'vs-ptab--active' : ''}`}
                onClick={() => setPlayerTab(t)}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="vs-wave-container">
            <PlayerWaveCanvas playing={playing} />
            {/* Seek overlay */}
            <div
              className="vs-seek-overlay"
              onClick={handleSeek}
            />
            {/* Playhead */}
            <div
              className="vs-playhead"
              style={{ left: `${playProgress * 100}%` }}
            />
          </div>

          <div className="vs-player-controls">
            <span className="vs-time">{elapsedMins}:{elapsedSecs}</span>
            <button
              className="vs-play-btn"
              onClick={onTogglePlay}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <span className="vs-time">4:32</span>
          </div>
        </div>

        {/* Regen row */}
        <div className="vs-regen-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#5A5A80' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M4 4v5h5M20 20v-5h-5" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" />
              <path d="M20 9A8 8 0 0 0 5.66 5.66M4 15a8 8 0 0 0 14.34 3.34" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <strong style={{ color: '#8B5CF6' }}>Free regen</strong> available for
            <span
              className="grad-text"
              style={{ fontWeight: 700 }}
            >
              {mins}:{secs}
            </span>
          </div>
          <button
            className="vs-regen-btn"
            onClick={() => onToast('Regenerating swap…')}
          >
            ↺ Regenerate
          </button>
        </div>

        {/* Download / Share */}
        <div className="vs-dl-row">
          <button
            className="vs-dl-btn vs-dl-btn--primary"
            onClick={() => onToast('Downloading swap…')}
          >
            ↓ Download HD
          </button>
          <button
            className="vs-dl-btn vs-dl-btn--outline"
            onClick={() => onToast('Link copied!')}
          >
            ⬆ Share
          </button>
          <button
            className="vs-dl-btn vs-dl-btn--outline"
            onClick={onNewSwap}
          >
            + New Swap
          </button>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .vs-result-top {
          display: flex;
          align-items: center;
          gap: 20px;
        }
        .vs-result-score-lbl {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #5A5A80;
          margin-bottom: 4px;
        }
        .vs-result-chip {
          padding: 3px 10px;
          border-radius: 999px;
          background: rgba(16,185,129,.08);
          border: 1px solid rgba(16,185,129,.2);
          font-size: 11px;
          font-weight: 600;
          color: #10B981;
        }
        .vs-player {
          background: #0E0E20;
          border: 1px solid #1E1E3A;
          border-radius: 12px;
          overflow: hidden;
          margin-bottom: 14px;
        }
        .vs-player-tabs {
          display: flex;
          border-bottom: 1px solid #1E1E3A;
          padding: 0 4px;
        }
        .vs-ptab {
          padding: 8px 14px;
          border: none;
          background: transparent;
          font-size: 11px;
          font-weight: 500;
          color: #5A5A80;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
        }
        .vs-ptab:hover { color: #F0F0FF; }
        .vs-ptab--active {
          color: #F0F0FF;
          font-weight: 600;
        }
        .vs-ptab--active::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 4px;
          right: 4px;
          height: 2px;
          background: linear-gradient(135deg,#8B5CF6,#EC4899,#06B6D4);
          border-radius: 2px 2px 0 0;
        }
        .vs-wave-container {
          position: relative;
          cursor: pointer;
        }
        .vs-seek-overlay {
          position: absolute;
          inset: 0;
          z-index: 2;
        }
        .vs-playhead {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 1.5px;
          background: rgba(255,255,255,.7);
          pointer-events: none;
          z-index: 3;
          transition: left 0.1s linear;
        }
        .vs-player-controls {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 14px;
          border-top: 1px solid #1E1E3A;
        }
        .vs-time { font-size: 11px; color: #5A5A80; font-variant-numeric: tabular-nums; }
        .vs-play-btn {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: none;
          background: linear-gradient(135deg,#8B5CF6,#EC4899);
          color: #fff;
          font-size: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          box-shadow: 0 4px 12px rgba(139,92,246,.4);
        }
        .vs-play-btn:hover { transform: scale(1.1); box-shadow: 0 6px 18px rgba(139,92,246,.5); }
        .vs-regen-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          background: #0E0E20;
          border: 1px solid #1E1E3A;
          border-radius: 10px;
          margin-bottom: 14px;
        }
        .vs-regen-btn {
          padding: 5px 14px;
          border-radius: 6px;
          border: 1px solid rgba(139,92,246,.3);
          background: rgba(139,92,246,.08);
          color: #8B5CF6;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .vs-regen-btn:hover { background: rgba(139,92,246,.16); }
        .vs-dl-row {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .vs-dl-btn {
          padding: 10px 20px;
          border-radius: 8px;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.25s;
        }
        .vs-dl-btn--primary {
          background: linear-gradient(135deg,#8B5CF6,#EC4899,#06B6D4);
          border: none;
          color: #fff;
          flex: 1;
          min-width: 120px;
        }
        .vs-dl-btn--primary:hover { box-shadow: 0 8px 24px rgba(139,92,246,.4); transform: translateY(-1px); }
        .vs-dl-btn--outline {
          background: transparent;
          border: 1px solid #2A2A4A;
          color: #C4C4E0;
        }
        .vs-dl-btn--outline:hover { border-color: #8B5CF6; color: #8B5CF6; }
      `}</style>
    </>
  )
}
