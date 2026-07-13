'use client'

// Recording-quality wizard shared by every in-browser mic recorder (Voice Lab
// Quick/Pro Record, Choir, Instruments). Capture-time quality aid ONLY: it
// opens the mic, checks the room's noise floor, counts the user in, then hands
// the ALREADY-OPEN stream (+ its MicMeter) to the page's existing recorder —
// what gets recorded/uploaded and every downstream step is untouched.
//
// Flow: trigger button → permission prompt (friendly copy, inline retry on
// deny) → ~1.6 s quiet room check with a live meter → verdict (quiet: straight
// on; noisy: warn with "Check again" / "Record anyway") → 3-2-1 countdown →
// onReady(stream, meter). Cancelling anywhere closes the mic cleanly.

import { useEffect, useRef, useState } from 'react'
import {
  MicMeter,
  NOISE_NOISY_DB,
  NOISE_QUIET_DB,
  NOISE_CHECK_MS,
  CLIP_PEAK,
  CLIP_HOLD_MS,
  SPIKE_RATIO,
  SPIKE_MIN_RMS,
  SPIKE_HOLD_MS,
} from './micMeter'

type WizPhase = 'idle' | 'requesting' | 'sampling' | 'noisy' | 'countdown' | 'error'

interface MicCheckWizardProps {
  // The page's EXISTING getUserMedia audio constraints, unchanged — the wizard
  // must not alter how audio is captured, only when recording starts.
  audio: MediaTrackConstraints | true
  // Countdown finished: ownership of the stream + meter transfers to the page.
  onReady: (stream: MediaStream, meter: MicMeter) => void
  triggerLabel: string
  triggerClassName: string
  disabled?: boolean
}

function levelColor(rms: number) {
  if (rms > 0.6) return '#EF4444'
  if (rms > 0.35) return '#F59E0B'
  return '#10B981'
}

function LevelBar({ rms }: { rms: number }) {
  return (
    <div className="mcw-meter-track">
      <div
        className="mcw-meter-fill"
        style={{ width: `${Math.min(100, rms * 140)}%`, background: levelColor(rms) }}
      />
    </div>
  )
}

const WIZARD_CSS = `
  .mcw-panel {
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    width: 100%; max-width: 360px; padding: 14px;
    background: #0E0E20; border: 1px solid #2E2E56; border-radius: 12px;
    text-align: center;
  }
  .mcw-status { font-size: 13px; color: #C4C4E0; line-height: 1.5; }
  .mcw-hint { font-size: 11px; color: #8E8EB4; line-height: 1.5; }
  .mcw-warn { font-size: 12px; color: #F59E0B; line-height: 1.5; }
  .mcw-error { font-size: 12px; color: #F87171; line-height: 1.5; }
  .mcw-meter-track {
    width: 100%; height: 10px; background: #05050F;
    border: 1px solid #2E2E56; border-radius: 5px; overflow: hidden;
  }
  .mcw-meter-fill { height: 100%; transition: width 0.08s linear, background 0.15s; }
  .mcw-count {
    font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
    font-size: 44px; font-weight: 700; line-height: 1;
    background: linear-gradient(135deg,#9D5CFF,#F9459E,#0CC7E8);
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .mcw-btn-row { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .mcw-btn {
    padding: 8px 16px; border-radius: 8px; font-size: 12px; font-weight: 600;
    font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
    cursor: pointer; transition: all 0.2s; border: none;
  }
  .mcw-btn--solid { background: linear-gradient(135deg,#9D5CFF,#F9459E); color: #fff; }
  .mcw-btn--solid:hover { box-shadow: 0 6px 18px rgba(157,92,255,.4); }
  .mcw-btn--outline { background: transparent; border: 1px solid #3C3C6A; color: #C4C4E0; }
  .mcw-btn--outline:hover { border-color: #9D5CFF; color: #9D5CFF; }
  .mcw-cancel {
    font-size: 11px; color: #8E8EB4; background: none; border: none;
    cursor: pointer; text-decoration: underline;
  }
  .mcw-cancel:hover { color: #C4C4E0; }
`

