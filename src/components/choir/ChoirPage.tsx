'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ADMIN_EMAILS } from '@/lib/admin'
import { VSidebar } from '@/components/voice-swap/VSidebar'
import { AudioPlayer } from '@/components/voice-swap/AudioPlayer'
import { VToast } from '@/components/voice-swap/VToast'
import { ShareControl } from '@/components/share/ShareControl'
import { CHOIR_CREDITS, CHOIR_MODE_LABELS, type ChoirMode, type ChoirVoices } from '@/lib/choir-presets'
import { MicCheckWizard, RecordingQualityMonitor } from '@/components/recording/MicCheckWizard'
import type { MicMeter } from '@/components/recording/micMeter'

// Choir Composer — DSP vocal harmonizer. HONEST FRAMING everywhere: the
// output is the user's own voice pitch-shifted into stacked harmony layers,
// NOT distinct AI singers / SATB (that's parked — no viable model).

type Phase = 'idle' | 'uploading' | 'generating' | 'done' | 'error'
type VocalSource = { blob: Blob; filename: string; label: string; previewUrl: string }

const ACCEPTED_EXTS = ['mp3', 'wav', 'm4a', 'webm']
const MAX_BYTES = 25 * 1024 * 1024 // matches the route's input cap
const MAX_RECORD_SECONDS = 120

const VOICE_OPTIONS: ChoirVoices[] = [2, 4, 8]
const MODE_OPTIONS: ChoirMode[] = ['major', 'octaves']

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'm4a') return 'audio/mp4'
  if (ext === 'webm') return 'audio/webm'
  return 'audio/mpeg'
}

