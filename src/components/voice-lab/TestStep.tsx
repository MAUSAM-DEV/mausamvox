'use client'

import { useRef, useEffect } from 'react'

interface TestStepProps {
  testPlaying: boolean
  setTestPlaying: (v: boolean) => void
  onToast: (m: string) => void
  onTrainAnother: () => void
}

function TestBarsCanvas({ playing }: { playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>()
  const tRef = useRef(0)
  const playingRef = useRef(playing)

  useEffect(() => { playingRef.current = playing }, [playing])

  useEffect(() => {
    function draw() {
      const c = canvasRef.current
      if (!c) return
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
      grd.addColorStop(0, 'rgba(139,92,246,.9)')
      grd.addColorStop(0.5, 'rgba(236,72,153,.9)')
      grd.addColorStop(1, 'rgba(6,182,212,.9)')
      ctx.fillStyle = grd
      for (let i = 0; i < count; i++) {
        const h = playingRef.current
          ? Math.max(4, (Math.sin(tRef.current / 3 + i * 0.4) * 0.5 + 0.5) * 28)
          : (Math.sin(i * 0.35) * 0.4 + 0.5) * 26 + 4
        ctx.fillRect(i * step, (H - h) / 2, bw, h)
      }
      if (playingRef.current) tRef.current++
      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  return <canvas ref={canvasRef} style={{ flex: 1, height: 32, display: 'block' }} />
}

export function TestStep({ testPlaying, setTestPlaying, onToast, onTrainAnother }: TestStepProps) {
  const playTimerRef = useRef<ReturnType<typeof setTimeout>>()

  function handlePlay() {
    const next = !testPlaying
    setTestPlaying(next)
    if (next) {
      onToast('Playing your voice demo…')
      clearTimeout(playTimerRef.current)
      playTimerRef.current = setTimeout(() => setTestPlaying(false), 12000)
    } else {
      clearTimeout(playTimerRef.current)
      onToast('Paused')
    }
  }

  useEffect(() => {
    return () => clearTimeout(playTimerRef.current)
  }, [])

  return (
    <>
      <div className="vlte-stage">
        <div className="vlte-badge">🎉</div>
        <div className="vlte-h">Your voice is ready!</div>
        <p className="vlte-p">
          Studio Clone trained · Final quality score: <b>91/100</b> — excellent
        </p>

        <div className="vlte-test-row">
          <button className="vlte-play-btn" onClick={handlePlay}>
            {testPlaying ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="4" width="4" height="16"/>
                <rect x="14" y="4" width="4" height="16"/>
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="white">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>
          <TestBarsCanvas playing={testPlaying} />
          <span className="vlte-test-lbl">Demo: your voice singing 12 sec</span>
        </div>

        <div className="vlte-actions">
          <button className="vlte-btn-main" onClick={() => onToast('Opening Voice Swap with your new voice…')}>
            Swap a Song With It
          </button>
          <button className="vlte-btn-sec" onClick={() => onToast('Voice saved to My Voices')}>
            Save to My Voices
          </button>
          <button className="vlte-btn-sec" onClick={onTrainAnother}>
            Train Another
          </button>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .vlte-stage {
          background: #121225;
          border: 1px solid #1E1E3A;
          border-radius: 14px;
          padding: 40px 32px;
          text-align: center;
          position: relative;
          overflow: hidden;
          animation: vlFadeUp 0.3s ease;
        }
        @keyframes vlFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .vlte-stage::before {
          content: '';
          position: absolute;
          top: -80px; left: 50%; transform: translateX(-50%);
          width: 460px; height: 240px; border-radius: 50%;
          background: radial-gradient(ellipse, rgba(16,185,129,.12), transparent 70%);
          pointer-events: none;
        }
        .vlte-badge {
          width: 76px; height: 76px; border-radius: 50%;
          margin: 0 auto 20px;
          background: rgba(16,185,129,.1);
          border: 2px solid rgba(16,185,129,.35);
          display: flex; align-items: center; justify-content: center;
          font-size: 32px; position: relative;
          animation: vltePop 0.5s cubic-bezier(.34,1.56,.64,1);
        }
        @keyframes vltePop { from { transform: scale(0); } to { transform: scale(1); } }
        .vlte-h {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 22px; font-weight: 700; color: #F0F0FF;
          margin-bottom: 6px; position: relative;
        }
        .vlte-p { font-size: 13px; color: #5A5A80; margin-bottom: 24px; position: relative; }
        .vlte-p b {
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          font-weight: 600;
        }
        .vlte-test-row {
          display: flex; align-items: center; gap: 12px;
          max-width: 440px; margin: 0 auto 24px;
          background: #0E0E20; border: 1px solid #1E1E3A;
          border-radius: 12px; padding: 14px 16px; position: relative;
        }
        .vlte-play-btn {
          width: 40px; height: 40px; border-radius: 50%; border: none; flex-shrink: 0;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          cursor: pointer; transition: all 0.25s;
          display: flex; align-items: center; justify-content: center;
        }
        .vlte-play-btn:hover { transform: scale(1.08); box-shadow: 0 6px 18px rgba(139,92,246,.4); }
        .vlte-test-lbl { font-size: 11px; color: #5A5A80; flex-shrink: 0; }
        .vlte-actions {
          display: flex; gap: 10px; justify-content: center;
          flex-wrap: wrap; position: relative;
        }
        .vlte-btn-main {
          padding: 11px 24px; border-radius: 8px; border: none;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600;
          cursor: pointer; transition: all 0.25s; white-space: nowrap;
        }
        .vlte-btn-main:hover { box-shadow: 0 8px 26px rgba(139,92,246,.4); transform: translateY(-1px); }
        .vlte-btn-sec {
          padding: 11px 20px; border-radius: 8px;
          border: 1px solid #272745; background: transparent;
          color: #C4C4E0; font-size: 13px; font-weight: 500;
          cursor: pointer; transition: all 0.2s; white-space: nowrap;
        }
        .vlte-btn-sec:hover { border-color: #8B5CF6; color: #8B5CF6; }

        @media (max-width: 900px) {
          .vlte-stage { padding: 32px 18px; }
          .vlte-actions { flex-direction: column; align-items: stretch; }
        }
      `}</style>
    </>
  )
}
