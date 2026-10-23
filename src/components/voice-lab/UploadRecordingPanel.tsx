'use client'

import { useEffect, useRef, useState } from 'react'
import { formatTime, MIN_DURATION_SEC } from './audioUtils'

type Phase = 'idle' | 'validating' | 'ready' | 'error'

interface UploadRecordingPanelProps {
  // storedPath: the server already stored it (converted to WAV) — nothing left to upload
  onCaptured: (blob: Blob, mimeType: string, durationSec: number, storedPath?: string) => void
  onReset: () => void
}

const ACCEPTED_EXTS = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'webm', 'aif', 'aiff', 'caf']
// Kept exactly as uploaded only when every browser can play it back: WAV, MP3 and AAC (.m4a).
// Everything else — and anything this browser can't decode, e.g. iPhone Voice Memos lossless
// (Apple Lossless / ALAC, which Chrome and Firefox can't read) — is converted to WAV on the server.
const DIRECT_MIME_BY_EXT: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4' }

// An .m4a holding Apple Lossless names its codec 'alac' in the file's track description.
function isAppleLossless(bytes: Uint8Array): boolean {
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 0x61 && bytes[i + 1] === 0x6c && bytes[i + 2] === 0x61 && bytes[i + 3] === 0x63) return true
  }
  return false
}

interface Converted { path: string; mime: string; durationSec: number; peaks: number[]; previewUrl: string | null }

// Store the original as-is, have the server turn it into a WAV (/api/voice-lab/convert-sample).
async function convertOnServer(file: File, ext: string): Promise<Converted> {
  const presignRes = await fetch('/api/voice-lab/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: file.type, incoming: true, fileExt: ext }),
  })
  const presign = await presignRes.json()
  if (!presignRes.ok) throw new Error(presign.error ?? 'Could not get upload URL')
  const putRes = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': presign.mime }, body: file })
  if (!putRes.ok) throw new Error(`Upload failed (${putRes.status}) — please try again.`)
  const res = await fetch('/api/voice-lab/convert-sample', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: presign.path }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? 'Converting took too long — a temporary hiccup. Please choose the file again in a minute.')
  return data as Converted
}

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
    return `Supported: WAV, MP3, M4A (including iPhone lossless), AAC, FLAC, OGG, OPUS, WEBM, AIFF, CAF (got .${ext || 'unknown'}).`
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
  const [status, setStatus] = useState('')
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
    setStatus(`Checking ${file.name}…`)

    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const url = URL.createObjectURL(file)
    const arrayBuffer = await file.arrayBuffer()
    const directMime = DIRECT_MIME_BY_EXT[ext]
    if (!directMime || (ext === 'm4a' && isAppleLossless(new Uint8Array(arrayBuffer)))) {
      URL.revokeObjectURL(url)
      await processOnServer(file, ext)
      return
    }

    // Duration via decodeAudioData where possible — it's the most reliable
    // cross-browser way to get both length and PCM data for the waveform.
    let durationSec = 0
    const computedPeaks: number[] = []
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
      // This browser can't decode it — the server converts it (and measures it) instead.
      URL.revokeObjectURL(url)
      await processOnServer(file, ext)
      return
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
    onCaptured(file, file.type || directMime, durationSec)
  }

  async function processOnServer(file: File, ext: string) {
    setStatus(`Converting ${file.name} so it plays everywhere — this can take up to a minute…`)
    try {
      const c = await convertOnServer(file, ext)
      if (c.durationSec < MIN_DURATION_SEC) {
        setPhase('error')
        setErrorMsg(`This file is only ${formatTime(c.durationSec)} long — need at least 0:${MIN_DURATION_SEC} for a usable clone.`)
        return
      }
      setDuration(c.durationSec)
      setPeaks(c.peaks)
      setPreviewUrl(c.previewUrl)
      setPhase('ready')
      onCaptured(file, c.mime, c.durationSec, c.path)
    } catch (err) {
      setPhase('error')
      setErrorMsg(err instanceof Error ? err.message : 'Could not read this recording — please try again.')
    }
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
        accept=".wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.webm,.aif,.aiff,.caf,audio/*"
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
          <div className="ul-sub">or click to browse · WAV, MP3, M4A, FLAC and more · min 0:{MIN_DURATION_SEC}</div>
        </div>
      )}

      {phase === 'validating' && <div className="ul-status">{status}</div>}

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
