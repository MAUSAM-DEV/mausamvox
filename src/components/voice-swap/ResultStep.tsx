'use client'

import { useEffect, useRef, useState } from 'react'
import { Mp3Encoder } from '@breezystack/lamejs'
import type { StemResult } from './UploadStep'

type AbSide = 'Original' | 'Swapped'
type PlayMode = 'full' | 'vocals'
// Full-song mix lifecycle: needs music stems → mixing → ready, or no-stems/error.
type FullMixState = 'mixing' | 'ready' | 'error' | 'no-stems'

interface ResultStepProps {
  onNewSwap: () => void
  // isFree reflects whether the regen window is still open. The page bills
  // (or blocks) accordingly; this component just reports which side of the
  // window the click landed on.
  onRegenerate: (isFree: boolean) => void
  onToast: (msg: string) => void
  convertedVocalsUrl: string | null
  stemResult: StemResult | null
  // Duet Mode 1: the singer that was NOT converted. When present, the swapped
  // full-song mix blends this unchanged stem alongside convertedVocalsUrl.
  duetUntouchedVocalsUrl?: string | null
  // Duet Mode 2/3: the second converted vocal (female singer). When present,
  // the swapped mix blends both converted stems (each at 1/√2 gain).
  convertedVocalsUrl2?: string | null
}

const SCORE_BARS = [
  { label: 'Voice Match', pct: 94 },
  { label: 'Pitch Accuracy', pct: 87 },
  { label: 'Naturalness', pct: 78 },
  { label: 'Emotion Transfer', pct: 71 },
]

const AB_SIDES: AbSide[] = ['Original', 'Swapped']
const PLAY_MODES: { id: PlayMode; label: string }[] = [
  { id: 'full', label: 'Full song' },
  { id: 'vocals', label: 'Vocals only' },
]

// ---------------------------------------------------------------------------
// WAV encoder — pure 16-bit PCM, no external dependencies
// ---------------------------------------------------------------------------
function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = Math.min(buffer.numberOfChannels, 2)
  const numFrames = buffer.length
  const sampleRate = buffer.sampleRate
  const dataLen = numFrames * numCh * 2
  const ab = new ArrayBuffer(44 + dataLen)
  const v = new DataView(ab)
  const s = (off: number, str: string) => { for (let i = 0; i < str.length; i++) v.setUint8(off + i, str.charCodeAt(i)) }

  s(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); s(8, 'WAVE')
  s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true)
  v.setUint16(22, numCh, true); v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * numCh * 2, true); v.setUint16(32, numCh * 2, true)
  v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, dataLen, true)

  let pos = 44
  for (let i = 0; i < numFrames; i++) {
    for (let c = 0; c < numCh; c++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]))
      v.setInt16(pos, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true)
      pos += 2
    }
  }
  return new Blob([ab], { type: 'audio/wav' })
}

// ---------------------------------------------------------------------------
// MP3 encoder — uses @breezystack/lamejs (maintained lamejs fork), 192 kbps
// ---------------------------------------------------------------------------
function encodeMp3(buffer: AudioBuffer): Blob {
  const numCh = Math.min(buffer.numberOfChannels, 2)
  const encoder = new Mp3Encoder(numCh, buffer.sampleRate, 192)
  const toInt16 = (ch: Float32Array): Int16Array => {
    const out = new Int16Array(ch.length)
    for (let i = 0; i < ch.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(ch[i] * 32768)))
    return out
  }
  const left = toInt16(buffer.getChannelData(0))
  const right = numCh > 1 ? toInt16(buffer.getChannelData(1)) : undefined
  const CHUNK = 1152
  const chunks: Uint8Array<ArrayBuffer>[] = []
  const push = (raw: Uint8Array) => {
    if (raw.length > 0) chunks.push(raw.slice() as Uint8Array<ArrayBuffer>)
  }
  for (let i = 0; i < left.length; i += CHUNK) {
    const l = left.subarray(i, i + CHUNK)
    push(right ? encoder.encodeBuffer(l, right.subarray(i, i + CHUNK)) : encoder.encodeBuffer(l))
  }
  push(encoder.flush())
  return new Blob(chunks, { type: 'audio/mpeg' })
}

