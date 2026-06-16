'use client'

import { useEffect, useRef, useState } from 'react'
import { formatTime, encodeWav, concatFloat32, rms, MIN_DURATION_SEC } from './audioUtils'

type Phase = 'idle' | 'detecting' | 'ready' | 'recording' | 'recorded' | 'error'

interface ProRecordPanelProps {
  onCaptured: (blob: Blob, mimeType: string, durationSec: number) => void
  onReset: () => void
}

function levelColor(level: number) {
  if (level > 0.5) return '#EF4444'
  if (level > 0.25) return '#F59E0B'
  return '#10B981'
}

export function ProRecordPanel({ onCaptured, onReset }: ProRecordPanelProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [sampleRate, setSampleRate] = useState<number | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const silentGainRef = useRef<GainNode | null>(null)
  const chunksRef = useRef<Float32Array[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval>>()

  function teardownAudioGraph() {
    clearInterval(timerRef.current)
    processorRef.current?.disconnect()
    sourceRef.current?.disconnect()
    silentGainRef.current?.disconnect()
    processorRef.current = null
    sourceRef.current = null
    silentGainRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
  }

  useEffect(() => () => teardownAudioGraph(), [])

  async function handleDetectDevices() {
    setPhase('detecting')
    setErrorMsg('')
    try {
      // Labels are blank until permission is granted, so open a throwaway
      // stream just to unlock them, then close it immediately.
      const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      tempStream.getTracks().forEach((t) => t.stop())

      const all = await navigator.mediaDevices.enumerateDevices()
      const inputs = all.filter((d) => d.kind === 'audioinput')
      setDevices(inputs)
      setSelectedDeviceId(inputs[0]?.deviceId ?? '')
      setPhase('ready')
    } catch (err) {
      setPhase('error')
      const name = err instanceof DOMException ? err.name : ''
      setErrorMsg(
        name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow mic access in your browser settings and try again.'
          : 'Could not detect audio input devices.'
      )
    }
  }

  async function handleStart() {
    setErrorMsg('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, sampleRate: 48000 }
          : { sampleRate: 48000 },
      })
      streamRef.current = stream

      const audioCtx = new AudioContext({ sampleRate: 48000 })
      const source = audioCtx.createMediaStreamSource(stream)
      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      const silentGain = audioCtx.createGain()
      silentGain.gain.value = 0
      source.connect(processor)
      processor.connect(silentGain)
      silentGain.connect(audioCtx.destination)

      chunksRef.current = []
      processor.onaudioprocess = (e) => {
        const channelData = e.inputBuffer.getChannelData(0)
        chunksRef.current.push(new Float32Array(channelData))
        setLevel(rms(channelData))
      }

      audioCtxRef.current = audioCtx
      sourceRef.current = source
      processorRef.current = processor
      silentGainRef.current = silentGain
      setSampleRate(audioCtx.sampleRate)
      setSeconds(0)
      setPhase('recording')
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    } catch (err) {
      setPhase('error')
      const name = err instanceof DOMException ? err.name : ''
      setErrorMsg(
        name === 'NotAllowedError'
          ? 'Microphone access was denied. Allow mic access in your browser settings and try again.'
          : 'Could not start recording with the selected device.'
      )
    }
  }

  function handleStop() {
    const audioCtx = audioCtxRef.current
    const sr = audioCtx?.sampleRate ?? 48000
    const samples = concatFloat32(chunksRef.current)
    teardownAudioGraph()

    const blob = encodeWav(samples, sr)
    const url = URL.createObjectURL(blob)
    setPreviewUrl(url)
    setLevel(0)
    setPhase('recorded')
    onCaptured(blob, 'audio/wav', seconds)
  }

  function handleRerecord() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setSeconds(0)
    setPhase('ready')
    onReset()
  }

  const meetsMinimum = seconds >= MIN_DURATION_SEC

  return (
    <div className="pr-panel">
      <p className="pr-hint">Pick your audio interface or condenser mic, then record at least {MIN_DURATION_SEC} seconds in WAV.</p>

      {phase === 'idle' && (
        <button className="pr-btn pr-btn--main" onClick={handleDetectDevices}>
          🎚️ Detect Audio Devices
        </button>
      )}

      {phase === 'detecting' && <div className="pr-status">Detecting input devices…</div>}

      {(phase === 'ready' || phase === 'recording' || phase === 'recorded') && (
        <>
          <div className="pr-select-wrap">
            <select
              className="pr-select"
              value={selectedDeviceId}
              disabled={phase !== 'ready'}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Microphone ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
            <span className="pr-select-arrow">▾</span>
          </div>

          {phase === 'ready' && (
            <button className="pr-btn pr-btn--main" onClick={handleStart}>
              ⏺ Start Recording
            </button>
          )}

          {(phase === 'recording' || phase === 'recorded') && sampleRate && (
            <div className="pr-meta">Recording at {(sampleRate / 1000).toFixed(1)}kHz · WAV</div>
          )}

          {phase === 'recording' && (
            <>
              <div className="pr-meter-track">
                <div className="pr-meter-fill" style={{ width: `${Math.min(100, level * 140)}%`, background: levelColor(level) }} />
              </div>
              <div className={`pr-timer ${meetsMinimum ? 'pr-timer--ok' : ''}`}>
                {formatTime(seconds)} <span className="pr-timer-min">/ 0:{MIN_DURATION_SEC} minimum</span>
              </div>
              <button className="pr-btn pr-btn--stop" onClick={handleStop}>
                ⏹ Stop Recording
              </button>
            </>
          )}

          {phase === 'recorded' && previewUrl && (
            <>
              <audio className="pr-audio" src={previewUrl} controls />
              {!meetsMinimum && (
                <div className="pr-warn">Only {formatTime(seconds)} recorded — need at least 0:{MIN_DURATION_SEC} for a usable clone.</div>
              )}
              <button className="pr-btn pr-btn--outline" onClick={handleRerecord}>
                ↺ Re-record
              </button>
            </>
          )}
        </>
      )}

      {phase === 'error' && (
        <div className="pr-error">
          {errorMsg}
          <button className="pr-btn pr-btn--outline" onClick={handleDetectDevices} style={{ marginTop: 10 }}>
            Try Again
          </button>
        </div>
      )}

      <style suppressHydrationWarning>{`
        .pr-panel { display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
        .pr-hint { font-size: 12px; color: #5A5A80; max-width: 420px; margin: 0; }
        .pr-status { font-size: 13px; color: #8B5CF6; padding: 16px 0; }
        .pr-select-wrap { position: relative; width: 100%; max-width: 360px; }
        .pr-select {
          width: 100%; background: #0E0E20; border: 1px solid #1E1E3A; border-radius: 8px;
          padding: 9px 28px 9px 12px; font-size: 13px; color: #C4C4E0; outline: none;
          cursor: pointer; appearance: none; transition: border-color 0.2s;
        }
        .pr-select:focus { border-color: rgba(139,92,246,.5); }
        .pr-select:disabled { opacity: 0.6; cursor: not-allowed; }
        .pr-select-arrow { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); color: #5A5A80; pointer-events: none; font-size: 11px; }
        .pr-meta { font-size: 11px; color: #5A5A80; }
        .pr-meter-track { width: 100%; max-width: 360px; height: 10px; background: #0E0E20; border: 1px solid #1E1E3A; border-radius: 5px; overflow: hidden; }
        .pr-meter-fill { height: 100%; transition: width 0.08s linear, background 0.15s; }
        .pr-timer { font-family: var(--font-grotesk), 'Space Grotesk', sans-serif; font-size: 18px; font-weight: 700; color: #C4C4E0; }
        .pr-timer--ok { color: #10B981; }
        .pr-timer-min { font-size: 11px; font-weight: 400; color: #5A5A80; }
        .pr-audio { width: 100%; max-width: 420px; }
        .pr-warn { font-size: 12px; color: #F59E0B; max-width: 420px; }
        .pr-error { font-size: 13px; color: #F87171; max-width: 420px; }
        .pr-btn {
          padding: 11px 24px; border-radius: 8px; border: none;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .pr-btn--main { background: linear-gradient(135deg,#8B5CF6,#EC4899,#06B6D4); color: #fff; }
        .pr-btn--main:hover { box-shadow: 0 8px 24px rgba(139,92,246,.4); transform: translateY(-1px); }
        .pr-btn--stop { background: #EF4444; color: #fff; }
        .pr-btn--stop:hover { box-shadow: 0 8px 24px rgba(239,68,68,.4); }
        .pr-btn--outline { background: transparent; border: 1px solid #2A2A4A; color: #C4C4E0; }
        .pr-btn--outline:hover { border-color: #8B5CF6; color: #8B5CF6; }
      `}</style>
    </div>
  )
}
