'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { ADMIN_EMAILS } from '@/lib/admin'
import { VSidebar } from '@/components/voice-swap/VSidebar'
import { AudioPlayer } from '@/components/voice-swap/AudioPlayer'
import { VToast } from '@/components/voice-swap/VToast'
import { ShareControl } from '@/components/share/ShareControl'
import {
  INSTRUMENTS,
  INSTRUMENTS_CREDITS,
  INSTRUMENTS_MAX_SECONDS,
  type InstrumentDef,
} from '@/lib/instruments'

// Instruments — voice → instrument. HONEST FRAMING: we transcribe the melody
// of the user's vocal (notes + timing) and REPLAY it on the chosen instrument;
// the output is a synthesized instrument playing their tune, not their voice
// "turned into" an instrument timbre. Monophonic — one note at a time.

type Phase = 'idle' | 'uploading' | 'generating' | 'done' | 'error'
type VocalSource = { blob: Blob; filename: string; label: string; previewUrl: string }

const ACCEPTED_EXTS = ['mp3', 'wav', 'm4a', 'webm']
const MAX_BYTES = 15 * 1024 * 1024 // matches the route's byte cap

const GROUPS: InstrumentDef['group'][] = ['Keys', 'Strings', 'Plucked', 'Winds', 'Brass', 'Other']

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'wav') return 'audio/wav'
  if (ext === 'm4a') return 'audio/mp4'
  if (ext === 'webm') return 'audio/webm'
  return 'audio/mpeg'
}