// ---------------------------------------------------------------------------
// Browser mixing via OfflineAudioContext
// Returns a WAV Blob or null if mixing fails.
// Vocal gain uses equal-power law (1/√N) so two vocal channels at N=2 have
// the same perceived loudness as a single channel at N=1. musicGain: 0.8.
// ---------------------------------------------------------------------------
async function mixStems(
  vocalsUrls: string[],
  musicUrls: string[],
): Promise<Blob | null> {
  const decodeCtx = new AudioContext()

  async function fetchDecode(url: string): Promise<AudioBuffer | null> {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const ab = await res.arrayBuffer()
      return await decodeCtx.decodeAudioData(ab)
    } catch {
      return null
    }
  }

  const [vocalBufs, musicBufs] = await Promise.all([
    Promise.all(vocalsUrls.map(fetchDecode)),
    Promise.all(musicUrls.map(fetchDecode)),
  ])
  await decodeCtx.close()

  const validVocals = vocalBufs.filter((b): b is AudioBuffer => b !== null)
  if (validVocals.length === 0) return null
  const validMusic = musicBufs.filter((b): b is AudioBuffer => b !== null)

  const SAMPLE_RATE = 44100
  const duration = Math.max(
    ...validVocals.map((b) => b.duration),
    ...validMusic.map((b) => b.duration),
  )
  const numFrames = Math.ceil(duration * SAMPLE_RATE)

  const offline = new OfflineAudioContext(2, numFrames, SAMPLE_RATE)

  function addSource(buf: AudioBuffer, gain: number) {
    const gainNode = offline.createGain()
    gainNode.gain.value = gain
    gainNode.connect(offline.destination)
    const src = offline.createBufferSource()
    src.buffer = buf
    src.connect(gainNode)
    src.start(0)
  }

  // 1/√N per vocal channel: keeps perceived loudness flat as N increases.
  const vocalGain = 1 / Math.sqrt(validVocals.length)
  for (const buf of validVocals) addSource(buf, vocalGain)
  for (const buf of validMusic) addSource(buf, 0.8)

  const rendered = await offline.startRendering()
  return encodeWav(rendered)
}

// ---------------------------------------------------------------------------
// Waveform canvas
// ---------------------------------------------------------------------------
function PlayerWaveCanvas({ playing }: { playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef(0)
  const tRef = useRef(0)
  const playingRef = useRef(playing)

  useEffect(() => { playingRef.current = playing }, [playing])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function resize() {
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.offsetWidth * dpr
      canvas.height = canvas.offsetHeight * dpr
      ctx!.scale(dpr, dpr)
    }
    resize()

    const layers = [
      { a: 0.30, f: 0.013, s: 0.032, c: 'rgba(139,92,246,.9)', lw: 1.8 },
      { a: 0.16, f: 0.024, s: 0.058, c: 'rgba(236,72,153,.5)', lw: 1.3 },
      { a: 0.09, f: 0.038, s: 0.085, c: 'rgba(6,182,212,.3)',  lw: 1.0 },
    ]

    function frame() {
      if (!canvas || !ctx) return
      const W = canvas.offsetWidth, H = canvas.offsetHeight
      ctx.clearRect(0, 0, W, H)
      layers.forEach((l) => {
        ctx.beginPath()
        ctx.lineWidth = l.lw
        ctx.strokeStyle = l.c
        ctx.shadowColor = l.c
        ctx.shadowBlur = 7
        for (let x = 0; x <= W; x += 1.5) {
          const y =
            H / 2 +
            Math.sin(x * l.f + tRef.current * l.s) * H * l.a +
            Math.sin(x * l.f * 2.2 + tRef.current * l.s * 1.6) * H * l.a * 0.32 +
            Math.sin(x * 0.09 + tRef.current * 2.2) * 2 * 0.45
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.shadowBlur = 0
      })
      if (playingRef.current) tRef.current += 0.042
      rafRef.current = requestAnimationFrame(frame)
    }
    frame()
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '66px' }} />
}

