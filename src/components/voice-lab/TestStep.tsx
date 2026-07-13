'use client'

import { useRef, useEffect, useState, useCallback } from 'react'
import type { SavedVoice } from './RecordStep'

interface TestStepProps {
  testPlaying: boolean
  setTestPlaying: (v: boolean) => void
  onToast: (m: string) => void
  onTrainAnother: () => void
  savedVoice: SavedVoice | null
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
      grd.addColorStop(0, 'rgba(157,92,255,.9)')
      grd.addColorStop(0.5, 'rgba(249,69,158,.9)')
      grd.addColorStop(1, 'rgba(12,199,232,.9)')
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

export function TestStep({ testPlaying, setTestPlaying, onToast, onTrainAnother, savedVoice }: TestStepProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [freshSampleUrl, setFreshSampleUrl] = useState<string | null>(null)
  const [sampleStatus, setSampleStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  // Bumped on each load so a slow response for a previous voice (or before a
  // manual retry) can't overwrite the current one.
  const loadSeqRef = useRef(0)

  // Always mint a FRESH signed URL from the durable sample_path via
  // /api/voice-lab/sample-url. There is no stored-sample_url fallback anymore —
  // that column held a 24h URL that expired and caused "voice expired" on
  // playback. The sign-on-read endpoint is the single source of truth.
  const loadSampleUrl = useCallback(() => {
    if (!savedVoice?.id) { setSampleStatus('failed'); return }
    const seq = ++loadSeqRef.current
    setSampleStatus('loading')
    setFreshSampleUrl(null)
    fetch(`/api/voice-lab/sample-url?id=${encodeURIComponent(savedVoice.id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (loadSeqRef.current !== seq) return
        if (d.signedUrl) { setFreshSampleUrl(d.signedUrl); setSampleStatus('ready') }
        else setSampleStatus('failed')
      })
      .catch(() => { if (loadSeqRef.current === seq) setSampleStatus('failed') })
  }, [savedVoice?.id])

  useEffect(() => { loadSampleUrl() }, [loadSampleUrl])

  const activeSampleUrl = freshSampleUrl

  function handlePlay() {
    const audio = audioRef.current
    if (!audio || !activeSampleUrl) {
      onToast('No sample audio available')
      return
    }
    if (testPlaying) {
      audio.pause()
      setTestPlaying(false)
    } else {
      audio.currentTime = 0
      audio.play()
        .then(() => setTestPlaying(true))
        .catch(() => { onToast('Could not play audio — sample URL may have expired'); setTestPlaying(false) })
    }
  }

  // Clean up on unmount
  useEffect(() => {
    return () => {
      audioRef.current?.pause()
    }
  }, [])

  const voiceName = savedVoice?.name ?? 'Your Voice'
  const isExpress = savedVoice?.type !== 'studio'

  return (
    <>
      {/* Hidden audio element — src is the fresh signed URL (sign-on-read).
          Renders only once the sign-on-read fetch has resolved successfully. */}
      {activeSampleUrl && (
        <audio
          ref={audioRef}
          src={activeSampleUrl}
          onEnded={() => setTestPlaying(false)}
          preload="metadata"
        />
      )}

      <div className="vlte-stage">
        <div className="vlte-badge">🎉</div>
        <div className="vlte-h">{voiceName} is ready!</div>
        <p className="vlte-p">
          {isExpress ? 'Express Clone' : 'Studio Clone'} saved · Now available in Voice Swap
        </p>

        <div className="vlte-test-row">
          {/* Disabled until the signed URL has resolved — clicking Play before
              then is the race that produced "No sample audio available" on first
              load (the audio element isn't mounted yet). A spinner shows the wait. */}
          <button
            className="vlte-play-btn"
            onClick={handlePlay}
            disabled={sampleStatus !== 'ready'}
            aria-busy={sampleStatus === 'loading'}
            title={
              sampleStatus === 'loading' ? 'Loading sample…'
                : sampleStatus === 'failed' ? 'Sample unavailable'
                : undefined
            }
          >
            {sampleStatus === 'loading' ? (
              <span className="vlte-play-spinner" aria-hidden="true" />
            ) : testPlaying ? (
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
          <span className="vlte-test-lbl">
            {sampleStatus === 'loading' ? 'Loading sample…'
              : sampleStatus === 'failed' ? 'Sample unavailable'
              : 'Your recorded sample'}
          </span>
          {sampleStatus === 'failed' && (
            <button className="vlte-retry" onClick={loadSampleUrl}>Retry</button>
          )}
        </div>

        <div className="vlte-actions">
          <button
            className="vlte-btn-main"
            onClick={() => { window.location.href = '/voice-swap' }}
          >
            Swap a Song With It
          </button>
          <button
            className="vlte-btn-sec"
            onClick={() => onToast(`${voiceName} is already saved to My Voices ✓`)}
          >
            Already in My Voices ✓
          </button>
          <button className="vlte-btn-sec" onClick={onTrainAnother}>
            Train Another
          </button>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .vlte-stage {
          background: #121225;
          border: 1px solid #2E2E56;
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
        .vlte-p { font-size: 13px; color: #8E8EB4; margin-bottom: 24px; position: relative; line-height: 1.6; }
        .vlte-test-row {
          display: flex; align-items: center; gap: 12px;
          max-width: 440px; margin: 0 auto 24px;
          background: #0E0E20; border: 1px solid #2E2E56;
          border-radius: 12px; padding: 14px 16px; position: relative;
        }
        .vlte-play-btn {
          width: 40px; height: 40px; border-radius: 50%; border: none; flex-shrink: 0;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          cursor: pointer; transition: all 0.25s;
          display: flex; align-items: center; justify-content: center;
        }
        .vlte-play-btn:hover:not(:disabled) { transform: scale(1.08); box-shadow: 0 6px 18px rgba(157,92,255,.4); }
        .vlte-play-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .vlte-play-spinner {
          width: 16px; height: 16px; border-radius: 50%; display: block;
          border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
          animation: vlteSpin 0.7s linear infinite;
        }
        @keyframes vlteSpin { to { transform: rotate(360deg); } }
        .vlte-test-lbl { font-size: 11px; color: #8E8EB4; flex-shrink: 0; }
        .vlte-retry {
          background: transparent; border: 1px solid #383866; border-radius: 6px;
          color: #9D5CFF; font-size: 11px; font-weight: 600; padding: 3px 10px;
          cursor: pointer; flex-shrink: 0; transition: all 0.2s;
        }
        .vlte-retry:hover { border-color: #9D5CFF; }
        .vlte-actions {
          display: flex; gap: 10px; justify-content: center;
          flex-wrap: wrap; position: relative;
        }
        .vlte-btn-main {
          padding: 11px 24px; border-radius: 8px; border: none;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600;
          cursor: pointer; transition: all 0.25s; white-space: nowrap;
        }
        .vlte-btn-main:hover { box-shadow: 0 8px 26px rgba(157,92,255,.4); transform: translateY(-1px); }
        .vlte-btn-sec {
          padding: 11px 20px; border-radius: 8px;
          border: 1px solid #383866; background: transparent;
          color: #C4C4E0; font-size: 13px; font-weight: 500;
          cursor: pointer; transition: all 0.2s; white-space: nowrap;
        }
        .vlte-btn-sec:hover { border-color: #9D5CFF; color: #9D5CFF; }

        @media (max-width: 900px) {
          .vlte-stage { padding: 32px 18px; }
          .vlte-actions { flex-direction: column; align-items: stretch; }
        }
      `}</style>
    </>
  )
}
