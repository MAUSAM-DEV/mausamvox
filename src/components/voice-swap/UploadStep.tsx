'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

type Phase = 'idle' | 'uploading' | 'splitting' | 'done' | 'error'

const ACCEPTED_EXTS = ['mp3', 'wav', 'm4a']
const MAX_BYTES = 50 * 1024 * 1024 // 50 MB

export interface StemResult {
  audioUrl: string
  vocalsUrl: string
  instrumentalUrl: string
  fileName: string
}

interface UploadStepProps {
  userId: string | null
  result: StemResult | null
  onDone: (result: StemResult) => void
  onContinue: () => void
  onToast: (msg: string) => void
}

function UploadWaveCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.offsetWidth * dpr
      canvas.height = canvas.offsetHeight * dpr
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      const W = canvas.offsetWidth
      const H = canvas.offsetHeight
      const grd = ctx.createLinearGradient(0, 0, W, 0)
      grd.addColorStop(0, 'rgba(139,92,246,.7)')
      grd.addColorStop(0.5, 'rgba(236,72,153,.7)')
      grd.addColorStop(1, 'rgba(6,182,212,.7)')
      ctx.fillStyle = grd
      const step = 3.5
      for (let i = 0; i < W / step; i++) {
        const h =
          (Math.sin(i * 0.3) * 0.3 + Math.sin(i * 0.7) * 0.2 + 0.5) * H * 0.75 + H * 0.08
        ctx.fillRect(i * step, (H - h) / 2, 2, h)
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: '100%',
        height: '48px',
        borderRadius: '8px',
        background: '#0E0E20',
        border: '1px solid #1E1E3A',
      }}
    />
  )
}

function validateFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ACCEPTED_EXTS.includes(ext)) {
    return `Only MP3, WAV, and M4A files are supported (got .${ext || 'unknown'}).`
  }
  if (file.size > MAX_BYTES) {
    return `File must be 50 MB or smaller (yours is ${(file.size / 1024 / 1024).toFixed(1)} MB).`
  }
  return null
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function UploadStep({ userId, result, onDone, onContinue, onToast }: UploadStepProps) {
  const [phase, setPhase] = useState<Phase>(result ? 'done' : 'idle')
  const [dragging, setDragging] = useState(false)
  const [currentFile, setCurrentFile] = useState<File | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function processFile(file: File) {
    const validationError = validateFile(file)
    if (validationError) {
      setErrorMsg(validationError)
      setPhase('error')
      return
    }

    setCurrentFile(file)
    setErrorMsg('')
    setPhase('uploading')

    try {
      const supabase = createClient()
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const path = `${userId ?? 'anon'}/${Date.now()}-${safeName}`

      const { error: uploadError } = await supabase.storage
        .from('audio-uploads')
        .upload(path, file, { contentType: file.type || 'audio/mpeg', upsert: false })

      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`)

      const {
        data: { publicUrl: audioUrl },
      } = supabase.storage.from('audio-uploads').getPublicUrl(path)

      setPhase('splitting')

      const res = await fetch('/api/stem-split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl, userId }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Stem split failed')

      const stemResult: StemResult = {
        audioUrl,
        vocalsUrl: data.vocals,
        instrumentalUrl: data.instrumental,
        fileName: file.name,
      }

      onDone(stemResult)
      setPhase('done')
      onToast('Stems separated — vocals and instrumental ready!')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setErrorMsg(msg)
      setPhase('error')
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    // Reset so the same file can be re-selected after a reset
    e.target.value = ''
  }

  function handleReset() {
    setPhase('idle')
    setCurrentFile(null)
    setErrorMsg('')
  }

  const displayFile = currentFile ?? (result ? { name: result.fileName, size: 0 } : null)
  const displayResult = result

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a"
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />

      <div className="vs-panel">
        <div className="vs-panel-title">Upload Your Track</div>
        <div className="vs-panel-sub">MP3, WAV, M4A — up to 50 MB · Stems separated automatically</div>

        {/* ── idle ─────────────────────────────────────────────── */}
        {phase === 'idle' && (
          <div
            className={`vs-upload-zone ${dragging ? 'vs-upload-zone--drag' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="vs-uz-icon">🎵</div>
            <div className="vs-uz-title">Drop your track here</div>
            <div className="vs-uz-sub">or click to browse files</div>
            <div className="vs-uz-formats">MP3 · WAV · M4A · max 50 MB</div>
          </div>
        )}

        {/* ── uploading ────────────────────────────────────────── */}
        {phase === 'uploading' && displayFile && (
          <div className="vs-progress-zone">
            <div className="vs-prog-spinner" />
            <div className="vs-prog-file">{displayFile.name}</div>
            <div className="vs-prog-label">Uploading to storage…</div>
          </div>
        )}

        {/* ── splitting ────────────────────────────────────────── */}
        {phase === 'splitting' && displayFile && (
          <div className="vs-progress-zone">
            <div className="vs-prog-spinner vs-prog-spinner--purple" />
            <div className="vs-prog-file">{displayFile.name}</div>
            <div className="vs-prog-label">Separating vocals… this takes 1–2 minutes</div>
            <div className="vs-prog-sub">Powered by Demucs · running on GPU</div>
          </div>
        )}

        {/* ── done ─────────────────────────────────────────────── */}
        {phase === 'done' && displayFile && displayResult && (
          <div className="vs-loaded-zone">
            <div className="vs-file-header">
              <span className="vs-file-ico">🎵</span>
              <div>
                <div className="vs-file-name">{displayResult.fileName}</div>
                <div className="vs-file-meta">
                  {currentFile ? formatSize(currentFile.size) + ' · ' : ''}Stems ready
                </div>
              </div>
              <span className="vs-file-remove" onClick={handleReset} title="Remove file">✕</span>
            </div>

            <UploadWaveCanvas />

            {/* Stem download cards */}
            <div className="vs-stems">
              <a
                className="vs-stem-card"
                href={displayResult.vocalsUrl}
                download="vocals.wav"
                target="_blank"
                rel="noreferrer"
                onClick={() => onToast('Downloading vocals…')}
              >
                <span className="vs-stem-icon">🎤</span>
                <div>
                  <div className="vs-stem-name">Vocals</div>
                  <div className="vs-stem-hint">Isolated voice track</div>
                </div>
                <span className="vs-stem-dl">↓</span>
              </a>
              <a
                className="vs-stem-card"
                href={displayResult.instrumentalUrl}
                download="instrumental.wav"
                target="_blank"
                rel="noreferrer"
                onClick={() => onToast('Downloading instrumental…')}
              >
                <span className="vs-stem-icon">🎸</span>
                <div>
                  <div className="vs-stem-name">Instrumental</div>
                  <div className="vs-stem-hint">Music without vocals</div>
                </div>
                <span className="vs-stem-dl">↓</span>
              </a>
            </div>

            <button className="vs-continue-btn" onClick={onContinue}>
              Continue to Voice Swap →
            </button>
          </div>
        )}

        {/* ── error ────────────────────────────────────────────── */}
        {phase === 'error' && (
          <div className="vs-error-zone">
            <div className="vs-error-msg">{errorMsg}</div>
            <button
              className="vs-error-retry"
              onClick={handleReset}
            >
              Try again
            </button>
          </div>
        )}

        <div className="vs-supported-row">
          {['MP3', 'WAV', 'M4A'].map((fmt) => (
            <span key={fmt} className="vs-fmt-chip">{fmt}</span>
          ))}
          <span className="vs-fmt-chip">MAX 50 MB</span>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .vs-panel {
          animation: vsFadeUp 0.35s ease forwards;
        }
        @keyframes vsFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .vs-panel-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 20px; font-weight: 700; color: #F0F0FF;
          letter-spacing: -0.5px; margin-bottom: 4px;
        }
        .vs-panel-sub { font-size: 13px; color: #5A5A80; margin-bottom: 28px; }

        /* ── drop zone ── */
        .vs-upload-zone {
          border: 1.5px dashed #2A2A4A; border-radius: 14px;
          padding: 48px 24px; text-align: center; cursor: pointer;
          transition: all 0.2s; background: rgba(139,92,246,.02);
        }
        .vs-upload-zone:hover,
        .vs-upload-zone--drag {
          border-color: rgba(139,92,246,.5);
          background: rgba(139,92,246,.05);
        }
        .vs-uz-icon { font-size: 32px; margin-bottom: 12px; }
        .vs-uz-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 16px; font-weight: 600; color: #F0F0FF; margin-bottom: 6px;
        }
        .vs-uz-sub { font-size: 13px; color: #5A5A80; margin-bottom: 8px; }
        .vs-uz-formats { font-size: 11px; color: #3A3A60; letter-spacing: 0.5px; }

        /* ── progress zone ── */
        .vs-progress-zone {
          border: 1px solid #1E1E3A; border-radius: 14px;
          padding: 40px 24px; text-align: center; background: rgba(139,92,246,.02);
          display: flex; flex-direction: column; align-items: center; gap: 10px;
        }
        .vs-prog-spinner {
          width: 36px; height: 36px; border-radius: 50%;
          border: 3px solid #1E1E3A;
          border-top-color: #8B5CF6;
          animation: vsSpin 0.8s linear infinite;
        }
        .vs-prog-spinner--purple { border-top-color: #EC4899; }
        @keyframes vsSpin { to { transform: rotate(360deg); } }
        .vs-prog-file { font-size: 13px; font-weight: 600; color: #F0F0FF; margin-top: 4px; }
        .vs-prog-label { font-size: 13px; color: #8B5CF6; }
        .vs-prog-sub { font-size: 11px; color: #5A5A80; }

        /* ── loaded zone ── */
        .vs-loaded-zone {
          border: 1px solid #2A2A4A; border-radius: 14px;
          padding: 18px; background: rgba(139,92,246,.03);
          display: flex; flex-direction: column; gap: 14px;
        }
        .vs-file-header { display: flex; align-items: center; gap: 12px; }
        .vs-file-ico { font-size: 22px; flex-shrink: 0; }
        .vs-file-name { font-size: 14px; font-weight: 600; color: #F0F0FF; margin-bottom: 2px; }
        .vs-file-meta { font-size: 11px; color: #5A5A80; }
        .vs-file-remove {
          margin-left: auto; font-size: 13px; color: #5A5A80; cursor: pointer;
          padding: 4px 8px; border-radius: 4px; transition: all 0.2s;
        }
        .vs-file-remove:hover { color: #F0F0FF; background: #1E1E3A; }

        /* ── stem cards ── */
        .vs-stems { display: flex; flex-direction: column; gap: 8px; }
        .vs-stem-card {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 14px; border-radius: 10px;
          background: #0E0E20; border: 1px solid #1E1E3A;
          text-decoration: none; cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
        }
        .vs-stem-card:hover { border-color: rgba(139,92,246,.4); background: rgba(139,92,246,.04); }
        .vs-stem-icon { font-size: 20px; flex-shrink: 0; }
        .vs-stem-name { font-size: 13px; font-weight: 600; color: #F0F0FF; margin-bottom: 1px; }
        .vs-stem-hint { font-size: 11px; color: #5A5A80; }
        .vs-stem-dl {
          margin-left: auto; font-size: 16px; color: #8B5CF6;
          width: 28px; height: 28px; border-radius: 6px;
          background: rgba(139,92,246,.1); display: flex;
          align-items: center; justify-content: center;
          flex-shrink: 0; transition: background 0.2s;
        }
        .vs-stem-card:hover .vs-stem-dl { background: rgba(139,92,246,.2); }

        /* ── continue button ── */
        .vs-continue-btn {
          width: 100%; padding: 12px; border-radius: 10px; border: none;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 14px; font-weight: 600; cursor: pointer;
          transition: all 0.25s; letter-spacing: 0.2px;
        }
        .vs-continue-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 10px 30px rgba(139,92,246,.4);
        }

        /* ── error zone ── */
        .vs-error-zone {
          border: 1px solid rgba(239,68,68,.25); border-radius: 14px;
          padding: 28px 24px; text-align: center;
          background: rgba(239,68,68,.04);
          display: flex; flex-direction: column; align-items: center; gap: 14px;
        }
        .vs-error-msg { font-size: 13px; color: #F87171; line-height: 1.5; }
        .vs-error-retry {
          padding: 8px 20px; border-radius: 8px; border: 1px solid rgba(239,68,68,.3);
          background: transparent; color: #F87171; font-size: 13px; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
        }
        .vs-error-retry:hover { background: rgba(239,68,68,.08); }

        /* ── format chips ── */
        .vs-supported-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 20px; }
        .vs-fmt-chip {
          padding: 4px 12px; border-radius: 99px;
          background: #121225; border: 1px solid #1E1E3A;
          font-size: 10px; font-weight: 700; letter-spacing: 1.5px; color: #5A5A80;
        }
      `}</style>
    </>
  )
}
