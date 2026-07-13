'use client'

import { useEffect, useRef, useState } from 'react'
import { formatTime, MIN_DURATION_SEC } from './audioUtils'

type Phase = 'idle' | 'validating' | 'ready' | 'error'

interface UploadRecordingPanelProps {
  onCaptured: (blob: Blob, mimeType: string, durationSec: number) => void
  onReset: () => void
}

const ACCEPTED_EXTS = ['wav', 'mp3', 'm4a']

function WaveformPreview({ peaks }: { peaks: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx || peaks.length === 0) return
    const dpr = window.devicePixelRatio || 1
    const W = c.offsetWidth, H = c.offsetHeight
    c.width = W * dpr
    c.height = H * dpr
    ctx.scale(dpr, dpr)
    const grd = ctx.createLinearGradient(0, 0, W, 0)
    grd.addColorStop(0, 'rgba(157,92,255,.85)')
    grd.addColorStop(0.5, 'rgba(249,69,158,.85)')
    grd.addColorStop(1, 'rgba(12,199,232,.85)')
    ctx.fillStyle = grd
    const bw = W / peaks.length
    peaks.forEach((p, i) => {
      const h = Math.max(2, p * H)
      ctx.fillRect(i * bw, (H - h) / 2, Math.max(1, bw - 1), h)
    })
  }, [peaks])

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: 64, background: '#0E0E20', border: '1px solid #2E2E56', borderRadius: 12 }}
    />
  )
}

function validateExt(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ACCEPTED_EXTS.includes(ext)) {
    return `Only WAV, MP3, and M4A files are supported (got .${ext || 'unknown'}).`
  }
  return null
}

export function UploadRecordingPanel({ onCaptured, onReset }: UploadRecordingPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [fileName, setFileName] = useState('')
  const [duration, setDuration] = useState(0)
  const [peaks, setPeaks] = useState<number[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }
  }, [previewUrl])

  async function processFile(file: File) {
    const extError = validateExt(file)
    if (extError) {
      setPhase('error')
      setErrorMsg(extError)
      return
    }

    setPhase('validating')
    setErrorMsg('')
    setFileName(file.name)

    const url = URL.createObjectURL(file)
    const arrayBuffer = await file.arrayBuffer()

    // Duration via decodeAudioData where possible — it's the most reliable
    // cross-browser way to get both length and PCM data for the waveform.
    let durationSec = 0
    let computedPeaks: number[] = []
    try {
      const ctx = new AudioContext()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
      durationSec = audioBuffer.duration
      const channel = audioBuffer.getChannelData(0)
      const bucketCount = 160
      const bucketSize = Math.floor(channel.length / bucketCount)
      if (bucketSize > 0) {
        for (let i = 0; i < bucketCount; i++) {
          let max = 0
          for (let j = i * bucketSize; j < (i + 1) * bucketSize; j++) {
            max = Math.max(max, Math.abs(channel[j]))
          }
          computedPeaks.push(max)
        }
      }
      ctx.close().catch(() => {})
    } catch {
      // Decoding failed (unsupported codec in this browser) — fall back to
      // <audio> metadata for duration and skip the waveform preview.
      durationSec = await new Promise<number>((resolve) => {
        const probe = new Audio()
        probe.src = url
        probe.onloadedmetadata = () => resolve(probe.duration || 0)
        probe.onerror = () => resolve(0)
      })
      computedPeaks = []
    }

    if (durationSec < MIN_DURATION_SEC) {
      URL.revokeObjectURL(url)
      setPhase('error')
      setErrorMsg(`This file is only ${formatTime(durationSec)} long — need at least 0:${MIN_DURATION_SEC} for a usable clone.`)
      return
    }

    setDuration(durationSec)
    setPeaks(computedPeaks)
    setPreviewUrl(url)
    setPhase('ready')
    onCaptured(file, file.type || 'audio/wav', durationSec)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function handleChooseDifferent() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setPhase('idle')
    setErrorMsg('')
    onReset()
  }

  return (
    <div className="ul-panel">
      <input
        ref={fileInputRef}
        type="file"
        accept=".wav,.mp3,.m4a,audio/wav,audio/mpeg,audio/mp4,audio/x-m4a"
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />

      {phase === 'idle' && (
        <div
          className="ul-dropzone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="ul-icon">🎵</div>
          <div className="ul-title">Drop a recording here</div>
          <div className="ul-sub">or click to browse · WAV, MP3, M4A · min 0:{MIN_DURATION_SEC}</div>
        </div>
      )}

      {phase === 'validating' && <div className="ul-status">Checking {fileName}…</div>}

      {phase === 'ready' && previewUrl && (
        <>
          <div className="ul-filename">{fileName} · {formatTime(duration)}</div>
          {peaks.length > 0 && <WaveformPreview peaks={peaks} />}
          <audio className="ul-audio" src={previewUrl} controls />
          <button className="ul-btn ul-btn--outline" onClick={handleChooseDifferent}>
            Choose a Different File
          </button>
        </>
      )}

      {phase === 'error' && (
        <div className="ul-error">
          {errorMsg}
          <button className="ul-btn ul-btn--outline" onClick={handleChooseDifferent} style={{ marginTop: 10 }}>
            Try Again
          </button>
        </div>
      )}

      <style suppressHydrationWarning>{`
        .ul-panel { display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
        .ul-dropzone {
          width: 100%; max-width: 420px;
          border: 1.5px dashed #3C3C6A; border-radius: 14px;
          padding: 36px 20px; text-align: center; cursor: pointer;
          transition: all 0.2s; background: rgba(157,92,255,.02);
        }
        .ul-dropzone:hover { border-color: rgba(157,92,255,.5); background: rgba(157,92,255,.05); }
        .ul-icon { font-size: 28px; margin-bottom: 10px; }
        .ul-title { font-family: var(--font-grotesk), 'Space Grotesk', sans-serif; font-size: 14px; font-weight: 600; color: #F0F0FF; margin-bottom: 4px; }
        .ul-sub { font-size: 12px; color: #8E8EB4; }
        .ul-status { font-size: 13px; color: #9D5CFF; padding: 16px 0; }
        .ul-filename { font-size: 12px; color: #C4C4E0; }
        .ul-audio { width: 100%; max-width: 420px; }
        .ul-error { font-size: 13px; color: #F87171; max-width: 420px; }
        .ul-btn {
          padding: 10px 20px; border-radius: 8px;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .ul-btn--outline { background: transparent; border: 1px solid #3C3C6A; color: #C4C4E0; }
        .ul-btn--outline:hover { border-color: #9D5CFF; color: #9D5CFF; }
      `}</style>
    </div>
  )
}
