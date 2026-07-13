'use client'

import { useEffect, useRef, useState } from 'react'

// "Share as Video" — asks /api/share-video for a branded vertical MP4 of the
// track (rendered on demand, free, ~25s teaser clip), then shows a preview
// with Download and — on devices that support sharing files (phones) — a
// system Share sheet for sending straight to Reels/WhatsApp/Shorts.
// Used next to ShareControl on the swap Result screen and the saved-track
// page. Render failures surface as a toast; nothing else is affected.
interface ShareVideoButtonProps {
  swapId: string | null // null = the track isn't saved yet (persist in flight)
  songName: string
  onToast?: (message: string) => void
}

export function ShareVideoButton({ swapId, songName, onToast }: ShareVideoButtonProps) {
  const [busy, setBusy] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const videoBlobRef = useRef<Blob | null>(null)
  const [canShareFiles, setCanShareFiles] = useState(false)

  const fileName = `${(songName || 'track').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'track'} - MausamVox.mp4`

  // Detect file-sharing support once the video exists (needs a real File).
  useEffect(() => {
    if (!videoBlobRef.current) { setCanShareFiles(false); return }
    try {
      const file = new File([videoBlobRef.current], fileName, { type: 'video/mp4' })
      setCanShareFiles(typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }))
    } catch {
      setCanShareFiles(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl])

  // Revoke the blob URL when replaced/unmounted.
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])

  async function handleCreate() {
    if (!swapId || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/share-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swapId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Video render failed (${res.status})`)
      }
      const blob = await res.blob()
      videoBlobRef.current = blob
      setVideoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
    } catch (err) {
      console.error('[share-video] failed:', err)
      onToast?.(err instanceof Error ? err.message : 'Video render failed — please try again')
    } finally {
      setBusy(false)
    }
  }

  function handleDownload() {
    if (!videoUrl) return
    const a = document.createElement('a')
    a.href = videoUrl
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function handleSystemShare() {
    const blob = videoBlobRef.current
    if (!blob) return
    try {
      const file = new File([blob], fileName, { type: 'video/mp4' })
      await navigator.share({ files: [file], title: songName })
    } catch (err) {
      // AbortError = user closed the sheet — not a failure worth toasting.
      if (err instanceof Error && err.name !== 'AbortError') {
        onToast?.('Sharing failed — use Download instead')
      }
    }
  }

  function handleClose() {
    setVideoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    videoBlobRef.current = null
  }

  return (
    <>
      <button
        className="svb-btn"
        onClick={handleCreate}
        disabled={!swapId || busy}
        title={swapId
          ? 'Render a vertical video of this track for Reels / Shorts / WhatsApp — free'
          : 'Saving your track… video unlocks once it’s saved'}
      >
        {busy ? '⏳ Rendering video…' : '🎬 Share as Video'}
      </button>

      {videoUrl && (
        <div className="svb-overlay" onClick={handleClose}>
          <div className="svb-modal" onClick={(e) => e.stopPropagation()}>
            <div className="svb-head">
              <span className="svb-title">Your video is ready</span>
              <button className="svb-close" onClick={handleClose}>✕</button>
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- music video preview */}
            <video className="svb-video" src={videoUrl} controls playsInline />
            <div className="svb-actions">
              <button className="svb-btn svb-btn--solid" onClick={handleDownload}>⬇ Download MP4</button>
              {canShareFiles && (
                <button className="svb-btn" onClick={handleSystemShare}>📤 Share…</button>
              )}
            </div>
            <p className="svb-fine">
              A ~25-second vertical teaser of your track — ready for Instagram Reels,
              YouTube Shorts, WhatsApp status and TikTok.
            </p>
          </div>
        </div>
      )}

      <style suppressHydrationWarning>{`
        .svb-btn {
          padding: 11px 18px; border-radius: 9px;
          border: 1px solid #3C3C6A; background: transparent; color: #C4C4E0;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.2s; white-space: nowrap;
        }
        .svb-btn:hover:not(:disabled) { border-color: #9D5CFF; color: #9D5CFF; }
        .svb-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .svb-btn--solid {
          background: linear-gradient(135deg,#9D5CFF,#F9459E,#0CC7E8);
          border: none; color: #fff;
        }
        .svb-btn--solid:hover:not(:disabled) { box-shadow: 0 8px 24px rgba(157,92,255,.4); color: #fff; }
        .svb-overlay {
          position: fixed; inset: 0; z-index: 1000;
          background: rgba(5,5,15,.8); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center; padding: 20px;
        }
        .svb-modal {
          background: #121225; border: 1px solid #3C3C6A; border-radius: 16px;
          padding: 16px; width: 100%; max-width: 340px;
          display: flex; flex-direction: column; gap: 12px;
          max-height: 92vh; overflow-y: auto;
        }
        .svb-head { display: flex; align-items: center; justify-content: space-between; }
        .svb-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 15px; font-weight: 700; color: #F0F0FF;
        }
        .svb-close {
          border: none; background: transparent; color: #8E8EB4;
          font-size: 15px; cursor: pointer; padding: 4px 8px;
        }
        .svb-close:hover { color: #F0F0FF; }
        .svb-video {
          width: 100%; aspect-ratio: 9 / 16; border-radius: 10px;
          background: #05050F; display: block;
        }
        .svb-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        .svb-fine { margin: 0; font-size: 11px; color: #8E8EB4; line-height: 1.5; }
      `}</style>
    </>
  )
}
