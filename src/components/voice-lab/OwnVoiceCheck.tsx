'use client'

import { useEffect, useRef, useState } from 'react'
import { pickRecorderMimeType } from './audioUtils'
import { randomPhrase, type OwnVoiceVerdict } from '@/lib/own-voice'

// Own-voice check (2026-10-27): right after a voice is saved, the user says five random digits; the
// server compares that clip with the voice's recording (/api/voice-lab/voice-check). A soft gate —
// the result is shown and stored, and nothing is blocked (see src/lib/own-voice.ts).
const MAX_S = 8

type Phase = 'idle' | 'recording' | 'checking' | 'done' | 'unavailable'

export function OwnVoiceCheck({ voiceId, voiceName }: { voiceId: string; voiceName: string }) {
  const [phrase, setPhrase] = useState(randomPhrase)
  const [phase, setPhase] = useState<Phase>('idle')
  const [verdict, setVerdict] = useState<OwnVoiceVerdict | null>(null)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')
  const recRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => () => { clearInterval(timerRef.current); recRef.current?.stream.getTracks().forEach((t) => t.stop()) }, [])

  async function start() {
    setError('')
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch {
      setError('Microphone not available — allow mic access and try again.')
      return
    }
    const mime = pickRecorderMimeType()
    const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    rec.onstop = () => {
      clearInterval(timerRef.current)
      stream.getTracks().forEach((t) => t.stop())
      void check(new Blob(chunks, { type: mime || rec.mimeType || 'audio/webm' }))
    }
    recRef.current = rec
    rec.start()
    setSeconds(0)
    setPhase('recording')
    let s = 0
    timerRef.current = setInterval(() => { s += 1; setSeconds(s); if (s >= MAX_S && rec.state === 'recording') rec.stop() }, 1000)
  }

  function stop() { if (recRef.current?.state === 'recording') recRef.current.stop() }

  async function check(blob: Blob) {
    setPhase('checking')
    try {
      const presign = await fetch('/api/voice-lab/presign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: blob.type, check: true }),
      }).then((r) => r.json())
      if (!presign.uploadUrl) throw new Error('upload')
      const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': presign.mime }, body: blob })
      if (!put.ok) throw new Error('upload')
      const startRes = await fetch('/api/voice-lab/voice-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceId, path: presign.path }),
      })
      const started = await startRes.json().catch(() => ({}))
      if (!startRes.ok || !started.id) { setPhase('unavailable'); return }
      const q = `id=${encodeURIComponent(started.id)}&voiceId=${encodeURIComponent(voiceId)}&path=${encodeURIComponent(presign.path)}`
      const t0 = Date.now()
      while (Date.now() - t0 < 4 * 60_000) {   // the machine may need a cold start (~1–2 min)
        await new Promise((r) => setTimeout(r, 4000))
        const poll = await fetch(`/api/voice-lab/voice-check?${q}`).then((r) => r.json()).catch(() => null)
        if (!poll || poll.status === 'starting' || poll.status === 'processing') continue
        if (poll.status === 'succeeded' && poll.verdict) { setVerdict(poll.verdict); setPhase('done'); return }
        break
      }
      setPhase('unavailable')
    } catch {
      setError('Could not upload the check — try again.')
      setPhase('idle')
    }
  }

  function again() { setPhrase(randomPhrase()); setVerdict(null); setPhase('idle') }

  return (
    <div className="ovc">
      <div className="ovc-title">Quick check: is &ldquo;{voiceName}&rdquo; your own voice?</div>
      {(phase === 'idle' || phase === 'recording') && (
        <>
          <p className="ovc-text">Press record and say these numbers out loud, in any language:</p>
          <div className="ovc-phrase">{phrase}</div>
          {phase === 'idle'
            ? <button type="button" className="ovc-btn" onClick={() => void start()}>● Record</button>
            : <button type="button" className="ovc-btn ovc-btn--stop" onClick={stop}>■ Stop ({MAX_S - seconds} s)</button>}
        </>
      )}
      {phase === 'checking' && <p className="ovc-text">Comparing it with your recording… (up to a minute or two)</p>}
      {phase === 'done' && verdict === 'match' && <p className="ovc-text ovc-ok">✓ It matches your recording. You&rsquo;re all set.</p>}
      {phase === 'done' && verdict === 'unsure' && (
        <p className="ovc-text">
          We couldn&rsquo;t fully confirm it&rsquo;s the same voice — common with a different mic or room, or
          speaking instead of singing. You can carry on.{' '}
          <button type="button" className="ovc-link" onClick={again}>Try again</button>
        </p>
      )}
      {phase === 'done' && verdict === 'mismatch' && (
        <p className="ovc-text ovc-warn">
          This doesn&rsquo;t sound like the voice in the recording. MausamVox only allows your own voice
          (<a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>). If it is you, record again closer to the mic.{' '}
          <button type="button" className="ovc-link" onClick={again}>Try again</button>
        </p>
      )}
      {phase === 'unavailable' && <p className="ovc-text">The check isn&rsquo;t available right now — you can carry on.</p>}
      {error && <p className="ovc-text ovc-warn">{error}</p>}
      <style suppressHydrationWarning>{`
        .ovc { margin: 0 24px 16px; padding: 14px 16px; border: 1px solid #2E2E56; border-radius: 12px; background: #0E0E20; }
        .ovc-title { font-size: 13px; font-weight: 600; color: #F0F0FF; margin-bottom: 6px; }
        .ovc-text { margin: 0 0 8px; font-size: 13px; color: #C8C8E8; line-height: 1.5; }
        .ovc-phrase { font-family: var(--font-grotesk), monospace; font-size: 26px; letter-spacing: 6px; color: #C4B5FD; margin: 4px 0 12px; }
        .ovc-btn { border: none; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 600; color: #fff; cursor: pointer; background: linear-gradient(135deg,#9D5CFF,#F9459E); }
        .ovc-btn--stop { background: #F87171; }
        .ovc-ok { color: #34D399; }
        .ovc-warn { color: #FBBF24; }
        .ovc-warn a { color: #FBBF24; }
        .ovc-link { border: none; background: none; padding: 0; color: #A78BFA; font-size: 13px; text-decoration: underline; cursor: pointer; }
      `}</style>
    </div>
  )
}
