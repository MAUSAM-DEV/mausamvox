'use client'

import { useRef, useEffect } from 'react'
import type { QualityMeters } from './VoiceLabPage'

type Lang = 'english' | 'hindi'

interface RecordStepProps {
  recording: boolean
  recSeconds: number
  lang: Lang
  setLang: (l: Lang) => void
  sentenceIdx: number
  qualityMeters: QualityMeters
  onToggleRecord: () => void
  onNextSentence: () => void
  onPrevSentence: () => void
}

const SENTENCES = [
  'The river knows my name…',
  'Sing louder than the storm…',
  'हर सुबह एक नई धुन…',
  'Whisper low, rise slowly…',
  'Golden hour, fading light…',
  'तुम्हारी आवाज़ में जादू है…',
  'The morning rain sings…',
  'Count the stars with me…',
  'दिल की बात सुनो…',
  'Echoes of a distant drum…',
  'Hold the note, let it soar…',
  'आख़िरी गीत साथ गाओ…',
]

const MIN_SECONDS = 600 // 10 minutes
const RING_R = 25
const RING_CIRC = 2 * Math.PI * RING_R

function fmt(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

function meterStatus(pct: number, kind: keyof QualityMeters): { cls: string; label: string } {
  if (kind === 'volume') {
    if (pct >= 50 && pct <= 85) return { cls: 'ok', label: 'GOOD' }
    if (pct < 30 || pct > 92) return { cls: 'bad', label: 'LOW' }
    return { cls: 'warn', label: 'FAIR' }
  }
  if (kind === 'noise' || kind === 'clip') {
    if (pct < 25) return { cls: 'ok', label: 'GOOD' }
    if (pct < 50) return { cls: 'warn', label: 'FAIR' }
    return { cls: 'bad', label: 'HIGH' }
  }
  if (pct < 30) return { cls: 'ok', label: 'GOOD' }
  if (pct < 55) return { cls: 'warn', label: 'FAIR' }
  return { cls: 'bad', label: 'HIGH' }
}

function MicVisCanvas({ recording }: { recording: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>()
  const recRef = useRef(recording)

  useEffect(() => { recRef.current = recording }, [recording])

  useEffect(() => {
    function draw(t: number) {
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
      if (recRef.current) {
        const pad = 20, bw = 3, gap = 2.5, step = bw + gap
        const count = Math.floor((W - pad * 2) / step)
        const grd = ctx.createLinearGradient(0, 0, W, 0)
        grd.addColorStop(0, 'rgba(139,92,246,.9)')
        grd.addColorStop(0.5, 'rgba(236,72,153,.9)')
        grd.addColorStop(1, 'rgba(6,182,212,.9)')
        ctx.fillStyle = grd
        for (let i = 0; i < count; i++) {
          const base = Math.sin(t / 180 + i * 0.4) * 0.5 + 0.5
          const noise = Math.random() * 0.55
          const h = Math.max(3, (base * 0.5 + noise * 0.5) * 56)
          ctx.fillRect(pad + i * step, (H - h) / 2, bw, h)
        }
      }
      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  return (
    <div style={{ position: 'relative', height: 88, margin: '24px auto 0', maxWidth: 540, background: '#0E0E20', border: '1px solid #1E1E3A', borderRadius: 12, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', position: 'absolute', inset: 0 }} />
      {!recording && (
        <span style={{ position: 'relative', fontSize: 12, color: '#5A5A80', zIndex: 1 }}>Press record to begin</span>
      )}
    </div>
  )
}

export function RecordStep({
  recording, recSeconds, lang, setLang, sentenceIdx,
  qualityMeters, onToggleRecord, onNextSentence, onPrevSentence,
}: RecordStepProps) {
  const pct = Math.min(1, recSeconds / MIN_SECONDS)
  const dashOffset = RING_CIRC * (1 - pct)
  const remaining = Math.max(0, MIN_SECONDS - recSeconds)

  const meters: { label: string; pct: number; kind: keyof QualityMeters }[] = [
    { label: 'Noise Floor', pct: qualityMeters.noise, kind: 'noise' },
    { label: 'Clipping', pct: qualityMeters.clip, kind: 'clip' },
    { label: 'Room Echo', pct: qualityMeters.echo, kind: 'echo' },
    { label: 'Volume', pct: qualityMeters.volume, kind: 'volume' },
  ]

  return (
    <>
      <div className="vlr-layout">
        {/* Left: prompt card */}
        <div className="vlr-prompt-card">
          <div className="vlr-prompt-head">
            <span className="vlr-prompt-count">
              Sentence <b style={{ color: '#8B5CF6', fontSize: 13 }}>{sentenceIdx + 1}</b> / 12
            </span>
            <div className="vlr-lang-seg">
              {(['english', 'hindi'] as Lang[]).map((l, i) => (
                <div key={l} className={`vlr-lang-opt${lang === l ? ' vlr-lang-opt--on' : ''}`} onClick={() => setLang(l)}>
                  {i === 0 ? 'English' : 'हिन्दी'}
                </div>
              ))}
            </div>
          </div>

          <div className="vlr-prompt-body">
            <div className="vlr-prompt-lbl">Read this aloud — naturally, like you&apos;re singing to a friend</div>
            <div className="vlr-prompt-text">
              {lang === 'english' ? (
                <>&quot;The <span className="vlr-hl">morning rain</span> sings a melody only the mountains remember.&quot;</>
              ) : (
                <>&quot;हर <span className="vlr-hl">सुबह की किरण</span> एक नया गीत लेकर आती है।&quot;</>
              )}
            </div>
            <div className="vlr-prompt-hint">Covers: long vowels · soft consonants · rising pitch</div>

            <MicVisCanvas recording={recording} />

            <div className="vlr-controls">
              <button className="vlr-side-btn" onClick={onPrevSentence} title="Previous">⏮</button>
              <button
                className={`vlr-rec-btn${recording ? ' vlr-rec-btn--on' : ''}`}
                onClick={onToggleRecord}
              >
                {recording ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><circle cx="12" cy="12" r="7"/></svg>
                )}
              </button>
              <button className="vlr-side-btn" onClick={onNextSentence} title="Next">⏭</button>
            </div>
            <div className="vlr-timer">
              {fmt(recSeconds)} <span style={{ color: '#5A5A80', fontSize: 12, fontWeight: 400 }}>/ 10:00 minimum</span>
            </div>
          </div>
        </div>

        {/* Right: quality column */}
        <div className="vlr-quality-col">
          {/* Live mic quality */}
          <div className="vlr-q-card">
            <div className="vlr-q-title">Live Mic Quality</div>
            <div className="vlr-q-meters">
              {meters.map(({ label, pct: p, kind }) => {
                const s = meterStatus(p, kind)
                return (
                  <div key={label} className="vlr-qm-row">
                    <span className="vlr-qm-lbl">{label}</span>
                    <div className="vlr-qm-track">
                      <div className={`vlr-qm-fill vlr-qm-fill--${s.cls}`} style={{ width: `${p}%` }} />
                    </div>
                    <span className={`vlr-qm-status vlr-qm-status--${s.cls}`}>{s.label}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Recording progress ring */}
          <div className="vlr-q-card">
            <div className="vlr-q-title">Recording Progress</div>
            <div className="vlr-ring-wrap">
              <div className="vlr-ring">
                <svg viewBox="0 0 60 60" width="60" height="60" style={{ transform: 'rotate(-90deg)' }}>
                  <defs>
                    <linearGradient id="vlrPrg" x1="0" y1="0" x2="60" y2="60" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#8B5CF6"/>
                      <stop offset="1" stopColor="#EC4899"/>
                    </linearGradient>
                  </defs>
                  <circle cx="30" cy="30" r={RING_R} fill="none" stroke="#1E1E3A" strokeWidth="4.5"/>
                  <circle
                    cx="30" cy="30" r={RING_R}
                    fill="none" stroke="url(#vlrPrg)" strokeWidth="4.5"
                    strokeDasharray={RING_CIRC}
                    strokeDashoffset={dashOffset}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="vlr-ring-pct">{Math.floor(pct * 100)}%</div>
              </div>
              <div className="vlr-ring-meta">
                <b>{fmt(recSeconds)}</b> recorded<br/>
                <b>{fmt(remaining)}</b> remaining<br/>
                Input score: <b style={{ color: '#10B981' }}>84/100</b>
              </div>
            </div>
          </div>

          {/* Sentences checklist */}
          <div className="vlr-q-card vlr-sent-card">
            <div className="vlr-q-title">Sentences</div>
            <div className="vlr-sent-list">
              {SENTENCES.map((text, i) => {
                const done = i < sentenceIdx
                const cur = i === sentenceIdx
                return (
                  <div key={i} className={`vlr-sent${done ? ' vlr-sent--done' : ''}${cur ? ' vlr-sent--cur' : ''}`}>
                    <div className="vlr-sent-dot">{done ? '✓' : i + 1}</div>
                    {text}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .vlr-layout {
          display: grid;
          grid-template-columns: 1fr 280px;
          gap: 16px;
          animation: vlFadeUp 0.3s ease;
        }
        @keyframes vlFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .vlr-prompt-card {
          background: #121225;
          border: 1px solid #1E1E3A;
          border-radius: 14px;
          overflow: hidden;
        }
        .vlr-prompt-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 18px;
          border-bottom: 1px solid #1E1E3A;
        }
        .vlr-prompt-count { font-size: 11px; font-weight: 600; color: #5A5A80; }
        .vlr-lang-seg {
          display: flex; gap: 3px;
          background: #0E0E20; border: 1px solid #1E1E3A;
          border-radius: 7px; padding: 3px;
        }
        .vlr-lang-opt {
          padding: 4px 12px; border-radius: 5px;
          font-size: 11px; font-weight: 500; color: #5A5A80;
          cursor: pointer; transition: all 0.2s;
        }
        .vlr-lang-opt--on { background: #16162C; color: #F0F0FF; }
        .vlr-prompt-body { padding: 32px 28px; text-align: center; }
        .vlr-prompt-lbl {
          font-size: 10px; font-weight: 700;
          letter-spacing: 2px; text-transform: uppercase;
          color: #5A5A80; margin-bottom: 16px;
        }
        .vlr-prompt-text {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 24px; font-weight: 500; line-height: 1.5;
          color: #F0F0FF; max-width: 540px; margin: 0 auto 8px;
        }
        .vlr-hl {
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .vlr-prompt-hint { font-size: 12px; color: #5A5A80; }
        .vlr-controls {
          display: flex; align-items: center; justify-content: center;
          gap: 16px; padding: 20px 0 8px;
        }
        .vlr-rec-btn {
          width: 64px; height: 64px; border-radius: 50%; border: none;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          cursor: pointer; transition: all 0.25s; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
        }
        .vlr-rec-btn:hover { transform: scale(1.07); box-shadow: 0 10px 32px rgba(236,72,153,.4); }
        .vlr-rec-btn--on {
          background: #EF4444 !important;
          animation: vlrPulse 1.6s ease infinite;
        }
        @keyframes vlrPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,.4); }
          50% { box-shadow: 0 0 0 14px rgba(239,68,68,0); }
        }
        .vlr-side-btn {
          width: 42px; height: 42px; border-radius: 50%;
          background: #0E0E20; border: 1px solid #272745; color: #C4C4E0;
          font-size: 15px; cursor: pointer; transition: all 0.2s; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
        }
        .vlr-side-btn:hover { border-color: #8B5CF6; color: #8B5CF6; }
        .vlr-timer {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 15px; font-weight: 600; color: #C4C4E0;
          text-align: center; padding-bottom: 18px;
        }

        /* Quality column */
        .vlr-quality-col { display: flex; flex-direction: column; gap: 12px; }
        .vlr-q-card { background: #121225; border: 1px solid #1E1E3A; border-radius: 12px; padding: 16px; }
        .vlr-sent-card { flex: 1; overflow: hidden; display: flex; flex-direction: column; }
        .vlr-q-title {
          font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
          text-transform: uppercase; color: #5A5A80; margin-bottom: 12px;
        }
        .vlr-q-meters { display: flex; flex-direction: column; gap: 10px; }
        .vlr-qm-row { display: flex; align-items: center; gap: 9px; }
        .vlr-qm-lbl { font-size: 11px; color: #7878A0; width: 72px; flex-shrink: 0; }
        .vlr-qm-track { flex: 1; height: 4px; background: #1E1E3A; border-radius: 2px; overflow: hidden; }
        .vlr-qm-fill { height: 100%; border-radius: 2px; transition: width 0.3s, background 0.3s; }
        .vlr-qm-fill--ok { background: #10B981; }
        .vlr-qm-fill--warn { background: #F59E0B; }
        .vlr-qm-fill--bad { background: #EF4444; }
        .vlr-qm-status { font-size: 10px; font-weight: 700; width: 38px; text-align: right; flex-shrink: 0; }
        .vlr-qm-status--ok { color: #10B981; }
        .vlr-qm-status--warn { color: #F59E0B; }
        .vlr-qm-status--bad { color: #EF4444; }

        /* Ring */
        .vlr-ring-wrap { display: flex; align-items: center; gap: 14px; }
        .vlr-ring { position: relative; width: 60px; height: 60px; flex-shrink: 0; }
        .vlr-ring-pct {
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 14px; font-weight: 700; color: #F0F0FF;
        }
        .vlr-ring-meta { font-size: 11px; color: #5A5A80; line-height: 1.6; }
        .vlr-ring-meta b { color: #C4C4E0; font-weight: 600; }

        /* Sentences */
        .vlr-sent-list {
          display: flex; flex-direction: column; gap: 5px;
          max-height: 180px; overflow-y: auto;
          scrollbar-width: thin; scrollbar-color: #2A2A4A transparent;
        }
        .vlr-sent {
          display: flex; align-items: center; gap: 8px;
          font-size: 11px; color: #5A5A80;
          padding: 5px 8px; border-radius: 6px;
          border: 1px solid transparent; transition: all 0.2s;
        }
        .vlr-sent--done { color: #C4C4E0; background: rgba(16,185,129,.04); }
        .vlr-sent--cur { color: #F0F0FF; background: rgba(139,92,246,.08); border-color: rgba(139,92,246,.18); }
        .vlr-sent-dot {
          width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 8px; font-weight: 700; background: #1E1E3A;
        }
        .vlr-sent--done .vlr-sent-dot { background: rgba(16,185,129,.2); color: #10B981; }
        .vlr-sent--cur .vlr-sent-dot { background: #8B5CF6; color: #fff; }

        @media (max-width: 900px) {
          .vlr-layout { grid-template-columns: 1fr; }
          .vlr-prompt-text { font-size: 18px; }
          .vlr-prompt-body { padding: 24px 16px; }
        }
      `}</style>
    </>
  )
}
