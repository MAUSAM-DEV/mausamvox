'use client'

import { useEffect, useRef, useState } from 'react'
import type { Persona } from './OnboardingPage'

// ─── content ─────────────────────────────────────────────────────────────────
const ACTION_CONTENT = {
  artist:   { eyebrow: 'Step 1 of 2 — 15 seconds', title: 'Say this line.',      sub: "Just 15 seconds — we'll build an instant preview of your voice." },
  producer: { eyebrow: 'Step 1 of 2 — pick a beat', title: 'Choose your canvas.', sub: "Pick a demo beat — we'll add a pro vocal from our licensed library." },
  creator:  { eyebrow: 'Step 1 of 2 — pick a vibe', title: 'Pick your vibe.',     sub: "Choose a voice style — we'll generate a scroll-stopping audio clip instantly." },
}

const PRODUCER_OPTS = [
  { emoji: '🔥', name: 'Midnight Trap', sub: '140 BPM · F# minor' },
  { emoji: '🌊', name: 'Lo-fi Dreams',  sub: '82 BPM · C major' },
  { emoji: '⚡',  name: 'Desi Drill',    sub: '144 BPM · A minor' },
]

const CREATOR_OPTS = [
  { emoji: '😤', name: 'Hype Voice',        sub: 'High energy · viral intros' },
  { emoji: '🎬', name: 'Cinematic Trailer', sub: 'Deep · dramatic' },
  { emoji: '✨', name: 'Soft Aesthetic',    sub: 'Calm · storytelling' },
]

// ─── static mini waveform ─────────────────────────────────────────────────────
const MINI_HEIGHTS = Array.from({ length: 22 }, (_, i) =>
  (Math.sin(i * 0.6) * 0.4 + 0.55) * 15 + 2
)

function MiniWave() {
  return (
    <div className="oba-opt-mini">
      {MINI_HEIGHTS.map((h, i) => (
        <div key={i} className="oba-om" style={{ height: `${h}px` }} />
      ))}
    </div>
  )
}

// ─── mic canvas ───────────────────────────────────────────────────────────────
function MicCanvas({ recording }: { recording: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef<number>()
  const tRef      = useRef(0)
  const recRef    = useRef(recording)

  useEffect(() => { recRef.current = recording }, [recording])

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

      if (recRef.current) {
        ctx.save()
        ctx.scale(dpr, dpr)
        const bw = 3, gap = 2.5, step = bw + gap
        const count = Math.floor(W / step)
        const grd = ctx.createLinearGradient(0, 0, W, 0)
        grd.addColorStop(0,   'rgba(139,92,246,.9)')
        grd.addColorStop(0.5, 'rgba(236,72,153,.9)')
        grd.addColorStop(1,   'rgba(6,182,212,.9)')
        ctx.fillStyle = grd
        for (let i = 0; i < count; i++) {
          const base = Math.sin(tRef.current / 12 + i * 0.4) * 0.5 + 0.5
          const h = Math.max(3, (base * 0.45 + Math.random() * 0.55) * H * 0.72)
          ctx.fillRect(i * step, (H - h) / 2, bw, h)
        }
        tRef.current++
        ctx.restore()
      }

      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
    />
  )
}

// ─── component ────────────────────────────────────────────────────────────────
interface ActionScreenProps {
  persona: Persona
  canContinue: boolean
  onCanContinue: () => void
  onContinue: () => void
  onToast: (m: string) => void
}