export function MicCheckWizard({ audio, onReady, triggerLabel, triggerClassName, disabled }: MicCheckWizardProps) {
  const [phase, setPhase] = useState<WizPhase>('idle')
  const [liveRms, setLiveRms] = useState(0)
  const [noiseDb, setNoiseDb] = useState<number | null>(null)
  const [count, setCount] = useState(3)
  const [errorMsg, setErrorMsg] = useState('')

  const streamRef = useRef<MediaStream | null>(null)
  const meterRef = useRef<MicMeter | null>(null)
  // Bumped on cancel/unmount so an in-flight async step can't act afterwards.
  const runRef = useRef(0)
  const countdownRef = useRef<ReturnType<typeof setInterval>>()

  function releaseMic() {
    clearInterval(countdownRef.current)
    meterRef.current?.close()
    meterRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }

  // Unmount: only release if the mic wasn't handed off (refs are nulled on
  // hand-off, so a live recording is never killed by the wizard leaving).
  useEffect(() => () => { runRef.current++; releaseMic() }, [])

  async function start() {
    const run = ++runRef.current
    setErrorMsg('')
    setLiveRms(0)
    setPhase('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio })
      if (run !== runRef.current) { stream.getTracks().forEach((t) => t.stop()); return }
      streamRef.current = stream
      // Meter (AudioContext) is created right here in the user-gesture call
      // chain; MicMeter resumes a suspended context for iOS Safari.
      const meter = new MicMeter(stream)
      meterRef.current = meter

      setPhase('sampling')
      const db = await meter.measureNoiseFloor(NOISE_CHECK_MS, (rms) => {
        if (run === runRef.current) setLiveRms(rms)
      })
      if (run !== runRef.current) return
      setNoiseDb(db)
      if (db > NOISE_NOISY_DB) {
        setPhase('noisy')
      } else {
        beginCountdown(run)
      }
    } catch (err) {
      if (run !== runRef.current) return
      releaseMic()
      const name = err instanceof DOMException ? err.name : ''
      setErrorMsg(
        name === 'NotAllowedError'
          ? 'Microphone access was blocked. Allow the mic in your browser settings, then tap Try Again.'
          : name === 'NotFoundError'
          ? 'No microphone was found on this device.'
          : 'Couldn’t access the microphone — try again.'
      )
      setPhase('error')
    }
  }

  function beginCountdown(run: number) {
    setPhase('countdown')
    setCount(3)
    let n = 3
    countdownRef.current = setInterval(() => {
      if (run !== runRef.current) { clearInterval(countdownRef.current); return }
      n--
      if (n > 0) { setCount(n); return }
      clearInterval(countdownRef.current)
      const stream = streamRef.current
      const meter = meterRef.current
      // Hand off ownership: null the refs FIRST so our cleanup can't touch
      // the live recording, then let the page start its recorder.
      streamRef.current = null
      meterRef.current = null
      setPhase('idle')
      if (stream && meter) onReady(stream, meter)
    }, 800)
  }

  function cancel() {
    runRef.current++
    releaseMic()
    setPhase('idle')
  }

  function retry() {
    runRef.current++
    releaseMic()
    void start()
  }

  if (phase === 'idle') {
    return (
      <button className={triggerClassName} onClick={() => void start()} disabled={disabled}>
        {triggerLabel}
      </button>
    )
  }

  return (
    <div className="mcw-panel">
      {phase === 'requesting' && (
        <>
          <div className="mcw-status">🎙️ Asking for microphone access…</div>
          <div className="mcw-hint">If your browser asks, tap Allow.</div>
        </>
      )}

      {phase === 'sampling' && (
        <>
          <div className="mcw-status">🤫 Quick room check — stay quiet for a moment…</div>
          <LevelBar rms={liveRms} />
          <div className="mcw-hint">Listening to your room’s background noise.</div>
        </>
      )}

      {phase === 'noisy' && (
        <>
          <div className="mcw-warn">
            ⚠ Too noisy ({noiseDb !== null ? Math.round(noiseDb) : '—'} dB background). A quieter
            room makes a clearly better recording — close windows, turn off fans, or move rooms.
          </div>
          <div className="mcw-btn-row">
            <button className="mcw-btn mcw-btn--outline" onClick={retry}>↺ Check again</button>
            <button className="mcw-btn mcw-btn--solid" onClick={() => beginCountdown(runRef.current)}>
              Record anyway →
            </button>
          </div>
          <button className="mcw-cancel" onClick={cancel}>Cancel</button>
        </>
      )}

      {phase === 'countdown' && (
        <>
          <div className="mcw-status">
            {noiseDb !== null && noiseDb <= NOISE_QUIET_DB
              ? '✓ Nice and quiet — get ready…'
              : 'Get ready…'}
          </div>
          <div className="mcw-count">{count}</div>
        </>
      )}

      {phase === 'error' && (
        <>
          <div className="mcw-error">{errorMsg}</div>
          <div className="mcw-btn-row">
            <button className="mcw-btn mcw-btn--outline" onClick={retry}>Try Again</button>
            <button className="mcw-cancel" onClick={cancel}>Cancel</button>
          </div>
        </>
      )}

      <style suppressHydrationWarning>{WIZARD_CSS}</style>
    </div>
  )
}

