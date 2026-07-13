'use client'

import { useEffect, useRef, useState } from 'react'
import { formatTime, pickRecorderMimeType, MIN_DURATION_SEC } from './audioUtils'
import { MicCheckWizard, RecordingQualityMonitor } from '@/components/recording/MicCheckWizard'
import type { MicMeter } from '@/components/recording/micMeter'

// 'requesting' is handled inside MicCheckWizard now (permission → room noise
// check → countdown); this panel takes over at 'recording'.
type Phase = 'idle' | 'recording' | 'recorded' | 'error'

interface QuickRecordPanelProps {
  onCaptured: (blob: Blob, mimeType: string, durationSec: number) => void
  onReset: () => void
}

function LiveWaveCanvas({ analyser, active }: { analyser: AnalyserNode | null; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>()

  useEffect(() => {
    if (!active || !analyser) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      const c = canvasRef.current
      const ctx = c?.getContext('2d')
      if (c && ctx) ctx.clearRect(0, 0, c.width, c.height)
      return
    }

    const a = analyser
    const data = new Uint8Array(a.fftSize)

    function draw() {
      const c = canvasRef.current
      const ctx = c?.getContext('2d')
      if (!c || !ctx) { rafRef.current = requestAnimationFrame(draw); return }
      const dpr = window.devicePixelRatio || 1
      const W = c.offsetWidth, H = c.offsetHeight
      if (c.width !== W * dpr) c.width = W * dpr
      if (c.height !== H * dpr) c.height = H * dpr

      a.getByteTimeDomainData(data)

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, W, H)
      const grd = ctx.createLinearGradient(0, 0, W, 0)
      grd.addColorStop(0, '#9D5CFF')
      grd.addColorStop(0.5, '#F9459E')
      grd.addColorStop(1, '#0CC7E8')
      ctx.strokeStyle = grd
      ctx.lineWidth = 1.8
      ctx.beginPath()
      const step = W / data.length
      for (let i = 0; i < data.length; i++) {
        const y = (data[i] / 255) * H
        i === 0 ? ctx.moveTo(0, y) : ctx.lineTo(i * step, y)
      }
      ctx.stroke()
      ctx.restore()
      rafRef.current = requestAnimationFrame(draw)
    }
    rafRef.current = requestAnimationFrame(draw)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [analyser, active])

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: 88, background: '#0E0E20', border: '1px solid #2E2E56', borderRadius: 12 }}
    />
  )
}

