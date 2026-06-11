'use client'

import { useState, useRef, useEffect } from 'react'

interface UploadStepProps {
  uploaded: boolean
  onUpload: () => void
}

function UploadWaveCanvas({ drawn }: { drawn: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!drawn) return
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
        const h = (Math.sin(i * 0.3) * 0.3 + Math.sin(i * 0.7) * 0.2 + 0.5) * H * 0.75 + H * 0.08
        ctx.fillRect(i * step, (H - h) / 2, 2, h)
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [drawn])

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

export function UploadStep({ uploaded, onUpload }: UploadStepProps) {
  const [dragging, setDragging] = useState(false)

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    onUpload()
  }

  return (
    <>
      <div className="vs-panel">
        <div className="vs-panel-title">Upload Your Track</div>
        <div className="vs-panel-sub">MP3, WAV, FLAC, OGG — up to 50 MB</div>

        {!uploaded ? (
          <div
            className={`vs-upload-zone ${dragging ? 'vs-upload-zone--drag' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={onUpload}
          >
            <div className="vs-uz-icon">🎵</div>
            <div className="vs-uz-title">Drop your track here</div>
            <div className="vs-uz-sub">or click to browse files</div>
            <div className="vs-uz-hint">
              <span>or paste URL</span>
              <input
                className="vs-url-input"
                placeholder="https://..."
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === 'Enter') { onUpload(); (e.target as HTMLInputElement).blur() } }}
              />
            </div>
          </div>
        ) : (
          <div className="vs-loaded-zone">
            <div className="vs-file-header">
              <span className="vs-file-ico">🎵</span>
              <div>
                <div className="vs-file-name">Kesariya_Original.mp3</div>
                <div className="vs-file-meta">4:32 · Stereo 44.1 kHz · 7.8 MB</div>
              </div>
              <span
                className="vs-file-remove"
                onClick={onUpload}
                title="Remove file"
              >
                ✕
              </span>
            </div>
            <UploadWaveCanvas drawn={uploaded} />
          </div>
        )}

        <div className="vs-supported-row">
          {['MP3', 'WAV', 'FLAC', 'OGG', 'M4A', 'AIFF'].map((fmt) => (
            <span key={fmt} className="vs-fmt-chip">{fmt}</span>
          ))}
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
          font-size: 20px;
          font-weight: 700;
          color: #F0F0FF;
          letter-spacing: -0.5px;
          margin-bottom: 4px;
        }
        .vs-panel-sub {
          font-size: 13px;
          color: #5A5A80;
          margin-bottom: 28px;
        }
        .vs-upload-zone {
          border: 1.5px dashed #2A2A4A;
          border-radius: 14px;
          padding: 48px 24px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          background: rgba(139,92,246,.02);
        }
        .vs-upload-zone:hover,
        .vs-upload-zone--drag {
          border-color: rgba(139,92,246,.5);
          background: rgba(139,92,246,.05);
        }
        .vs-uz-icon { font-size: 32px; margin-bottom: 12px; }
        .vs-uz-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 16px;
          font-weight: 600;
          color: #F0F0FF;
          margin-bottom: 6px;
        }
        .vs-uz-sub { font-size: 13px; color: #5A5A80; margin-bottom: 20px; }
        .vs-uz-hint {
          display: flex;
          align-items: center;
          gap: 10px;
          justify-content: center;
          font-size: 12px;
          color: #5A5A80;
        }
        .vs-url-input {
          background: #0E0E20;
          border: 1px solid #2A2A4A;
          border-radius: 6px;
          padding: 6px 12px;
          font-size: 12px;
          color: #C4C4E0;
          width: 200px;
          outline: none;
          transition: border-color 0.2s;
        }
        .vs-url-input:focus { border-color: rgba(139,92,246,.5); }
        .vs-loaded-zone {
          border: 1px solid #2A2A4A;
          border-radius: 14px;
          padding: 18px;
          background: rgba(139,92,246,.03);
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .vs-file-header {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .vs-file-ico { font-size: 22px; flex-shrink: 0; }
        .vs-file-name {
          font-size: 14px;
          font-weight: 600;
          color: #F0F0FF;
          margin-bottom: 2px;
        }
        .vs-file-meta { font-size: 11px; color: #5A5A80; }
        .vs-file-remove {
          margin-left: auto;
          font-size: 13px;
          color: #5A5A80;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          transition: all 0.2s;
        }
        .vs-file-remove:hover { color: #F0F0FF; background: #1E1E3A; }
        .vs-supported-row {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 20px;
        }
        .vs-fmt-chip {
          padding: 4px 12px;
          border-radius: 99px;
          background: #121225;
          border: 1px solid #1E1E3A;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.5px;
          color: #5A5A80;
        }
      `}</style>
    </>
  )
}