export function ChoirPage() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [plan, setPlan] = useState<string | null>(null)
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null)
  const [creditsTotal, setCreditsTotal] = useState<number | null>(null)

  const [vocal, setVocal] = useState<VocalSource | null>(null)
  const [voices, setVoices] = useState<ChoirVoices>(4)
  const [mode, setMode] = useState<ChoirMode>('major')
  const [title, setTitle] = useState('')

  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [result, setResult] = useState<{ swapId: string; url: string; title: string } | null>(null)
  const [downloading, setDownloading] = useState(false)

  // ── Recorder state ─────────────────────────────────────────────────────────
  const [recording, setRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recChunksRef = useRef<Blob[]>([])
  const recStreamRef = useRef<MediaStream | null>(null)
  // Level/clip/spike meter handed over by the MicCheckWizard for the take.
  const recMeterRef = useRef<MicMeter | null>(null)

  const [toast, setToast] = useState({ visible: false, message: '' })
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const showToast = useCallback((message: string, ms = 4200) => {
    clearTimeout(toastTimerRef.current)
    setToast({ visible: true, message })
    toastTimerRef.current = setTimeout(() => setToast((p) => ({ ...p, visible: false })), ms)
  }, [])
  useEffect(() => () => clearTimeout(toastTimerRef.current), [])

  const refetchCredits = useCallback(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user
      if (!u) return
      setIsAdmin(ADMIN_EMAILS.includes(u.email ?? ''))
      supabase
        .from('users')
        .select('plan, credits_remaining, credits_total')
        .eq('id', u.id)
        .maybeSingle()
        .then(({ data: row, error }) => {
          if (row) { setPlan(row.plan); setCreditsRemaining(row.credits_remaining); setCreditsTotal(row.credits_total) }
          else if (error) console.error('credits fetch failed', error)
        })
    })
  }, [])
  useEffect(() => { refetchCredits() }, [refetchCredits])

  // Elapsed ticker while working.
  useEffect(() => {
    if (phase !== 'uploading' && phase !== 'generating') return
    setElapsed(0)
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  // Recording ticker + hard cap.
  useEffect(() => {
    if (!recording) return
    setRecSeconds(0)
    const t = setInterval(() => setRecSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [recording])
  useEffect(() => {
    if (recording && recSeconds >= MAX_RECORD_SECONDS) stopRecording()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recSeconds, recording])

  // Revoke stale preview object URLs.
  useEffect(() => () => { if (vocal) URL.revokeObjectURL(vocal.previewUrl) }, [vocal])

  function setVocalSource(blob: Blob, filename: string, label: string) {
    setVocal((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl)
      return { blob, filename, label, previewUrl: URL.createObjectURL(blob) }
    })
    setResult(null)
    setPhase('idle')
    setErrorMsg('')
  }

  function handleFile(file: File | undefined) {
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ACCEPTED_EXTS.includes(ext)) {
      showToast(`Only MP3, WAV, M4A or WEBM files (got .${ext || 'unknown'}).`)
      return
    }
    if (file.size > MAX_BYTES) {
      showToast(`File must be 25 MB or smaller (yours is ${(file.size / 1024 / 1024).toFixed(1)} MB).`)
      return
    }
    setVocalSource(file, file.name, file.name)
  }

  // Stream + meter come from the MicCheckWizard (permission → quiet-room check
  // → countdown), opened with the SAME raw constraints as before — no
  // echo-cancel/AGC coloring (Voice Lab's mic settings). Capture is unchanged.
  function startRecording(stream: MediaStream, meter: MicMeter) {
    try {
      recStreamRef.current = stream
      recMeterRef.current = meter
      recChunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => { if (e.data.size > 0) recChunksRef.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(recChunksRef.current, { type: rec.mimeType || 'audio/webm' })
        const ext = (rec.mimeType || '').includes('mp4') ? 'm4a' : 'webm'
        if (blob.size > 0) setVocalSource(blob, `recording.${ext}`, 'Mic recording')
        stream.getTracks().forEach((t) => t.stop())
        recStreamRef.current = null
        recMeterRef.current?.close()
        recMeterRef.current = null
      }
      recorderRef.current = rec
      rec.start()
      setRecording(true)
    } catch (err) {
      console.error('[choir] recorder failed:', err)
      stream.getTracks().forEach((t) => t.stop())
      meter.close()
      recStreamRef.current = null
      recMeterRef.current = null
      showToast('Recording failed to start — try again.')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }
  useEffect(() => () => {
    recStreamRef.current?.getTracks().forEach((t) => t.stop())
    recMeterRef.current?.close()
  }, [])

  async function handleGenerate() {
    if (phase === 'uploading' || phase === 'generating') return
    if (!vocal) { showToast('Add a solo vocal first — upload a file or record one.'); return }
    if (!isAdmin && creditsRemaining !== null && creditsRemaining < CHOIR_CREDITS) {
      showToast(`Not enough credits — a harmony stack costs ${CHOIR_CREDITS}.`)
      return
    }

    setErrorMsg('')
    setResult(null)
    try {
      // 1 — presigned PUT straight to storage (StemStudio pattern).
      setPhase('uploading')
      const mime = vocal.blob.type || guessMime(vocal.filename)
      const presignRes = await fetch('/api/upload-stem/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: vocal.filename, contentType: mime }),
      })
      const presign = await presignRes.json().catch(() => ({}))
      if (!presignRes.ok) throw new Error(presign.error ?? `Failed to get upload URL (${presignRes.status})`)
      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mime },
        body: vocal.blob,
      })
      if (!putRes.ok) throw new Error(`Storage upload failed (${putRes.status})`)

      // 2 — build the stack (server charges CHOIR_CREDITS atomically; any
      // failure refunds server-side).
      setPhase('generating')
      const res = await fetch('/api/choir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocalPath: presign.path,
          voices,
          mode,
          title: title.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Harmony build failed (${res.status})`)

      setResult({ swapId: data.swapId, url: data.url, title: title.trim() || 'Choir harmony' })
      setPhase('done')
      refetchCredits()
      showToast('Harmony stack ready — saved to Saved Tracks.')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[choir] generate failed:', msg)
      setErrorMsg(msg)
      setPhase('error')
      refetchCredits()
    }
  }

  async function handleDownload() {
    if (!result || downloading) return
    setDownloading(true)
    try {
      const res = await fetch(result.url)
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${result.title}.mp3`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[choir] download failed:', err)
      showToast('Download failed — please try again')
    } finally {
      setDownloading(false)
    }
  }

  const busy = phase === 'uploading' || phase === 'generating'

  return (
    <>
      <div className="ch-shell">
        <VSidebar
          creditsRemaining={creditsRemaining}
          creditsTotal={creditsTotal}
          plan={plan}
          activeTool="Choir Composer"
        />

        <main className="ch-main">
          <div className="ch-head">
            <h1 className="ch-h1">🎼 Choir Composer</h1>
            <p className="ch-sub">
              Turn a solo vocal into stacked harmonies: your own voice, pitch-shifted
              to musical intervals and layered back over the original. It&rsquo;s a
              harmonizer — one voice made fuller, not separate AI singers.
            </p>
          </div>

          <div className="ch-card">
            {/* Vocal source */}
            <label className="ch-lbl">Solo vocal</label>
            <div className="ch-source-row">
              <label className={`ch-drop${busy || recording ? ' ch-drop--disabled' : ''}`}>
                <input
                  type="file"
                  accept=".mp3,.wav,.m4a,.webm,audio/*"
                  style={{ display: 'none' }}
                  disabled={busy || recording}
                  onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }}
                />
                ⬆ Upload a vocal
                <span className="ch-drop-hint">MP3 / WAV / M4A / WEBM · max 25 MB · works best on a clean solo take</span>
              </label>
              {recording ? (
                <button className="ch-rec-btn ch-rec-btn--live" onClick={stopRecording} disabled={busy}>
                  ■ Stop ({Math.floor(recSeconds / 60)}:{String(recSeconds % 60).padStart(2, '0')})
                </button>
              ) : (
                <MicCheckWizard
                  audio={{ echoCancellation: false, noiseSuppression: false, autoGainControl: false }}
                  onReady={startRecording}
                  triggerLabel="● Record"
                  triggerClassName="ch-rec-btn"
                  disabled={busy}
                />
              )}
            </div>
            {recording && <RecordingQualityMonitor meter={recMeterRef.current} />}
            {vocal && !recording && (
              <div className="ch-vocal-picked">
                <span className="ch-vocal-name">🎤 {vocal.label}</span>
                <AudioPlayer src={vocal.previewUrl} label="Your vocal" />
              </div>
            )}

            {/* Preset */}
            <label className="ch-lbl">Voices</label>
            <div className="ch-seg">
              {VOICE_OPTIONS.map((v) => (
                <button
                  key={v}
                  className={`ch-seg-btn${voices === v ? ' ch-seg-btn--active' : ''}`}
                  onClick={() => setVoices(v)}
                  disabled={busy}
                >
                  {v} voices
                </button>
              ))}
            </div>

            <label className="ch-lbl">Harmony</label>
            <div className="ch-modes">
              {MODE_OPTIONS.map((m) => (
                <button
                  key={m}
                  className={`ch-mode-card${mode === m ? ' ch-mode-card--active' : ''}`}
                  onClick={() => setMode(m)}
                  disabled={busy}
                >
                  <span className="ch-mode-label">{CHOIR_MODE_LABELS[m].label}</span>
                  <span className="ch-mode-hint">{CHOIR_MODE_LABELS[m].hint}</span>
                </button>
              ))}
            </div>

            <label className="ch-lbl" htmlFor="ch-title">Title <span className="ch-opt">(optional)</span></label>
            <input
              id="ch-title"
              className="ch-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Choir harmony"
              maxLength={120}
              disabled={busy}
            />

            <button className="ch-generate" onClick={handleGenerate} disabled={busy || recording || !vocal}>
              {phase === 'uploading'
                ? '⏳ Uploading vocal…'
                : phase === 'generating'
                  ? `⏳ Stacking harmonies… ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
                  : `♬ Build harmony stack · ${isAdmin ? 'free (founder)' : `${CHOIR_CREDITS} cr`}`}
            </button>

            <p className="ch-fine">
              The {mode === 'major' ? 'thirds-&-fifths preset assumes a major-key melody — off-key notes will clash (Octaves mode always fits)' : 'octave preset fits any melody'}.
              Every layer is your recording pitch-shifted, so the result keeps your timing and words exactly.
            </p>
          </div>

          {phase === 'error' && (
            <div className="ch-card ch-card--error">
              <div className="ch-err-title">Harmony build failed</div>
              <div className="ch-err-msg">{errorMsg} — if credits were taken, they were refunded.</div>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="ch-card">
              <div className="ch-result-head">
                <span className="ch-result-ico">✅</span>
                <div>
                  <div className="ch-result-title">{result.title}</div>
                  <div className="ch-result-sub">Saved to your tracks — plays from durable storage, never expires.</div>
                </div>
              </div>
              <AudioPlayer src={result.url} label="Harmony stack" />
              <div className="ch-actions">
                <button className="ch-btn-solid" onClick={handleDownload} disabled={downloading}>
                  {downloading ? 'Preparing…' : '⬇ Download MP3'}
                </button>
                <ShareControl swapId={result.swapId} initialToken={null} onToast={showToast} />
                <Link href={`/swaps/${result.swapId}`} className="ch-btn-ghost">Open in Saved Tracks</Link>
              </div>
            </div>
          )}
        </main>
      </div>

      <VToast visible={toast.visible} message={toast.message} />

      <style suppressHydrationWarning>{`
        body { background: #05050F; }
        .ch-shell { display: flex; min-height: 100vh; background: #05050F; }
        .ch-main { flex: 1; max-width: 760px; margin: 0 auto; padding: 40px 28px 80px; width: 100%; }
        .ch-head { margin-bottom: 22px; }
        .ch-h1 {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 24px; font-weight: 700; letter-spacing: -0.4px;
          color: #F0F0FF; margin: 0 0 6px;
        }
        .ch-sub { font-size: 13px; color: #A0A0C8; line-height: 1.6; margin: 0; }
        .ch-card {
          background: #09091A; border: 1px solid #2E2E56;
          border-radius: 16px; padding: 24px; margin-bottom: 18px;
        }
        .ch-card--error { border-color: rgba(239,68,68,.3); }
        .ch-err-title { font-size: 14px; font-weight: 700; color: #F87171; margin-bottom: 6px; }
        .ch-err-msg { font-size: 12px; color: #A0A0C8; line-height: 1.6; word-break: break-word; }
        .ch-lbl {
          display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
          font-size: 12px; font-weight: 600; color: #A8A8CC; margin: 18px 0 8px;
        }
        .ch-lbl:first-child { margin-top: 0; }
        .ch-opt { font-weight: 400; color: #8E8EB4; }
        .ch-source-row { display: flex; gap: 10px; align-items: stretch; flex-wrap: wrap; }
        .ch-drop {
          flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 4px;
          align-items: center; justify-content: center; text-align: center;
          border: 1.5px dashed #3C3C6A; border-radius: 12px; padding: 18px 14px;
          font-size: 13px; font-weight: 600; color: #C4C4E0; cursor: pointer;
          transition: all 0.2s;
        }
        .ch-drop:hover { border-color: rgba(157,92,255,.5); color: #9D5CFF; }
        .ch-drop--disabled { opacity: 0.5; pointer-events: none; }
        .ch-drop-hint { font-size: 10px; font-weight: 400; color: #8E8EB4; }
        .ch-rec-btn {
          padding: 12px 20px; border-radius: 12px; border: 1px solid #3C3C6A;
          background: transparent; color: #C4C4E0;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
          align-self: stretch;
        }
        .ch-rec-btn:hover:not(:disabled) { border-color: #F9459E; color: #F9459E; }
        .ch-rec-btn--live {
          border-color: rgba(239,68,68,.5); color: #F87171;
          background: rgba(239,68,68,.08); animation: ch-pulse 1.2s ease-in-out infinite;
        }
        .ch-rec-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        @keyframes ch-pulse { 50% { opacity: 0.65; } }
        .ch-vocal-picked { margin-top: 12px; }
        .ch-vocal-name {
          display: block; font-size: 12px; font-weight: 600; color: #C4C4E0;
          margin-bottom: 8px; word-break: break-all;
        }
        .ch-seg { display: flex; gap: 8px; flex-wrap: wrap; }
        .ch-seg-btn {
          padding: 8px 18px; border-radius: 8px; border: 1px solid #2E2E56;
          background: #0E0E20; color: #A0A0C8; font-size: 12px; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
        }
        .ch-seg-btn:hover:not(:disabled) { color: #F0F0FF; border-color: rgba(157,92,255,.35); }
        .ch-seg-btn--active {
          background: linear-gradient(135deg,#9D5CFF,#F9459E); color: #fff; border-color: transparent;
        }
        .ch-seg-btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .ch-modes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
        .ch-mode-card {
          display: flex; flex-direction: column; gap: 5px; text-align: left;
          padding: 14px; border-radius: 12px; border: 1.5px solid #2E2E56;
          background: #0E0E20; cursor: pointer; transition: all 0.2s;
        }
        .ch-mode-card:hover:not(:disabled) { border-color: rgba(157,92,255,.35); }
        .ch-mode-card--active { border-color: #9D5CFF; background: rgba(157,92,255,.06); }
        .ch-mode-card:disabled { opacity: 0.55; cursor: not-allowed; }
        .ch-mode-label { font-size: 13px; font-weight: 700; color: #F0F0FF; }
        .ch-mode-hint { font-size: 11px; color: #8E8EB4; line-height: 1.5; }
        .ch-input {
          width: 100%; background: #0E0E20; border: 1px solid #2E2E56;
          border-radius: 8px; padding: 10px 12px; font-size: 13px; color: #F0F0FF;
          outline: none; transition: border-color 0.2s; font-family: inherit;
        }
        .ch-input:focus { border-color: rgba(157,92,255,.5); }
        .ch-input:disabled { opacity: 0.55; }
        .ch-generate {
          display: block; width: 100%; margin-top: 20px;
          padding: 13px 22px; border-radius: 10px; border: none;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          color: #fff; font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.25s;
        }
        .ch-generate:hover:not(:disabled) { box-shadow: 0 8px 24px rgba(157,92,255,.4); transform: translateY(-1px); }
        .ch-generate:disabled { opacity: 0.6; cursor: not-allowed; }
        .ch-fine {
          margin: 12px 0 0; font-size: 11px; color: #8E8EB4; line-height: 1.6;
        }
        .ch-result-head { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
        .ch-result-ico { font-size: 24px; }
        .ch-result-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 16px; font-weight: 700; color: #F0F0FF; word-break: break-word;
        }
        .ch-result-sub { font-size: 11px; color: #8E8EB4; margin-top: 2px; }
        .ch-actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; align-items: center; }
        .ch-btn-solid {
          padding: 11px 22px; border-radius: 9px; border: none;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          color: #fff; font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.25s;
        }
        .ch-btn-solid:hover:not(:disabled) { box-shadow: 0 8px 24px rgba(157,92,255,.4); transform: translateY(-1px); }
        .ch-btn-solid:disabled { opacity: 0.5; cursor: not-allowed; }
        .ch-btn-ghost {
          display: inline-block; padding: 11px 22px; border-radius: 9px;
          border: 1px solid #3C3C6A; background: transparent; color: #C4C4E0;
          text-decoration: none;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .ch-btn-ghost:hover { border-color: #9D5CFF; color: #9D5CFF; }
        @media (max-width: 900px) {
          .ch-shell { flex-direction: column; }
          .ch-main { padding: 24px 16px 60px; }
          .ch-modes { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  )
}