// During-recording companion: live level bar + non-destructive warnings for
// clipping ("too loud, move back") and sudden background spikes. Watches the
// meter the wizard handed over — it never touches the recording itself.
export function RecordingQualityMonitor({ meter }: { meter: MicMeter | null }) {
  const [rms, setRms] = useState(0)
  const [clipping, setClipping] = useState(false)
  const [spiked, setSpiked] = useState(false)
  const rafRef = useRef<number>()
  const emaRef = useRef(0)
  const clipUntilRef = useRef(0)
  const spikeUntilRef = useRef(0)

  useEffect(() => {
    if (!meter) return
    emaRef.current = 0
    function frame() {
      if (!meter) return
      const snap = meter.snapshot()
      const now = Date.now()
      if (snap.peak >= CLIP_PEAK) clipUntilRef.current = now + CLIP_HOLD_MS
      // Rolling average of the take's own loudness; a frame far above it (and
      // above an absolute floor) that isn't the user clipping = background spike.
      else if (
        emaRef.current > 0.01 &&
        snap.rms > emaRef.current * SPIKE_RATIO &&
        snap.rms > SPIKE_MIN_RMS
      ) spikeUntilRef.current = now + SPIKE_HOLD_MS
      emaRef.current = emaRef.current * 0.95 + snap.rms * 0.05
      setRms(snap.rms)
      setClipping(now < clipUntilRef.current)
      setSpiked(now < spikeUntilRef.current)
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [meter])

  if (!meter) return null

  return (
    <div className="mcw-monitor">
      <LevelBar rms={rms} />
      {clipping && (
        <div className="mcw-warn">🔴 Too loud — it’s distorting. Move back from the mic a little.</div>
      )}
      {spiked && !clipping && (
        <div className="mcw-warn">
          ⚡ Loud background noise picked up — your take is still going; re-record if it wasn’t you.
        </div>
      )}
      <style suppressHydrationWarning>{`
        .mcw-monitor {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          width: 100%; max-width: 360px;
        }
        .mcw-warn { font-size: 12px; color: #F59E0B; line-height: 1.5; text-align: center; }
        .mcw-meter-track {
          width: 100%; height: 10px; background: #05050F;
          border: 1px solid #2E2E56; border-radius: 5px; overflow: hidden;
        }
        .mcw-meter-fill { height: 100%; transition: width 0.08s linear, background 0.15s; }
      `}</style>
    </div>
  )
}