export function ActionScreen({
  persona, canContinue, onCanContinue, onContinue, onToast,
}: ActionScreenProps) {
  const [recording, setRecording]     = useState(false)
  const [recStatus, setRecStatus]     = useState<'idle' | 'listening' | 'done'>('idle')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const recTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const content = ACTION_CONTENT[persona]
  const opts = persona === 'producer' ? PRODUCER_OPTS : CREATOR_OPTS

  function handleRecord() {
    if (!recording) {
      setRecording(true)
      setRecStatus('listening')
      recTimerRef.current = setTimeout(() => {
        setRecording(false)
        setRecStatus('done')
        onCanContinue()
        onToast('Voice captured — instant clone ready in seconds')
      }, 4000)
    } else {
      clearTimeout(recTimerRef.current)
      setRecording(false)
      setRecStatus('idle')
    }
  }

  function handleOpt(idx: number) {
    setSelectedIdx(idx)
    onCanContinue()
  }

  useEffect(() => () => clearTimeout(recTimerRef.current), [])

  return (
    <>
      <div className="ob-screen ob-sc-center">
        <div className="ob-eyebrow">{content.eyebrow}</div>
        <h1 className="ob-h1">{content.title}</h1>
        <p className="ob-sub">{content.sub}</p>

        {/* ── artist: mic moment ── */}
        {persona === 'artist' && (
          <div className="oba-mic-stage">
            <div className="oba-mic-line">
              &ldquo;Every <span className="ob-gt">melody</span> finds its way back{' '}
              <span className="ob-gt">home</span>.&rdquo;
            </div>
            <div className="oba-mic-hint">Sing it or say it — any way feels natural</div>

            <div className="oba-mic-row">
              <MicCanvas recording={recording} />
              {!recording && (
                <span className="oba-mic-idle">Tap the mic to start</span>
              )}
            </div>

            <button
              className={`oba-rec-circle${recording ? ' oba-rec-circle--on' : ''}`}
              onClick={handleRecord}
            >
              {recording ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                  <rect x="6"  y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3z" fill="white" />
                  <path d="M19 11a7 7 0 0 1-14 0" />
                  <path d="M12 18v3" />
                </svg>
              )}
            </button>

            <div className="oba-rec-status">
              {recStatus === 'idle'      && 'Ready when you are'}
              {recStatus === 'listening' && <span>Listening… <b>speak or sing naturally</b></span>}
              {recStatus === 'done'      && <span>✓ <b>Got it!</b> Instant clone building…</span>}
            </div>
          </div>
        )}

        {/* ── producer / creator: option grid ── */}
        {persona !== 'artist' && (
          <div className="oba-opt-grid">
            {opts.map((opt, idx) => (
              <div
                key={opt.name}
                className={`oba-opt${selectedIdx === idx ? ' oba-opt--on' : ''}`}
                onClick={() => handleOpt(idx)}
              >
                <div className="oba-opt-ico">{opt.emoji}</div>
                <div className="oba-opt-name">{opt.name}</div>
                <div className="oba-opt-sub">{opt.sub}</div>
                <MiniWave />
              </div>
            ))}
          </div>
        )}

        <div className="ob-btn-row">
          <button className="ob-btn-big" disabled={!canContinue} onClick={onContinue}>
            Continue
          </button>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        /* mic stage */
        .oba-mic-stage {
          max-width: 560px; margin: 0 auto 28px;
          background: #121225; border: 1px solid #1E1E3A; border-radius: 16px;
          padding: 30px 28px; text-align: center;
        }
        .oba-mic-line {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 19px; font-weight: 500; line-height: 1.5; margin-bottom: 4px;
        }
        .oba-mic-hint { font-size: 11px; color: #5A5A80; margin-bottom: 20px; }
        .oba-mic-row {
          height: 64px; border-radius: 11px; margin-bottom: 20px;
          background: #0E0E20; border: 1px solid #1E1E3A;
          position: relative; overflow: hidden;
        }
        .oba-mic-idle {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 12px; color: #5A5A80; pointer-events: none;
        }
        .oba-rec-circle {
          width: 60px; height: 60px; border-radius: 50%; border: none; cursor: pointer;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          display: inline-flex; align-items: center; justify-content: center;
          transition: all .25s;
        }
        .oba-rec-circle:hover { transform: scale(1.07); box-shadow: 0 10px 30px rgba(236,72,153,.4); }
        .oba-rec-circle--on { background: #EF4444 !important; animation: obaRp 1.5s ease infinite; }
        @keyframes obaRp {
          0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,.4); }
          50%      { box-shadow: 0 0 0 13px rgba(239,68,68,0); }
        }
        .oba-rec-status { font-size: 12px; color: #5A5A80; margin-top: 12px; min-height: 18px; }
        .oba-rec-status b { color: #C4C4E0; }

        /* option grid */
        .oba-opt-grid {
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 12px; max-width: 760px; margin: 0 auto 28px;
        }
        .oba-opt {
          background: #121225; border: 1px solid #1E1E3A; border-radius: 13px;
          padding: 20px 16px; cursor: pointer; transition: all .25s;
          text-align: center; position: relative;
        }
        .oba-opt:hover { border-color: rgba(139,92,246,.4); transform: translateY(-3px); }
        .oba-opt--on { border-color: #8B5CF6; background: rgba(139,92,246,.07); }
        .oba-opt--on::after {
          content: '✓'; position: absolute; top: 9px; right: 11px;
          font-size: 10px; font-weight: 700; color: #8B5CF6;
        }
        .oba-opt-ico {
          width: 46px; height: 46px; border-radius: 12px; margin: 0 auto 12px;
          background: linear-gradient(135deg, rgba(139,92,246,.18), rgba(236,72,153,.12));
          border: 1px solid rgba(139,92,246,.2);
          display: flex; align-items: center; justify-content: center; font-size: 20px;
        }
        .oba-opt-name { font-size: 13px; font-weight: 600; color: #F0F0FF; }
        .oba-opt-sub  { font-size: 11px; color: #5A5A80; margin-top: 3px; }
        .oba-opt-mini {
          display: flex; align-items: center; justify-content: center;
          gap: 1.5px; height: 20px; margin-top: 10px; overflow: hidden;
        }
        .oba-om {
          width: 2px; border-radius: 1px; flex-shrink: 0;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
        }

        @media (max-width: 760px) {
          .oba-opt-grid { grid-template-columns: 1fr; }
          .oba-mic-stage { padding: 22px 16px; }
          .oba-mic-line  { font-size: 16px; }
        }
      `}</style>
    </>
  )
}
