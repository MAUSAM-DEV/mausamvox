'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ADMIN_EMAILS } from '@/lib/admin'
import { VSidebar } from '@/components/voice-swap/VSidebar'
import { AudioPlayer } from '@/components/voice-swap/AudioPlayer'
import { VToast } from '@/components/voice-swap/VToast'
import { KaraokePanel } from '@/components/karaoke/KaraokePanel'
import { PerformanceMode } from '@/components/karaoke/PerformanceMode'

const STEM_SPLIT_COST = 50 // same price the Voice Swap flow charges for this exact operation

const ACCEPTED_EXTS = ['mp3', 'wav', 'm4a']
const MAX_BYTES = 75 * 1024 * 1024 // 75 MB — same cap as the Voice Swap upload

type Phase = 'idle' | 'uploading' | 'splitting' | 'done' | 'error'

// One entry per Demucs stem. url is a fresh signed URL from /api/stem-split
// (durable audio-uploads copy, or the ~1h Replicate URL if persistence
// soft-failed server-side).
type Stems = { vocals: string; bass: string; drums: string; other: string }

const STEM_ROWS: Array<{ key: keyof Stems; label: string; emoji: string }> = [
  { key: 'vocals', label: 'Vocals', emoji: '🎤' },
  { key: 'bass',   label: 'Bass',   emoji: '🎸' },
  { key: 'drums',  label: 'Drums',  emoji: '🥁' },
  { key: 'other',  label: 'Other',  emoji: '🎹' },
]

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'm4a') return 'audio/mp4'
  return 'audio/mpeg'
}

function validateFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ACCEPTED_EXTS.includes(ext)) {
    return `Only MP3, WAV, and M4A files are supported (got .${ext || 'unknown'}).`
  }
  if (file.size > MAX_BYTES) {
    return `File must be 75 MB or smaller (yours is ${(file.size / 1024 / 1024).toFixed(1)} MB).`
  }
  return null
}