// ---------------------------------------------------------------------------
// Score ring (unchanged from before)
// ---------------------------------------------------------------------------
function ScoreRing({ score }: { score: number }) {
  const r = 28, cx = 34, circ = 2 * Math.PI * r
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" style={{ flexShrink: 0 }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#1E1E3A" strokeWidth="5" />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="url(#rg)" strokeWidth="5"
        strokeLinecap="round" strokeDasharray={circ}
        strokeDashoffset={circ * (1 - score / 100)}
        transform={`rotate(-90 ${cx} ${cx})`}
        style={{ transition: 'stroke-dashoffset 1s ease' }}
      />
      <defs>
        <linearGradient id="rg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="50%" stopColor="#EC4899" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <text x={cx} y={cx + 5} textAnchor="middle" fill="#F0F0FF" fontSize="14"
        fontWeight="700" fontFamily="var(--font-grotesk), 'Space Grotesk', sans-serif">
        {score}
      </text>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// ResultStep
// ---------------------------------------------------------------------------
export function ResultStep({
  onNewSwap, onRegenerate, onToast,
  convertedVocalsUrl, convertedVocalsUrl2, stemResult, duetUntouchedVocalsUrl,
}: ResultStepProps) {
  const [barsAnimated, setBarsAnimated] = useState(false)
  const [regenCountdown, setRegenCountdown] = useState(600)

  // Player controls (owned here — no fake timer in the parent anymore)
  const [ab, setAb] = useState<AbSide>('Swapped')
  const [mode, setMode] = useState<PlayMode>('full')

  // Full-song mixes (built in the browser). Both sides share the same music bed.
  const [fullMixState, setFullMixState] = useState<FullMixState>('mixing')
  const [mixedOriginalUrl, setMixedOriginalUrl] = useState<string | null>(null)
  const [mixedSwappedUrl, setMixedSwappedUrl] = useState<string | null>(null)
  const mixedOriginalRef = useRef<string | null>(null) // object URLs to revoke
  const mixedSwappedRef = useRef<string | null>(null)
  // Vocals-only blend for duet modes (no music stems). Null in standard mode;
  // srcFor falls back to convertedVocalsUrl when null.
  const [mixedSwappedVocalsUrl, setMixedSwappedVocalsUrl] = useState<string | null>(null)
  const mixedSwappedVocalsRef = useRef<string | null>(null)

  const [mp3Encoding, setMp3Encoding] = useState(false)

  // Real playback state — driven only by the <audio> element's events
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0) // 0..1
  const [duration, setDuration] = useState(0) // seconds
  const [currentTime, setCurrentTime] = useState(0) // seconds
  const [audioError, setAudioError] = useState(false)

  const audioRef = useRef<HTMLAudioElement>(null)
  // Carried across a source swap so play position / state survive the toggle.
  const pendingSeekRef = useRef(0)
  const pendingPlayRef = useRef(false)
  const seekingRef = useRef(false)

  // Animate score bars on mount
  useEffect(() => {
    const t = setTimeout(() => setBarsAnimated(true), 300)
    return () => clearTimeout(t)
  }, [])

  // Regen countdown
  useEffect(() => {
    const id = setInterval(() => setRegenCountdown((n) => Math.max(0, n - 1)), 1000)
    return () => clearInterval(id)
  }, [])

  // Build BOTH full-song mixes in parallel as soon as the URLs are ready.
  useEffect(() => {
    if (!convertedVocalsUrl || !stemResult?.vocalsUrl) return

    // Collect non-empty music stem URLs (the shared instrumental bed)
    const musicUrls = [
      stemResult.instrumentalUrl,
      stemResult.bassUrl,
      stemResult.drumsUrl,
      stemResult.otherUrl,
    ].filter((u): u is string => Boolean(u))

    if (musicUrls.length === 0) {
      // No music stems — Full song mode is impossible. Force vocals-only.
      setFullMixState('no-stems')
      setMode('vocals')
      return
    }

    // Swapped mix vocal channels — varies by mode:
    //  Mode 1: [converted singer, untouched partner]
    //  Mode 2/3: [converted male, converted female]
    //  Standard: [converted vocal]
    // vocalGain auto-scales via 1/√N in mixStems; no extra work needed here.
    const swapVocalUrls = [
      convertedVocalsUrl,
      ...(duetUntouchedVocalsUrl ? [duetUntouchedVocalsUrl] : []),
      ...(convertedVocalsUrl2 ? [convertedVocalsUrl2] : []),
    ]

    let cancelled = false
    setFullMixState('mixing')
    Promise.all([
      mixStems([stemResult.leadVocalsUrl || stemResult.vocalsUrl], musicUrls),
      mixStems(swapVocalUrls, musicUrls),
    ])
      .then(([origBlob, swapBlob]) => {
        if (cancelled) return
        if (!origBlob || !swapBlob) {
          setFullMixState('error')
          return
        }
        const origUrl = URL.createObjectURL(origBlob)
        const swapUrl = URL.createObjectURL(swapBlob)
        mixedOriginalRef.current = origUrl
        mixedSwappedRef.current = swapUrl
        setMixedOriginalUrl(origUrl)
        setMixedSwappedUrl(swapUrl)
        setFullMixState('ready')
      })
      .catch(() => {
        if (!cancelled) setFullMixState('error')
      })

    return () => { cancelled = true }
  }, [convertedVocalsUrl, stemResult?.vocalsUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Vocals-only blend for duet modes: mixes the N swapped/untouched vocal
  // channels with no music so the Vocals-only tab hears all singers.
  // Standard (single-vocal) swaps skip this — srcFor falls back to
  // convertedVocalsUrl directly, so there's no regression.
  useEffect(() => {
    const swapVocalUrls = [
      convertedVocalsUrl,
      ...(duetUntouchedVocalsUrl ? [duetUntouchedVocalsUrl] : []),
      ...(convertedVocalsUrl2 ? [convertedVocalsUrl2] : []),
    ].filter(Boolean) as string[]

    if (swapVocalUrls.length <= 1) {
      setMixedSwappedVocalsUrl(null)
      return
    }

    let cancelled = false
    mixStems(swapVocalUrls, []).then((blob) => {
      if (cancelled || !blob) return
      if (mixedSwappedVocalsRef.current) URL.revokeObjectURL(mixedSwappedVocalsRef.current)
      const url = URL.createObjectURL(blob)
      mixedSwappedVocalsRef.current = url
      setMixedSwappedVocalsUrl(url)
    }).catch(() => {})

    return () => { cancelled = true }
  }, [convertedVocalsUrl, convertedVocalsUrl2, duetUntouchedVocalsUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Revoke all three blob URLs on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      if (mixedOriginalRef.current) URL.revokeObjectURL(mixedOriginalRef.current)
      if (mixedSwappedRef.current) URL.revokeObjectURL(mixedSwappedRef.current)
      if (mixedSwappedVocalsRef.current) URL.revokeObjectURL(mixedSwappedVocalsRef.current)
    }
  }, [])

  // The active source for the current (mode, side) selection.
  const fullReady = fullMixState === 'ready'
  function srcFor(m: PlayMode, side: AbSide): string | null {
    if (m === 'vocals') {
      if (side === 'Original') return (stemResult?.leadVocalsUrl || stemResult?.vocalsUrl) ?? null
      // Swapped: prefer the pre-mixed duet blend (Mode 1/2/3); fall back to
      // the single converted vocal for standard (non-duet) swaps.
      return mixedSwappedVocalsUrl ?? convertedVocalsUrl
    }
    return side === 'Original' ? mixedOriginalUrl : mixedSwappedUrl
  }
  const activeUrl = srcFor(mode, ab)

  const mins = Math.floor(regenCountdown / 60)
  const secs = String(regenCountdown % 60).padStart(2, '0')

  // Capture position + play state right before a source swap so we can restore.
  function captureForSwap() {
    const audio = audioRef.current
    pendingSeekRef.current = audio ? audio.currentTime : 0
    pendingPlayRef.current = audio ? !audio.paused : playing
    seekingRef.current = true
    setAudioError(false)
  }

  function handleSelectSide(side: AbSide) {
    if (side === ab) return
    captureForSwap()
    setAb(side)
  }

  function handleSelectMode(m: PlayMode) {
    if (m === mode) return
    if (m === 'full' && !fullReady) return // disabled until the mix is ready
    captureForSwap()
    setMode(m)
  }

  function handleTogglePlay() {
    const audio = audioRef.current
    if (!audio || !activeUrl) return
    if (audio.paused) audio.play().catch(() => setAudioError(true))
    else audio.pause()
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = pct * audio.duration
  }

  // Restore position + resume after a freshly-swapped source reports its length.
  function handleLoadedMetadata() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.duration && isFinite(audio.duration)) setDuration(audio.duration)
    if (seekingRef.current) {
      audio.currentTime = Math.min(pendingSeekRef.current, audio.duration || 0)
      if (pendingPlayRef.current) audio.play().catch(() => setAudioError(true))
      seekingRef.current = false
    }
  }

  function handleTimeUpdate() {
    const audio = audioRef.current
    if (!audio) return
    // Ignore the reset-to-0 tick that fires during a source swap.
    if (seekingRef.current) return
    setCurrentTime(audio.currentTime)
    setProgress(audio.duration ? audio.currentTime / audio.duration : 0)
  }

  function handleDownload() {
    if (!activeUrl) { onToast('Nothing to download yet'); return }
    const isMixed = mode === 'full'
    const a = document.createElement('a')
    a.href = activeUrl
    a.download = isMixed
      ? `voice-swap-${ab.toLowerCase()}-mix.wav`
      : `voice-swap-${ab.toLowerCase()}-vocals.mp3`
    a.rel = 'noreferrer'
    a.click()
    onToast(isMixed ? `Downloading ${ab} mix (WAV)…` : `Downloading ${ab} vocals…`)
  }

  async function handleDownloadMp3() {
    const srcUrl = mode === 'full' ? mixedSwappedUrl : (mixedSwappedVocalsUrl ?? convertedVocalsUrl)
    if (!srcUrl) { onToast('Nothing to download yet'); return }
    setMp3Encoding(true)
    onToast('Encoding MP3…')
    try {
      const res = await fetch(srcUrl)
      if (!res.ok) throw new Error('fetch failed')
      const arrBuf = await res.arrayBuffer()
      const ctx = new AudioContext()
      const decoded = await ctx.decodeAudioData(arrBuf)
      await ctx.close()
      const blob = encodeMp3(decoded)
      const mp3Url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = mp3Url
      anchor.download = mode === 'full'
        ? `voice-swap-${ab.toLowerCase()}-mix.mp3`
        : `voice-swap-${ab.toLowerCase()}-vocals.mp3`
      anchor.click()
      URL.revokeObjectURL(mp3Url)
      onToast('MP3 downloaded!')
    } catch (err) {
      console.error('[mp3-encode] failed:', err)
      onToast('MP3 encoding failed — download the WAV instead')
    } finally {
      setMp3Encoding(false)
    }
  }

  function fmt(t: number) {
    const s = Math.max(0, Math.round(t))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  // Full-song mix is still rendering and the user is sitting in Full mode.
  const fullMixing = mode === 'full' && fullMixState === 'mixing'

  return (
    <>
      {/* Real audio element — the single source of truth for playback.
          src switches with the (mode, side) selection; events drive all UI. */}
      {activeUrl && (
        <audio
          ref={audioRef}
          src={activeUrl}
          preload="metadata"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            // Rewind the element too, so a toggle right after a track ends
            // captures position 0 — not the stale end-of-clip time.
            if (audioRef.current) audioRef.current.currentTime = 0
            setPlaying(false); setProgress(0); setCurrentTime(0)
          }}
          onError={() => setAudioError(true)}
        />
      )}

      <div className="vs-panel">
        {/* Score row */}
        <div className="vs-result-top">
          <ScoreRing score={82} />
          <div>
            <div className="vs-result-score-lbl">Quality Score</div>
            <div className="grad-text" style={{ fontFamily: 'var(--font-grotesk),"Space Grotesk",sans-serif', fontSize: '36px', fontWeight: 700, letterSpacing: '-1px', lineHeight: 1 }}>
              82<span style={{ fontSize: '14px', fontWeight: 400, color: '#5A5A80', letterSpacing: 0, marginLeft: '6px', background: 'none', WebkitTextFillColor: '#5A5A80' }}> / 100</span>
            </div>
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
              {['✓ Ready to download', fullReady ? '✓ Full mix included' : '✓ High fidelity'].map((c) => (
                <span key={c} className="vs-result-chip">{c}</span>
              ))}
            </div>
          </div>
        </div>

        {/* Score bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', margin: '20px 0' }}>
          {SCORE_BARS.map((bar, i) => (
            <div key={bar.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#7878A0', marginBottom: '5px' }}>
                <span>{bar.label}</span><span>{bar.pct}%</span>
              </div>
              <div style={{ height: '5px', background: '#1E1E3A', borderRadius: '3px', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: '3px', background: 'linear-gradient(135deg,#8B5CF6,#EC4899,#06B6D4)', width: barsAnimated ? `${bar.pct}%` : '0%', transition: `width 1.4s ease ${i * 150}ms` }} />
              </div>
            </div>
          ))}
        </div>

        {/* Player */}
        <div className="vs-player">
          {/* Two controls: A/B side toggle + Full song / Vocals only mode */}
          <div className="vs-player-tabs">
            <div className="vs-toggle-group">
              {AB_SIDES.map((s) => (
                <button
                  key={s}
                  className={`vs-ptab ${ab === s ? 'vs-ptab--active' : ''}`}
                  onClick={() => handleSelectSide(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="vs-toggle-spacer" />
            <div className="vs-toggle-group">
              {PLAY_MODES.map((m) => {
                const disabled = m.id === 'full' && !fullReady
                return (
                  <button
                    key={m.id}
                    className={`vs-ptab ${mode === m.id ? 'vs-ptab--active' : ''}`}
                    onClick={() => handleSelectMode(m.id)}
                    disabled={disabled}
                    title={
                      disabled
                        ? fullMixState === 'no-stems'
                          ? 'No music stems available for this track'
                          : fullMixState === 'error'
                            ? 'Full-song mix failed'
                            : 'Preparing full-song mix…'
                        : undefined
                    }
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          {fullMixing ? (
            /* ---- Full-song mix still rendering (vocals-only stays usable) ---- */
            <div className="vs-mixing-banner">
              <div className="vs-mixing-ring" />
              <div>
                <div className="vs-mixing-title">Mixing your full song…</div>
                <div className="vs-mixing-sub">Blending vocals with music stems in your browser. Switch to “Vocals only” to listen now.</div>
              </div>
            </div>
          ) : (
            <>
              {fullMixState === 'no-stems' && (
                <div className="vs-mix-note">
                  ⚠ No music stems found — full-song mix unavailable. Playing vocals only.
                </div>
              )}
              {fullMixState === 'error' && mode === 'vocals' && (
                <div className="vs-mix-note vs-mix-note--err">
                  Full-song mix failed — some stem URLs may have expired. Vocals-only still works.
                </div>
              )}
              {audioError && (
                <div className="vs-mix-note vs-mix-note--err">
                  Couldn’t load this audio — the source may be missing or its link expired.
                </div>
              )}
              {!activeUrl ? (
                <div className="vs-mix-note vs-mix-note--err">
                  No audio available for {ab} / {mode === 'full' ? 'Full song' : 'Vocals only'}.
                </div>
              ) : (
                <>
                  <div className="vs-wave-container">
                    <PlayerWaveCanvas playing={playing} />
                    <div className="vs-seek-overlay" onClick={handleSeek} />
                    <div className="vs-playhead" style={{ left: `${progress * 100}%` }} />
                  </div>
                  <div className="vs-player-controls">
                    <span className="vs-time">{fmt(currentTime)}</span>
                    <button className="vs-play-btn" onClick={handleTogglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                      {playing ? '⏸' : '▶'}
                    </button>
                    <span className="vs-time">{duration ? fmt(duration) : '—:—'}</span>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Regen row */}
        <div className="vs-regen-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#5A5A80' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M4 4v5h5M20 20v-5h-5" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" />
              <path d="M20 9A8 8 0 0 0 5.66 5.66M4 15a8 8 0 0 0 14.34 3.34" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {regenCountdown > 0 ? (
              <>
                <strong style={{ color: '#8B5CF6' }}>Free regen</strong> available for
                <span className="grad-text" style={{ fontWeight: 700 }}>{mins}:{secs}</span>
              </>
            ) : (
              <>Free window ended · regen now costs <strong style={{ color: '#8B5CF6' }}>200 cr</strong></>
            )}
          </div>
          <button className="vs-regen-btn" onClick={() => onRegenerate(regenCountdown > 0)}>↺ Regenerate</button>
        </div>

        {/* Download / Share */}
        <div className="vs-dl-row">
          <button
            className="vs-dl-btn vs-dl-btn--primary"
            onClick={handleDownload}
            disabled={fullMixing || !activeUrl}
          >
            {fullMixing
              ? '⏳ Mixing…'
              : mode === 'full'
                ? `↓ ${ab} Mix (WAV)`
                : `↓ ${ab} Vocals`}
          </button>
          <button
            className="vs-dl-btn vs-dl-btn--outline"
            onClick={handleDownloadMp3}
            disabled={fullMixing || !activeUrl || mp3Encoding}
            title="Encode and download as 192 kbps MP3"
          >
            {mp3Encoding ? '⏳ Encoding…' : `↓ MP3`}
          </button>
          <button
            className="vs-dl-btn vs-dl-btn--outline vs-dl-btn--soon"
            disabled
            title="Shareable links coming soon for Pro"
          >
            ⬆ Share<span className="vs-soon-badge">Soon · Pro</span>
          </button>
          <button className="vs-dl-btn vs-dl-btn--outline" onClick={onNewSwap}>+ New Swap</button>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .vs-result-top { display: flex; align-items: center; gap: 20px; }
        .vs-result-score-lbl {
          font-size: 10px; font-weight: 700; letter-spacing: 2px;
          text-transform: uppercase; color: #5A5A80; margin-bottom: 4px;
        }
        .vs-result-chip {
          padding: 3px 10px; border-radius: 999px;
          background: rgba(16,185,129,.08); border: 1px solid rgba(16,185,129,.2);
          font-size: 11px; font-weight: 600; color: #10B981;
        }
        .vs-player {
          background: #0E0E20; border: 1px solid #1E1E3A;
          border-radius: 12px; overflow: hidden; margin-bottom: 14px;
        }
        .vs-player-tabs { display: flex; align-items: center; border-bottom: 1px solid #1E1E3A; padding: 0 4px; }
        .vs-toggle-group { display: flex; }
        .vs-toggle-spacer { flex: 1; }
        .vs-ptab {
          padding: 8px 14px; border: none; background: transparent;
          font-size: 11px; font-weight: 500; color: #5A5A80;
          cursor: pointer; transition: all 0.2s; position: relative;
        }
        .vs-ptab:hover:not(:disabled) { color: #F0F0FF; }
        .vs-ptab:disabled { color: #3A3A55; cursor: not-allowed; }
        .vs-ptab--active { color: #F0F0FF; font-weight: 600; }
        .vs-ptab--active::after {
          content: ''; position: absolute; bottom: 0; left: 4px; right: 4px;
          height: 2px; background: linear-gradient(135deg,#8B5CF6,#EC4899,#06B6D4);
          border-radius: 2px 2px 0 0;
        }

        /* Mixing banner */
        .vs-mixing-banner {
          display: flex; align-items: center; gap: 16px;
          padding: 28px 20px; min-height: 102px;
        }
        .vs-mixing-ring {
          width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0;
          border: 3px solid transparent;
          border-top-color: #8B5CF6;
          border-right-color: #EC4899;
          animation: vs-spin 0.8s linear infinite;
        }
        @keyframes vs-spin { to { transform: rotate(360deg); } }
        .vs-mixing-title {
          font-size: 14px; font-weight: 600; color: #C4C4E0; margin-bottom: 3px;
        }
        .vs-mixing-sub { font-size: 11px; color: #5A5A80; line-height: 1.5; }

        /* Mix note (fallback/error) */
        .vs-mix-note {
          font-size: 11px; color: #F59E0B; background: rgba(245,158,11,.06);
          border-bottom: 1px solid rgba(245,158,11,.15); padding: 8px 14px;
        }
        .vs-mix-note--err { color: #F87171; background: rgba(248,113,113,.06); border-bottom-color: rgba(248,113,113,.15); }

        .vs-wave-container { position: relative; cursor: pointer; }
        .vs-seek-overlay { position: absolute; inset: 0; z-index: 2; }
        .vs-playhead {
          position: absolute; top: 0; bottom: 0; width: 1.5px;
          background: rgba(255,255,255,.7); pointer-events: none;
          z-index: 3; transition: left 0.1s linear;
        }
        .vs-player-controls {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 14px; border-top: 1px solid #1E1E3A;
        }
        .vs-time { font-size: 11px; color: #5A5A80; font-variant-numeric: tabular-nums; }
        .vs-play-btn {
          width: 32px; height: 32px; border-radius: 50%; border: none;
          background: linear-gradient(135deg,#8B5CF6,#EC4899);
          color: #fff; font-size: 12px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s; box-shadow: 0 4px 12px rgba(139,92,246,.4);
        }
        .vs-play-btn:hover { transform: scale(1.1); box-shadow: 0 6px 18px rgba(139,92,246,.5); }
        .vs-regen-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px; background: #0E0E20; border: 1px solid #1E1E3A;
          border-radius: 10px; margin-bottom: 14px;
        }
        .vs-regen-btn {
          padding: 5px 14px; border-radius: 6px;
          border: 1px solid rgba(139,92,246,.3); background: rgba(139,92,246,.08);
          color: #8B5CF6; font-size: 12px; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
        }
        .vs-regen-btn:hover { background: rgba(139,92,246,.16); }
        .vs-dl-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .vs-dl-btn {
          padding: 10px 20px; border-radius: 8px;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.25s;
        }
        .vs-dl-btn--primary {
          background: linear-gradient(135deg,#8B5CF6,#EC4899,#06B6D4);
          border: none; color: #fff; flex: 1; min-width: 120px;
        }
        .vs-dl-btn--primary:hover:not(:disabled) { box-shadow: 0 8px 24px rgba(139,92,246,.4); transform: translateY(-1px); }
        .vs-dl-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .vs-dl-btn--outline {
          background: transparent; border: 1px solid #2A2A4A; color: #C4C4E0;
        }
        .vs-dl-btn--outline:hover { border-color: #8B5CF6; color: #8B5CF6; }
        /* Share is not live yet — dimmed, non-interactive, honestly labelled. */
        .vs-dl-btn--soon {
          display: inline-flex; align-items: center; gap: 7px;
          opacity: 0.45; cursor: not-allowed;
        }
        .vs-dl-btn--soon:hover { border-color: #2A2A4A; color: #C4C4E0; }
        .vs-soon-badge {
          font-size: 9px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase;
          padding: 2px 6px; border-radius: 999px;
          background: rgba(139,92,246,.15); color: #A78BFA; border: 1px solid rgba(139,92,246,.3);
        }
      `}</style>
    </>
  )
}