export function QuickRecordPanel({ onCaptured, onReset }: QuickRecordPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [seconds, setSeconds] = useState(0)
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  // Metering (level/clip/spike + the waveform's AnalyserNode) comes from the
  // MicCheckWizard's MicMeter — this panel no longer builds its own AudioContext.
  const meterRef = useRef<MicMeter | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval>>()
  const secondsRef = useRef(0)
  const mimeTypeRef = useRef<string>('audio/webm')

  function cleanupStream() {
    clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    meterRef.current?.close()
    meterRef.current = null
  }

  useEffect(() => () => cleanupStream(), [])

  // The wizard already got permission, checked the room and counted the user
  // in — it hands over a live stream + meter, and recording starts immediately.
  function beginRecording(stream: MediaStream, meter: MicMeter) {
    setErrorMsg('')
    try {
      streamRef.current = stream
      meterRef.current = meter
      setDeviceLabel(stream.getAudioTracks()[0]?.label || 'Default microphone')

      const mimeType = pickRecorderMimeType()
      mimeTypeRef.current = mimeType ?? ''
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      chunksRef.current = []

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        const finalMime = mimeTypeRef.current || recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: finalMime })
        const url = URL.createObjectURL(blob)
        setPreviewUrl(url)
        setPhase('recorded')
        cleanupStream()
        onCaptured(blob, finalMime, secondsRef.current)
      }

      recorderRef.current = recorder
      recorder.start()
      secondsRef.current = 0
      setSeconds(0)
      setPhase('recording')
      timerRef.current = setInterval(() => {
        secondsRef.current += 1
        setSeconds((s) => s + 1)
      }, 1000)
    } catch {
      cleanupStream()
      setPhase('error')
      setErrorMsg('Could not start recording in this browser — try Upload Recording instead.')
    }
  }

  function handleStop() {
    recorderRef.current?.stop()
  }

  function handleRerecord() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    secondsRef.current = 0
    setSeconds(0)
    setPhase('idle')
    onReset()
  }

  const meetsMinimum = seconds >= MIN_DURATION_SEC

  return (
    <div className="qr-panel">
      {phase === 'idle' && (
        typeof MediaRecorder === 'undefined' ? (
          <div className="qr-error">Recording isn’t supported in this browser — try Upload Recording instead.</div>
        ) : (
          <MicCheckWizard
            audio={true}
            onReady={beginRecording}
            triggerLabel="⏺ Start Recording"
            triggerClassName="qr-btn qr-btn--main"
          />
        )
      )}

      {(phase === 'recording' || phase === 'recorded') && (
        <>
          {deviceLabel && <div className="qr-device">🎙️ Using: {deviceLabel}</div>}
          <LiveWaveCanvas analyser={meterRef.current?.analyser ?? null} active={phase === 'recording'} />
          <div className={`qr-timer ${phase === 'recording' && meetsMinimum ? 'qr-timer--ok' : ''}`}>
            {formatTime(seconds)} <span className="qr-timer-min">/ 0:{MIN_DURATION_SEC} minimum</span>
          </div>

          {phase === 'recording' && (
            <>
              <RecordingQualityMonitor meter={meterRef.current} />
              <button className="qr-btn qr-btn--stop" onClick={handleStop}>
                ⏹ Stop Recording
              </button>
            </>
          )}

          {phase === 'recorded' && previewUrl && (
            <>
              <audio className="qr-audio" src={previewUrl} controls />
              {!meetsMinimum && (
                <div className="qr-warn">Only {formatTime(seconds)} recorded — need at least 0:{MIN_DURATION_SEC} for a usable clone.</div>
              )}
              <button className="qr-btn qr-btn--outline" onClick={handleRerecord}>
                ↺ Re-record
              </button>
            </>
          )}
        </>
      )}

      {phase === 'error' && (
        <div className="qr-error">
          {errorMsg}
          <button className="qr-btn qr-btn--outline" onClick={() => setPhase('idle')} style={{ marginTop: 10 }}>
            Try Again
          </button>
        </div>
      )}

      <style suppressHydrationWarning>{`
        .qr-panel { display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
        .qr-status { font-size: 13px; color: #9D5CFF; padding: 16px 0; }
        .qr-device { font-size: 11px; color: #8E8EB4; }
        .qr-timer { font-family: var(--font-grotesk), 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 700; color: #C4C4E0; }
        .qr-timer--ok { color: #10B981; }
        .qr-timer-min { font-size: 11px; font-weight: 400; color: #8E8EB4; }
        .qr-audio { width: 100%; max-width: 420px; }
        .qr-warn { font-size: 12px; color: #F59E0B; max-width: 420px; }
        .qr-error { font-size: 13px; color: #F87171; max-width: 420px; }
        .qr-btn {
          padding: 11px 24px; border-radius: 8px; border: none;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .qr-btn--main { background: linear-gradient(135deg,#9D5CFF,#F9459E,#0CC7E8); color: #fff; }
        .qr-btn--main:hover { box-shadow: 0 8px 24px rgba(157,92,255,.4); transform: translateY(-1px); }
        .qr-btn--stop { background: #EF4444; color: #fff; }
        .qr-btn--stop:hover { box-shadow: 0 8px 24px rgba(239,68,68,.4); }
        .qr-btn--outline { background: transparent; border: 1px solid #3C3C6A; color: #C4C4E0; }
        .qr-btn--outline:hover { border-color: #9D5CFF; color: #9D5CFF; }
      `}</style>
    </div>
  )
}
