'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LogoFull } from '@/components/ui/Logo'
import { AudioPlayer } from '@/components/voice-swap/AudioPlayer'
import { VToast } from '@/components/voice-swap/VToast'
import { KaraokePanel } from '@/components/karaoke/KaraokePanel'

// Read-only view of one saved swap: the final polished mix persisted at save
// time. Deliberately NOT re-editable — stems and effect/fine-tune settings
// aren't stored, so playback + download + delete is everything the data
// honestly supports.

type SwapRow = {
  id: string
  song_name: string
  voice_used: string
  created_at: string
  result_path: string | null
}

type LoadState = 'loading' | 'ready' | 'expired' | 'notFound'

function fmtDuration(secs: number): string {
  const s = Math.round(secs)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function SavedSwapPage({ swapId }: { swapId: string }) {
  const router = useRouter()
  const [state, setState] = useState<LoadState>('loading')
  const [swap, setSwap] = useState<SwapRow | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [karaokeOpen, setKaraokeOpen] = useState(false)

  const [toast, setToast] = useState({ visible: false, message: '' })
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const showToast = useCallback((message: string) => {
    clearTimeout(toastTimerRef.current)
    setToast({ visible: true, message })
    toastTimerRef.current = setTimeout(() => setToast((p) => ({ ...p, visible: false })), 3200)
  }, [])
  useEffect(() => () => clearTimeout(toastTimerRef.current), [])

  // Same-origin proxy that signs the stored file fresh on every request —
  // the durable path never leaves the server (see /api/voice-swaps/[swapId]).
  const playerSrc = `/api/voice-swaps/${swapId}/result.mp3`

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id
      if (!uid) return // middleware guarantees a session; belt-and-braces
      supabase
        .from('voice_swaps')
        .select('id, song_name, voice_used, created_at, result_path')
        .eq('id', swapId)
        .eq('user_id', uid)
        .maybeSingle()
        .then(({ data: row, error }) => {
          if (error) { console.error('swap fetch failed', error); setState('notFound'); return }
          if (!row) { setState('notFound'); return }
          setSwap(row)
          setState(row.result_path ? 'ready' : 'expired')
        })
    })
  }, [swapId])

  // Duration for the details row, read from the file's metadata (not stored in
  // the DB). The ranged metadata fetch is cheap; the player makes its own request.
  useEffect(() => {
    if (state !== 'ready') return
    const probe = new Audio()
    probe.preload = 'metadata'
    probe.src = playerSrc
    const onMeta = () => { if (isFinite(probe.duration)) setDuration(probe.duration) }
    probe.addEventListener('loadedmetadata', onMeta)
    return () => {
      probe.removeEventListener('loadedmetadata', onMeta)
      probe.src = ''
    }
  }, [state, playerSrc])

  // The proxy 307s to cross-origin storage, where <a download> is ignored —
  // so download via fetch → blob → object URL.
  async function handleDownload() {
    if (!swap || downloading) return
    setDownloading(true)
    try {
      const res = await fetch(playerSrc)
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${swap.song_name} - ${swap.voice_used}.mp3`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[saved-swap] download failed:', err)
      showToast('Download failed — please try again')
    } finally {
      setDownloading(false)
    }
  }

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/voice-swaps/delete?id=${swapId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `Delete failed (${res.status})`)
      }
      router.push('/dashboard')
    } catch (err) {
      console.error('[saved-swap] delete failed:', err)
      showToast(err instanceof Error ? err.message : 'Delete failed')
      setDeleting(false)
    }
  }

  const created = swap ? new Date(swap.created_at) : null

  return (
    <>
      <div className="sw-shell">
        <header className="sw-head">
          <Link href="/" style={{ textDecoration: 'none' }}>
            <LogoFull size={30} />
          </Link>
          <Link href="/dashboard" className="sw-back">← Dashboard</Link>
        </header>

        <main className="sw-main">
          {state === 'loading' && (
            <div className="sw-center-note">Loading…</div>
          )}

          {state === 'notFound' && (
            <div className="sw-card sw-card--note">
              <div className="sw-note-ico">🔍</div>
              <div className="sw-note-title">Swap not found</div>
              <p className="sw-note-txt">
                This swap doesn&rsquo;t exist or was deleted.
              </p>
              <Link href="/dashboard" className="sw-btn-solid">Back to Dashboard</Link>
            </div>
          )}

          {state === 'expired' && swap && (
            <div className="sw-card sw-card--note">
              <div className="sw-note-ico">⏳</div>
              <div className="sw-note-title">This track has expired</div>
              <p className="sw-note-txt">
                Saved tracks are kept for 90 days. The audio for
                &ldquo;{swap.song_name}&rdquo; is no longer stored, so it can&rsquo;t
                be played or downloaded. You can re-create it with a new swap.
              </p>
              <Link href="/voice-swap" className="sw-btn-solid">New swap</Link>
            </div>
          )}

          {state === 'ready' && swap && (
            <div className="sw-card">
              <div className="sw-title-row">
                <span className="sw-title-ico">🎵</span>
                <div>
                  <h1 className="sw-title">{swap.song_name}</h1>
                  <div className="sw-subtitle">Saved swap — final mix</div>
                </div>
              </div>

              <div className="sw-details">
                <div className="sw-detail">
                  <span className="sw-detail-lbl">Voice</span>
                  <span className="sw-detail-val">{swap.voice_used}</span>
                </div>
                <div className="sw-detail">
                  <span className="sw-detail-lbl">Created</span>
                  <span className="sw-detail-val">
                    {created?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
                <div className="sw-detail">
                  <span className="sw-detail-lbl">Duration</span>
                  <span className="sw-detail-val">{duration === null ? '—' : fmtDuration(duration)}</span>
                </div>
              </div>

              <AudioPlayer src={playerSrc} label={swap.voice_used} />

              <div className="sw-actions">
                <button className="sw-btn-solid" onClick={handleDownload} disabled={downloading}>
                  {downloading ? 'Preparing…' : '⬇ Download MP3'}
                </button>
                {!karaokeOpen && (
                  <button className="sw-btn-ghost" onClick={() => setKaraokeOpen(true)}>
                    🎤 Sing along
                  </button>
                )}
                <button className="sw-btn-danger" onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>

              {karaokeOpen && (
                <KaraokePanel
                  backingUrls={[playerSrc]}
                  trackName={swap.song_name}
                  backingLabel="your saved track — a duet with your cloned voice"
                  onToast={showToast}
                />
              )}

              <p className="sw-note-fine">
                This is the finished track exactly as it was saved (effects included).
                Want a different take? <Link href="/voice-swap" style={{ color: '#8B5CF6' }}>Run a new swap</Link>.
              </p>
            </div>
          )}
        </main>
      </div>

      <VToast visible={toast.visible} message={toast.message} />

      <style suppressHydrationWarning>{`
        body { background: #05050F; }
        .sw-shell {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: #05050F;
        }
        .sw-head {
          padding: 18px 40px;
          border-bottom: 1px solid #1E1E3A;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .sw-back {
          font-size: 13px; font-weight: 600; color: #7878A0;
          text-decoration: none; transition: color 0.2s;
        }
        .sw-back:hover { color: #F0F0FF; }
        .sw-main {
          flex: 1;
          width: 100%;
          max-width: 620px;
          margin: 0 auto;
          padding: 48px 24px 72px;
        }
        .sw-center-note {
          text-align: center; padding: 80px 0;
          font-size: 13px; color: #5A5A80;
        }
        .sw-card {
          background: #09091A;
          border: 1px solid #1E1E3A;
          border-radius: 16px;
          padding: 24px;
        }
        .sw-card--note { text-align: center; padding: 48px 32px; }
        .sw-note-ico { font-size: 34px; margin-bottom: 14px; }
        .sw-note-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 18px; font-weight: 700; color: #F0F0FF; margin-bottom: 8px;
        }
        .sw-note-txt {
          font-size: 13px; color: #7878A0; line-height: 1.7;
          max-width: 400px; margin: 0 auto 22px;
        }
        .sw-title-row {
          display: flex; align-items: center; gap: 14px; margin-bottom: 20px;
        }
        .sw-title-ico { font-size: 28px; }
        .sw-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 20px; font-weight: 700; letter-spacing: -0.4px;
          color: #F0F0FF; margin: 0 0 2px; word-break: break-word;
        }
        .sw-subtitle { font-size: 11px; color: #5A5A80; }
        .sw-details {
          display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 18px;
        }
        .sw-detail {
          flex: 1; min-width: 120px;
          background: #0E0E20; border: 1px solid #1E1E3A;
          border-radius: 10px; padding: 10px 14px;
        }
        .sw-detail-lbl {
          display: block; font-size: 10px; font-weight: 700;
          letter-spacing: 1.5px; text-transform: uppercase;
          color: #5A5A80; margin-bottom: 3px;
        }
        .sw-detail-val { font-size: 13px; font-weight: 600; color: #F0F0FF; }
        .sw-actions {
          display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap;
        }
        .sw-btn-solid {
          display: inline-block;
          padding: 11px 22px; border-radius: 9px; border: none;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          color: #fff; text-decoration: none;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.25s;
        }
        .sw-btn-solid:hover:not(:disabled) {
          box-shadow: 0 8px 24px rgba(139,92,246,.4);
          transform: translateY(-1px);
        }
        .sw-btn-solid:disabled { opacity: 0.5; cursor: not-allowed; }
        .sw-btn-ghost {
          padding: 11px 22px; border-radius: 9px;
          border: 1px solid #2A2A4A; background: transparent; color: #C4C4E0;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.2s;
        }
        .sw-btn-ghost:hover { border-color: #8B5CF6; color: #8B5CF6; }
        .sw-btn-danger {
          padding: 11px 22px; border-radius: 9px;
          border: 1px solid rgba(239,68,68,.3); background: transparent;
          color: #F87171;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.2s;
        }
        .sw-btn-danger:hover:not(:disabled) { background: rgba(239,68,68,.08); border-color: rgba(239,68,68,.5); }
        .sw-btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }
        .sw-note-fine {
          font-size: 12px; color: #5A5A80; line-height: 1.6;
          margin: 16px 0 0;
        }
        @media (max-width: 640px) {
          .sw-head { padding: 14px 20px; }
          .sw-main { padding-top: 28px; }
        }
      `}</style>
    </>
  )
}