export function StemStudioPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [plan, setPlan] = useState<string | null>(null)
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null)
  const [creditsTotal, setCreditsTotal] = useState<number | null>(null)

  const [phase, setPhase] = useState<Phase>('idle')
  const [fileName, setFileName] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [stems, setStems] = useState<Stems | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [karaokeOpen, setKaraokeOpen] = useState(false)
  const [performOpen, setPerformOpen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [toast, setToast] = useState({ visible: false, message: '' })
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>()

  const showToast = useCallback((message: string, ms = 3200) => {
    clearTimeout(toastTimerRef.current)
    setToast({ visible: true, message })
    toastTimerRef.current = setTimeout(() => setToast((p) => ({ ...p, visible: false })), ms)
  }, [])
  useEffect(() => () => clearTimeout(toastTimerRef.current), [])

  // User + plan/credits (same data the sidebar shows on the other pages)
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user
      if (!u) return
      setUserId(u.id)
      setIsAdmin(ADMIN_EMAILS.includes(u.email ?? ''))
      supabase
        .from('users')
        .select('plan, credits_remaining, credits_total')
        .eq('id', u.id)
        .single()
        .then(({ data: row, error }) => {
          if (row) { setPlan(row.plan); setCreditsRemaining(row.credits_remaining); setCreditsTotal(row.credits_total) }
          else if (error) console.error('credits fetch failed', error)
        })
    })
  }, [])

  // Elapsed-seconds ticker while Demucs runs, so the wait never looks frozen.
  useEffect(() => {
    if (phase !== 'splitting') return
    setElapsed(0)
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  // Same client-charge pattern as the Voice Swap flow: deduct after the split
  // succeeds (a failed job costs nothing). The route derives the target from
  // the session; userId is sent for the mismatch check.
  async function chargeSplit() {
    if (isAdmin || !userId) return
    try {
      const res = await fetch('/api/credits/deduct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount: STEM_SPLIT_COST, action: 'stem_split' }),
      })
      const data = await res.json()
      if (res.ok && typeof data.creditsRemaining === 'number') {
        setCreditsRemaining(data.creditsRemaining)
      }
    } catch { /* non-critical — don't block the result view */ }
  }

  async function processFile(file: File) {
    const validationError = validateFile(file)
    if (validationError) {
      setErrorMsg(validationError)
      setPhase('error')
      return
    }
    if (!isAdmin && creditsRemaining !== null && creditsRemaining < STEM_SPLIT_COST) {
      showToast(`Not enough credits — a stem split costs ${STEM_SPLIT_COST}.`)
      return
    }

    setFileName(file.name)
    setErrorMsg('')
    setStems(null)
    setPhase('uploading')

    try {
      const mime = file.type || guessMime(file.name)

      // 1 — presigned upload URL (no file bytes through Vercel)
      const presignRes = await fetch('/api/upload-stem/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: mime }),
      })
      if (!presignRes.ok) {
        let msg = `Failed to get upload URL (${presignRes.status})`
        try { const e = await presignRes.json(); msg = e.error ?? msg } catch { /* HTML body */ }
        throw new Error(msg)
      }
      const presign = await presignRes.json()

      // 2 — PUT directly to Supabase Storage
      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': mime, 'x-upsert': 'false' },
      })
      if (!putRes.ok) throw new Error(`Storage upload failed (${putRes.status})`)

      setPhase('splitting')

      // 3 — start Demucs (returns immediately with a prediction ID)
      const startRes = await fetch('/api/stem-split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: presign.path }),
      })
      if (!startRes.ok) {
        let msg = `Stem split failed to start (${startRes.status})`
        try { const e = await startRes.json(); msg = e.error ?? msg } catch { /* HTML body */ }
        throw new Error(msg)
      }
      const startData = await startRes.json()
      const predictionId = startData.predictionId as string | undefined
      if (!predictionId) throw new Error('Stem split failed: no prediction ID returned')

      // 4 — poll until Demucs finishes (same cadence/ceiling as the swap flow)
      const POLL_INTERVAL_MS = 3000
      const MAX_ATTEMPTS = 150 // ~7.5 minutes
      let result: Stems | null = null
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        const pollRes = await fetch(`/api/stem-split?id=${predictionId}`)
        if (!pollRes.ok) {
          let msg = `Stem split poll failed (${pollRes.status})`
          try { const e = await pollRes.json(); msg = e.error ?? msg } catch { /* ignore */ }
          throw new Error(msg)
        }
        const poll = await pollRes.json()
        if (poll.status === 'succeeded') {
          result = { vocals: poll.vocals, bass: poll.bass, drums: poll.drums, other: poll.other }
          break
        }
        if (poll.status === 'failed' || poll.status === 'canceled') {
          throw new Error(poll.error ?? 'Stem split failed')
        }
        // starting / processing — keep polling
      }
      if (!result) throw new Error('Stem split timed out — please try again')

      setStems(result)
      setPhase('done')
      showToast('Stems ready!')
      void chargeSplit()
    } catch (err) {
      console.error('[stem-studio] split failed:', err)
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong')
      setPhase('error')
    }
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (f) void processFile(f)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f) void processFile(f)
  }

  function reset() {
    setPhase('idle')
    setStems(null)
    setFileName('')
    setErrorMsg('')
    setKaraokeOpen(false)
  }

  const baseName = fileName.replace(/\.[^.]+$/, '')
  const busy = phase === 'uploading' || phase === 'splitting'

  return (
    <>
      <div className="ss-shell">
        <VSidebar
          creditsRemaining={creditsRemaining}
          creditsTotal={creditsTotal}
          plan={plan}
          activeTool="Stem Studio"
        />

        <div className="ss-centre">
          <header className="ss-head">
            <div>
              <h1 className="ss-h1">Stem Studio</h1>
              <p className="ss-sub">Split any track into vocals, bass, drums and other — powered by the StemSplit Engine.</p>
            </div>
            <span className="ss-cost-chip">✂️ {STEM_SPLIT_COST} credits per split</span>
          </header>

          <div className="ss-workspace">
            {(phase === 'idle' || phase === 'error') && (
              <>
                {phase === 'error' && (
                  <div className="ss-error">
                    ⚠️ {errorMsg}
                  </div>
                )}
                <div
                  className={`ss-dropzone${dragOver ? ' ss-dropzone--over' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <div className="ss-dz-ico">✂️</div>
                  <div className="ss-dz-title">Drop your track here</div>
                  <div className="ss-dz-hint">or click to browse</div>
                  <div className="ss-dz-formats">MP3 · WAV · M4A · max 75 MB</div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/mp4"
                  style={{ display: 'none' }}
                  onChange={handlePick}
                />
                <p className="ss-note">
                  You&rsquo;ll get 4 separated stems — vocals, bass, drums and other —
                  each playable here and downloadable as MP3.
                  {!isAdmin && ` ${STEM_SPLIT_COST} credits are charged only when the split succeeds.`}
                </p>
              </>
            )}

            {busy && (
              <div className="ss-progress">
                <div className="ss-spinner" />
                <div className="ss-prog-title">
                  {phase === 'uploading' ? 'Uploading your track…' : 'Separating stems…'}
                </div>
                <div className="ss-prog-sub">
                  {phase === 'uploading'
                    ? fileName
                    : `StemSplit Engine is working on “${fileName}” — usually 1–3 minutes${elapsed >= 5 ? ` · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}` : ''}`}
                </div>
              </div>
            )}

            {phase === 'done' && stems && (
              <div className="ss-result">
                <div className="ss-result-head">
                  <div>
                    <div className="ss-result-title">✅ Stems ready</div>
                    <div className="ss-result-file">{fileName}</div>
                  </div>
                  <button className="ss-btn-ghost" onClick={reset}>Split another track</button>
                </div>

                <div className="ss-stem-grid">
                  {STEM_ROWS.map((row) => (
                    <div key={row.key} className="ss-stem-card">
                      <div className="ss-stem-top">
                        <span className="ss-stem-name">{row.emoji} {row.label}</span>
                        <a
                          className="ss-dl-btn"
                          href={`/api/stems/download?url=${encodeURIComponent(stems[row.key])}&filename=${encodeURIComponent(`${baseName} - ${row.label}.mp3`)}`}
                        >
                          ⬇ Download
                        </a>
                      </div>
                      <AudioPlayer src={stems[row.key]} />
                    </div>
                  ))}
                </div>

                {!karaokeOpen ? (
                  <div className="ss-karaoke-cta">
                    <button className="ss-btn-ghost" onClick={() => setKaraokeOpen(true)}>
                      🎤 Sing over it
                    </button>
                    <button className="ss-btn-ghost" onClick={() => setPerformOpen(true)}>
                      🔊 Perform live
                    </button>
                    <span className="ss-karaoke-hint">Karaoke over the instrumental — no vocals</span>
                  </div>
                ) : (
                  <KaraokePanel
                    backingUrls={[stems.bass, stems.drums, stems.other].filter(Boolean)}
                    trackName={baseName}
                    backingLabel="the instrumental (no vocals)"
                    onToast={showToast}
                  />
                )}

                <p className="ss-note">
                  Download links stay fresh while this page is open. Want the vocals swapped
                  to an AI voice? Head to <a href="/voice-swap" style={{ color: '#8B5CF6' }}>Voice Swap</a>.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <VToast visible={toast.visible} message={toast.message} />

      {performOpen && stems && (
        <PerformanceMode
          trackName={baseName}
          sourceNote="Instrumental backing — no vocals"
          stemUrls={[stems.bass, stems.drums, stems.other].filter(Boolean)}
          onClose={() => setPerformOpen(false)}
        />
      )}

      <style suppressHydrationWarning>{`
        body { background: #05050F; }
        .ss-shell {
          display: grid;
          grid-template-columns: 216px 1fr;
          height: 100vh;
          overflow: hidden;
          background: #05050F;
        }
        .ss-centre {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          min-width: 0;
        }
        .ss-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 18px 28px;
          border-bottom: 1px solid #1E1E3A;
          flex-shrink: 0;
        }
        .ss-h1 {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 20px; font-weight: 700; letter-spacing: -0.4px;
          color: #F0F0FF; margin: 0 0 3px;
        }
        .ss-sub { font-size: 12px; color: #5A5A80; margin: 0; }
        .ss-cost-chip {
          flex-shrink: 0;
          font-size: 11px; font-weight: 600; color: #C4C4E0;
          background: #121225; border: 1px solid #1E1E3A;
          padding: 7px 14px; border-radius: 99px;
          white-space: nowrap;
        }
        .ss-workspace {
          flex: 1;
          overflow-y: auto;
          padding: 28px;
          max-width: 860px;
          width: 100%;
          margin: 0 auto;
          scrollbar-width: thin;
          scrollbar-color: #2A2A4A transparent;
        }
        .ss-workspace::-webkit-scrollbar { width: 4px; }
        .ss-workspace::-webkit-scrollbar-thumb { background: #2A2A4A; border-radius: 2px; }

        /* dropzone */
        .ss-dropzone {
          border: 2px dashed #2A2A4A;
          border-radius: 16px;
          background: #09091A;
          padding: 56px 24px;
          text-align: center;
          cursor: pointer;
          transition: all 0.25s;
        }
        .ss-dropzone:hover, .ss-dropzone--over {
          border-color: rgba(139,92,246,.55);
          background: rgba(139,92,246,.04);
        }
        .ss-dz-ico { font-size: 34px; margin-bottom: 14px; }
        .ss-dz-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 17px; font-weight: 700; color: #F0F0FF; margin-bottom: 4px;
        }
        .ss-dz-hint { font-size: 13px; color: #7878A0; margin-bottom: 14px; }
        .ss-dz-formats { font-size: 11px; color: #5A5A80; }
        .ss-note { font-size: 12px; color: #5A5A80; margin: 16px 2px 0; line-height: 1.6; }
        .ss-error {
          font-size: 13px; color: #F87171;
          background: rgba(239,68,68,.07); border: 1px solid rgba(239,68,68,.2);
          border-radius: 10px; padding: 12px 16px; margin-bottom: 14px;
        }

        /* progress */
        .ss-progress { text-align: center; padding: 72px 20px; }
        .ss-spinner {
          width: 44px; height: 44px; margin: 0 auto 20px;
          border-radius: 50%;
          border: 3px solid #1E1E3A;
          border-top-color: #8B5CF6;
          animation: ssSpin 0.9s linear infinite;
        }
        @keyframes ssSpin { to { transform: rotate(360deg); } }
        .ss-prog-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 16px; font-weight: 700; color: #F0F0FF; margin-bottom: 6px;
        }
        .ss-prog-sub { font-size: 12px; color: #5A5A80; }

        /* result */
        .ss-result-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 12px; margin-bottom: 18px;
        }
        .ss-result-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 16px; font-weight: 700; color: #F0F0FF; margin-bottom: 2px;
        }
        .ss-result-file { font-size: 12px; color: #5A5A80; word-break: break-all; }
        .ss-btn-ghost {
          flex-shrink: 0;
          padding: 8px 16px; border-radius: 8px;
          border: 1px solid #2A2A4A; background: transparent;
          color: #C4C4E0;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 12px; font-weight: 600; cursor: pointer;
          transition: all 0.2s; white-space: nowrap;
        }
        .ss-btn-ghost:hover { border-color: #8B5CF6; color: #8B5CF6; }
        .ss-stem-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .ss-stem-card {
          background: #09091A;
          border: 1px solid #1E1E3A;
          border-radius: 14px;
          padding: 12px;
        }
        .ss-stem-top {
          display: flex; align-items: center; justify-content: space-between;
          gap: 8px; margin-bottom: 10px;
        }
        .ss-stem-name { font-size: 13px; font-weight: 700; color: #F0F0FF; }
        .ss-dl-btn {
          font-size: 11px; font-weight: 600; color: #8B5CF6;
          text-decoration: none;
          padding: 5px 11px; border-radius: 7px;
          border: 1px solid rgba(139,92,246,.25);
          transition: all 0.18s; white-space: nowrap;
        }
        .ss-dl-btn:hover { background: rgba(139,92,246,.1); border-color: rgba(139,92,246,.5); }
        .ss-karaoke-cta {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
          margin-top: 16px;
        }
        .ss-karaoke-hint { font-size: 11px; color: #5A5A80; }

        @media (max-width: 900px) {
          .ss-shell {
            display: flex !important;
            flex-direction: column !important;
            height: auto !important;
            min-height: 100vh;
            overflow: visible !important;
          }
          .ss-centre { height: auto !important; overflow: visible !important; }
          .ss-workspace { overflow: visible !important; padding: 16px !important; }
          .ss-head { padding: 14px 16px; flex-wrap: wrap; }
          .ss-stem-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  )
}