export function InstrumentsPage() {
  const [isAdmin, setIsAdmin] = useState(false)
  const [plan, setPlan] = useState<string | null>(null)
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null)
  const [creditsTotal, setCreditsTotal] = useState<number | null>(null)

  const [vocal, setVocal] = useState<VocalSource | null>(null)
  const [instrumentId, setInstrumentId] = useState('grand-piano')
  const [title, setTitle] = useState('')

  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [result, setResult] = useState<{ swapId: string; url: string; title: string; noteCount: number } | null>(null)
  const [downloading, setDownloading] = useState(false)

  // ── Recorder (Choir pattern: raw take, hard cap) ───────────────────────────
  const [recording, setRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recChunksRef = useRef<Blob[]>([])
  const recStreamRef = useRef<MediaStream | null>(null)

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

  useEffect(() => {
    if (phase !== 'uploading' && phase !== 'generating') return
    setElapsed(0)
    const t = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [phase])

  useEffect(() => {
    if (!recording) return
    setRecSeconds(0)
    const t = setInterval(() => setRecSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [recording])
  useEffect(() => {
    if (recording && recSeconds >= INSTRUMENTS_MAX_SECONDS) stopRecording()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recSeconds, recording])

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
      showToast(`File must be 15 MB or smaller (yours is ${(file.size / 1024 / 1024).toFixed(1)} MB).`)
      return
    }
    setVocalSource(file, file.name, file.name)
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      recStreamRef.current = stream
      recChunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => { if (e.data.size > 0) recChunksRef.current.push(e.data) }
      rec.onstop = () => {
        const blob = new Blob(recChunksRef.current, { type: rec.mimeType || 'audio/webm' })
        const ext = (rec.mimeType || '').includes('mp4') ? 'm4a' : 'webm'
        if (blob.size > 0) setVocalSource(blob, `recording.${ext}`, 'Mic recording')
        stream.getTracks().forEach((t) => t.stop())
        recStreamRef.current = null
      }
      recorderRef.current = rec
      rec.start()
      setRecording(true)
    } catch (err) {
      console.error('[instruments] mic failed:', err)
      showToast('Microphone unavailable — check browser permissions.')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }
  useEffect(() => () => { recStreamRef.current?.getTracks().forEach((t) => t.stop()) }, [])

  async function handleGenerate() {
    if (phase === 'uploading' || phase === 'generating') return
    if (!vocal) { showToast('Add a vocal first — hum or sing a melody.'); return }
    if (!isAdmin && creditsRemaining !== null && creditsRemaining < INSTRUMENTS_CREDITS) {
      showToast(`Not enough credits — converting a melody costs ${INSTRUMENTS_CREDITS}.`)
      return
    }
    const instrument = INSTRUMENTS.find((i) => i.id === instrumentId)
    if (!instrument) { showToast('Pick an instrument.'); return }

    setErrorMsg('')
    setResult(null)
    try {
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

      setPhase('generating')
      const res = await fetch('/api/instruments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocalPath: presign.path,
          instrumentId,
          title: title.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Conversion failed (${res.status})`)

      setResult({
        swapId: data.swapId,
        url: data.url,
        title: title.trim() || `${instrument.label} melody`,
        noteCount: data.noteCount ?? 0,
      })
      setPhase('done')
      refetchCredits()
      showToast('Melody converted — saved to Saved Tracks.')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[instruments] generate failed:', msg)
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
      console.error('[instruments] download failed:', err)
      showToast('Download failed — please try again')
    } finally {
      setDownloading(false)
    }
  }

  const busy = phase === 'uploading' || phase === 'generating'
  const selected = INSTRUMENTS.find((i) => i.id === instrumentId)

  return (
    <>
      <div className="in-shell">
        <VSidebar
          creditsRemaining={creditsRemaining}
          creditsTotal={creditsTotal}
          plan={plan}
          activeTool="Instruments"
        />

        <main className="in-main">
          <div className="in-head">
            <h1 className="in-h1">🎷 Instruments</h1>
            <p className="in-sub">
              Hum or sing a melody and hear it played on a real instrument. We
              transcribe the notes and timing of your voice, then replay that tune on
              the instrument you pick — one note at a time, so it works best on a
              clear single-note hum (no chords, no backing music).
            </p>
          </div>

          <div className="in-card">
            <label className="in-lbl">Your melody <span className="in-hint">max {INSTRUMENTS_MAX_SECONDS} seconds</span></label>
            <div className="in-source-row">
              <label className={`in-drop${busy || recording ? ' in-drop--disabled' : ''}`}>
                <input
                  type="file"
                  accept=".mp3,.wav,.m4a,.webm,audio/*"
                  style={{ display: 'none' }}
                  disabled={busy || recording}
                  onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = '' }}
                />
                ⬆ Upload audio
                <span className="in-drop-hint">MP3 / WAV / M4A / WEBM · max 15 MB · a clean solo hum or la-la works best</span>
              </label>
              <button
                className={`in-rec-btn${recording ? ' in-rec-btn--live' : ''}`}
                onClick={recording ? stopRecording : startRecording}
                disabled={busy}
              >
                {recording
                  ? `■ Stop (${Math.floor(recSeconds / 60)}:${String(recSeconds % 60).padStart(2, '0')})`
                  : '● Record'}
              </button>
            </div>
            {vocal && !recording && (
              <div className="in-vocal-picked">
                <span className="in-vocal-name">🎤 {vocal.label}</span>
                <AudioPlayer src={vocal.previewUrl} label="Your melody" />
              </div>
            )}

            <label className="in-lbl">Instrument</label>
            {GROUPS.map((group) => {
              const items = INSTRUMENTS.filter((i) => i.group === group)
              if (items.length === 0) return null
              return (
                <div key={group} className="in-group">
                  <div className="in-group-lbl">{group}</div>
                  <div className="in-grid">
                    {items.map((i) => (
                      <button
                        key={i.id}
                        className={`in-inst${instrumentId === i.id ? ' in-inst--active' : ''}`}
                        onClick={() => setInstrumentId(i.id)}
                        disabled={busy}
                        title={i.label}
                      >
                        <span className="in-inst-emoji">{i.emoji}</span>
                        <span className="in-inst-label">{i.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}

            <label className="in-lbl" htmlFor="in-title">Title <span className="in-opt">(optional)</span></label>
            <input
              id="in-title"
              className="in-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={selected ? `${selected.label} melody` : 'My melody'}
              maxLength={120}
              disabled={busy}
            />

            <button className="in-generate" onClick={handleGenerate} disabled={busy || recording || !vocal}>
              {phase === 'uploading'
                ? '⏳ Uploading…'
                : phase === 'generating'
                  ? `⏳ Transcribing & playing… ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
                  : `${selected?.emoji ?? '♪'} Play it on ${selected?.label ?? 'an instrument'} · ${isAdmin ? 'free (founder)' : `${INSTRUMENTS_CREDITS} cr`}`}
            </button>

            <p className="in-fine">
              The result is a synthesized {selected?.label.toLowerCase() ?? 'instrument'} playing
              your tune — your voice&rsquo;s notes and timing, not its sound. Pitch
              transcription is imperfect: slides, vibrato and noisy takes can add or
              miss notes.
            </p>
          </div>

          {phase === 'error' && (
            <div className="in-card in-card--error">
              <div className="in-err-title">Conversion failed</div>
              <div className="in-err-msg">{errorMsg} — if credits were taken, they were refunded.</div>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="in-card">
              <div className="in-result-head">
                <span className="in-result-ico">✅</span>
                <div>
                  <div className="in-result-title">{result.title}</div>
                  <div className="in-result-sub">
                    {result.noteCount} notes transcribed · saved to your tracks, never expires.
                  </div>
                </div>
              </div>
              <AudioPlayer src={result.url} label={selected?.label ?? 'Instrument'} />
              <div className="in-actions">
                <button className="in-btn-solid" onClick={handleDownload} disabled={downloading}>
                  {downloading ? 'Preparing…' : '⬇ Download MP3'}
                </button>
                <ShareControl swapId={result.swapId} initialToken={null} onToast={showToast} />
                <Link href={`/swaps/${result.swapId}`} className="in-btn-ghost">Open in Saved Tracks</Link>
              </div>
            </div>
          )}
        </main>
      </div>

      <VToast visible={toast.visible} message={toast.message} />

      <style suppressHydrationWarning>{`
        body { background: #05050F; }
        .in-shell { display: flex; min-height: 100vh; background: #05050F; }
        .in-main { flex: 1; max-width: 760px; margin: 0 auto; padding: 40px 28px 80px; width: 100%; }
        .in-head { margin-bottom: 22px; }
        .in-h1 {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 24px; font-weight: 700; letter-spacing: -0.4px;
          color: #F0F0FF; margin: 0 0 6px;
        }
        .in-sub { font-size: 13px; color: #7878A0; line-height: 1.6; margin: 0; }
        .in-card {
          background: #09091A; border: 1px solid #1E1E3A;
          border-radius: 16px; padding: 24px; margin-bottom: 18px;
        }
        .in-card--error { border-color: rgba(239,68,68,.3); }
        .in-err-title { font-size: 14px; font-weight: 700; color: #F87171; margin-bottom: 6px; }
        .in-err-msg { font-size: 12px; color: #7878A0; line-height: 1.6; word-break: break-word; }
        .in-lbl {
          display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
          font-size: 12px; font-weight: 600; color: #8888AA; margin: 18px 0 8px;
        }
        .in-lbl:first-child { margin-top: 0; }
        .in-opt { font-weight: 400; color: #5A5A80; }
        .in-hint { font-size: 10px; font-weight: 400; color: #5A5A80; }
        .in-source-row { display: flex; gap: 10px; align-items: stretch; flex-wrap: wrap; }
        .in-drop {
          flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 4px;
          align-items: center; justify-content: center; text-align: center;
          border: 1.5px dashed #2A2A4A; border-radius: 12px; padding: 18px 14px;
          font-size: 13px; font-weight: 600; color: #C4C4E0; cursor: pointer;
          transition: all 0.2s;
        }
        .in-drop:hover { border-color: rgba(139,92,246,.5); color: #8B5CF6; }
        .in-drop--disabled { opacity: 0.5; pointer-events: none; }
        .in-drop-hint { font-size: 10px; font-weight: 400; color: #5A5A80; }
        .in-rec-btn {
          padding: 12px 20px; border-radius: 12px; border: 1px solid #2A2A4A;
          background: transparent; color: #C4C4E0;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
          align-self: stretch;
        }
        .in-rec-btn:hover:not(:disabled) { border-color: #EC4899; color: #EC4899; }
        .in-rec-btn--live {
          border-color: rgba(239,68,68,.5); color: #F87171;
          background: rgba(239,68,68,.08); animation: in-pulse 1.2s ease-in-out infinite;
        }
        .in-rec-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        @keyframes in-pulse { 50% { opacity: 0.65; } }
        .in-vocal-picked { margin-top: 12px; }
        .in-vocal-name {
          display: block; font-size: 12px; font-weight: 600; color: #C4C4E0;
          margin-bottom: 8px; word-break: break-all;
        }
        .in-group { margin-bottom: 10px; }
        .in-group-lbl {
          font-size: 10px; font-weight: 700; letter-spacing: 1.5px;
          text-transform: uppercase; color: #5A5A80; margin: 8px 0 6px;
        }
        .in-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        .in-inst {
          display: flex; flex-direction: column; align-items: center; gap: 4px;
          padding: 10px 6px; border-radius: 10px; border: 1.5px solid #1E1E3A;
          background: #0E0E20; cursor: pointer; transition: all 0.2s;
        }
        .in-inst:hover:not(:disabled) { border-color: rgba(139,92,246,.35); }
        .in-inst--active { border-color: #8B5CF6; background: rgba(139,92,246,.06); }
        .in-inst:disabled { opacity: 0.55; cursor: not-allowed; }
        .in-inst-emoji { font-size: 18px; line-height: 1; }
        .in-inst-label {
          font-size: 10px; font-weight: 600; color: #C4C4E0;
          text-align: center; line-height: 1.3;
        }
        .in-input {
          width: 100%; background: #0E0E20; border: 1px solid #1E1E3A;
          border-radius: 8px; padding: 10px 12px; font-size: 13px; color: #F0F0FF;
          outline: none; transition: border-color 0.2s; font-family: inherit;
        }
        .in-input:focus { border-color: rgba(139,92,246,.5); }
        .in-input:disabled { opacity: 0.55; }
        .in-generate {
          display: block; width: 100%; margin-top: 20px;
          padding: 13px 22px; border-radius: 10px; border: none;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          color: #fff; font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.25s;
        }
        .in-generate:hover:not(:disabled) { box-shadow: 0 8px 24px rgba(139,92,246,.4); transform: translateY(-1px); }
        .in-generate:disabled { opacity: 0.6; cursor: not-allowed; }
        .in-fine { margin: 12px 0 0; font-size: 11px; color: #5A5A80; line-height: 1.6; }
        .in-result-head { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
        .in-result-ico { font-size: 24px; }
        .in-result-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 16px; font-weight: 700; color: #F0F0FF; word-break: break-word;
        }
        .in-result-sub { font-size: 11px; color: #5A5A80; margin-top: 2px; }
        .in-actions { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; align-items: center; }
        .in-btn-solid {
          padding: 11px 22px; border-radius: 9px; border: none;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          color: #fff; font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.25s;
        }
        .in-btn-solid:hover:not(:disabled) { box-shadow: 0 8px 24px rgba(139,92,246,.4); transform: translateY(-1px); }
        .in-btn-solid:disabled { opacity: 0.5; cursor: not-allowed; }
        .in-btn-ghost {
          display: inline-block; padding: 11px 22px; border-radius: 9px;
          border: 1px solid #2A2A4A; background: transparent; color: #C4C4E0;
          text-decoration: none;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .in-btn-ghost:hover { border-color: #8B5CF6; color: #8B5CF6; }
        @media (max-width: 900px) {
          .in-shell { flex-direction: column; }
          .in-main { padding: 24px 16px 60px; }
          .in-grid { grid-template-columns: repeat(3, 1fr); }
        }
      `}</style>
    </>
  )
}
