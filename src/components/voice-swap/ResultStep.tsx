'use client'

import { useEffect, useRef, useState } from 'react'
import type { StemResult } from './UploadStep'
import { encodeWav, encodeMp3 } from './audioClip'

type AbSide = 'Original' | 'Swapped'
type PlayMode = 'full' | 'vocals'
// Full-song mix lifecycle: needs music stems → mixing → ready, or no-stems/error.
type FullMixState = 'mixing' | 'ready' | 'error' | 'no-stems'

interface ResultStepProps {
  onNewSwap: () => void
  // Each regenerate steps index_rate up for a progressively stronger voice
  // match and always charges credits. The page owns the per-track cap (max 2
  // regenerates / 3 total takes); this component just disables the button and
  // shows the cap message when regenCapReached is set.
  onRegenerate: () => void
  // True once the per-track regenerate cap is hit — disables the button.
  regenCapReached: boolean
  onToast: (msg: string) => void
  // Fine-tune panel: render a short 12 s preview with the given RVC params,
  // starting at an optional offset (seconds) so the user can skip music-only
  // intros (resolves to the converted vocal URL, or null on failure), and commit
  // a chosen take to a full-song render.
  onTunedPreview: (p: TuneParams, startSeconds?: number) => Promise<string | null>
  onApplyToFull: (p: TuneParams) => void
  convertedVocalsUrl: string | null
  stemResult: StemResult | null
  // Duet Mode 1: the singer that was NOT converted. When present, the swapped
  // full-song mix blends this unchanged stem alongside convertedVocalsUrl.
  duetUntouchedVocalsUrl?: string | null
  // Duet Mode 2/3: the second converted vocal (female singer). When present,
  // the swapped mix blends both converted stems (each at 1/√2 gain).
  convertedVocalsUrl2?: string | null
  // When true (a full swap, not a preview), upload the built full-song mix and
  // report its storage path via onFullMixReady so Recent Swaps saves the FULL
  // track. A null path means the mix/upload failed → caller persists the vocal.
  persistMix?: boolean
  onFullMixReady?: (mixedPath: string | null) => void
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
// Browser mixing via OfflineAudioContext
// Returns a WAV Blob or null if mixing fails.
// Vocal gain uses equal-power law (1/√N) so two vocal channels at N=2 have
// the same perceived loudness as a single channel at N=1. musicGain: 0.8.
// ---------------------------------------------------------------------------
// Encode a WAV mix (object URL) to MP3 and upload it to audio-uploads via the
// same presign → PUT flow the Fine-tune preview uses (bypasses Vercel's body
// limit — a full-song mix is large). Returns the storage path, or null on any
// failure so the caller can fall back to persisting the vocal-only result.
async function uploadFullMixMp3(wavMixUrl: string): Promise<string | null> {
  try {
    const res = await fetch(wavMixUrl)
    if (!res.ok) return null
    const ctx = new AudioContext()
    const decoded = await ctx.decodeAudioData(await res.arrayBuffer())
    await ctx.close()
    const mp3 = encodeMp3(decoded)

    const presignRes = await fetch('/api/upload-stem/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'swap-full-mix.mp3', contentType: 'audio/mpeg' }),
    })
    const presign = await presignRes.json()
    if (!presignRes.ok) return null

    const putRes = await fetch(presign.uploadUrl, {
      method: 'PUT',
      body: mp3,
      headers: { 'Content-Type': 'audio/mpeg', 'x-upsert': 'false' },
    })
    if (!putRes.ok) return null

    return presign.path as string
  } catch {
    return null
  }
}

// Warmth EQ: a gentle low-shelf applied to the CONVERTED VOCAL only (the music
// bed is never coloured). warmth 0..100 maps to 0..WARMTH_MAX_DB of low-shelf
// gain at WARMTH_FREQ_HZ. At warmth 0 NO filter is inserted at all, so the mix
// graph is byte-identical to before this control existed.
const WARMTH_FREQ_HZ = 200
const WARMTH_MAX_DB = 6

async function mixStems(
  vocalsUrls: string[],
  musicUrls: string[],
  opts?: { warmth?: number },
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

  // Low-shelf gain (dB) for the vocal path; 0 at default warmth → no filter.
  const warmthDb = opts?.warmth
    ? (Math.min(100, Math.max(0, opts.warmth)) / 100) * WARMTH_MAX_DB
    : 0

  function addSource(buf: AudioBuffer, gain: number, warm = false) {
    const gainNode = offline.createGain()
    gainNode.gain.value = gain
    const src = offline.createBufferSource()
    src.buffer = buf
    src.connect(gainNode)
    // Insert the warmth low-shelf ONLY on the vocal path and ONLY when warmth>0,
    // so the instrumental is never coloured and warmth 0 == today's exact graph.
    if (warm && warmthDb > 0) {
      const eq = offline.createBiquadFilter()
      eq.type = 'lowshelf'
      eq.frequency.value = WARMTH_FREQ_HZ
      eq.gain.value = warmthDb
      gainNode.connect(eq)
      eq.connect(offline.destination)
    } else {
      gainNode.connect(offline.destination)
    }
    src.start(0)
  }

  // 1/√N per vocal channel: keeps perceived loudness flat as N increases.
  const vocalGain = 1 / Math.sqrt(validVocals.length)
  for (const buf of validVocals) addSource(buf, vocalGain, true) // vocal: warmth-eligible
  for (const buf of validMusic) addSource(buf, 0.8)              // music: never warmed

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
// Fine-tune panel — adjust RVC params, render a short 12 s preview, A/B compare
// ---------------------------------------------------------------------------
export interface TuneParams {
  indexRate: number
  protect: number
  filterRadius: number
  rmsMixRate: number
}

// Seeded from the same defaults voice-convert applies, so the first preview
// reproduces the committed take before the user moves anything.
const TUNE_DEFAULTS: TuneParams = { indexRate: 0.8, protect: 0.2, filterRadius: 4, rmsMixRate: 0.25 }

const TUNE_SLIDERS: {
  key: keyof TuneParams; label: string; hint: string
  min: number; max: number; step: number; fmt: (n: number) => string
}[] = [
  { key: 'indexRate',    label: 'Voice strength',          hint: 'index_rate',    min: 0, max: 1,   step: 0.05, fmt: (n) => n.toFixed(2) },
  { key: 'protect',      label: 'Breath / consonant guard', hint: 'protect',       min: 0, max: 0.5, step: 0.05, fmt: (n) => n.toFixed(2) },
  { key: 'filterRadius', label: 'Smoothing',               hint: 'filter_radius', min: 0, max: 7,   step: 1,    fmt: (n) => String(n) },
  { key: 'rmsMixRate',   label: 'Volume envelope',         hint: 'rms_mix_rate',  min: 0, max: 1,   step: 0.05, fmt: (n) => n.toFixed(2) },
]

interface Take { id: number; params: TuneParams; url: string }

// Clip length the preview renders — mirrors PREVIEW_CLIP_SECONDS in
// VoiceSwapPage (kept local to avoid a circular import). Only used here to bound
// the start-point control; the real window is clamped server-side in trimAudioToClip.
const FINE_TUNE_CLIP_SECONDS = 12

// Format a number of seconds as m:ss for the start-point label.
const fmtMSS = (s: number) => {
  const t = Math.max(0, Math.floor(s))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

function FineTunePanel({
  onTunedPreview, onApplyToFull, onToast, durationSeconds,
}: {
  onTunedPreview: (p: TuneParams, startSeconds?: number) => Promise<string | null>
  onApplyToFull: (p: TuneParams) => void
  onToast: (msg: string) => void
  // Source song length (seconds) — bounds the start-point control. 0 until the
  // main player has loaded metadata, or when unknown.
  durationSeconds: number
}) {
  const [open, setOpen] = useState(false)
  const [params, setParams] = useState<TuneParams>(TUNE_DEFAULTS)
  const [startSeconds, setStartSeconds] = useState(0)
  const [prevTake, setPrevTake] = useState<Take | null>(null)
  const [curTake, setCurTake] = useState<Take | null>(null)
  const [ab, setAb] = useState<'A' | 'B'>('B')
  const [busy, setBusy] = useState(false)
  const takeIdRef = useRef(0)

  // Latest valid start point: 0..(duration − clip). When the song is shorter than
  // one clip (or duration unknown), there's no room to move the start.
  const maxStart = Math.max(0, Math.floor(durationSeconds) - FINE_TUNE_CLIP_SECONDS)
  const startDisabled = busy || maxStart <= 0
  const clampedStart = Math.min(startSeconds, maxStart)

  // Mini player — vocals-only, 12 s, independent of the main full-song player.
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  const selected = ab === 'A' ? prevTake : curTake
  const selectedUrl = selected?.url ?? null

  async function handlePreview() {
    if (busy) return
    setBusy(true)
    onToast('Rendering 12-sec preview…')
    const url = await onTunedPreview(params, clampedStart)
    setBusy(false)
    if (!url) return // failure already toasted upstream
    const take: Take = { id: ++takeIdRef.current, params: { ...params }, url }
    setPrevTake(curTake) // current take slides into the A slot
    setCurTake(take)
    setAb('B')
    onToast('Preview ready — compare A / B')
  }

  function handleTogglePlay() {
    const a = audioRef.current
    if (!a || !selectedUrl) return
    if (a.paused) a.play().catch(() => {})
    else a.pause()
  }

  const setParam = (key: keyof TuneParams, value: number) =>
    setParams((p) => ({ ...p, [key]: value }))

  // Reset every slider back to the seeded defaults in one click. Sliders only —
  // does not touch takes, A/B, or the player.
  const atDefaults = (Object.keys(TUNE_DEFAULTS) as (keyof TuneParams)[])
    .every((k) => params[k] === TUNE_DEFAULTS[k])
  const handleReset = () => setParams({ ...TUNE_DEFAULTS })

  return (
    <div className="vs-tune">
      <button className="vs-tune-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="vs-tune-head-title">⚙ Fine-tune voice <span className="vs-tune-adv">Advanced</span></span>
        <span className="vs-tune-chev">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="vs-tune-body">
          {/* Preview start point — skip music-only intros, audition any 12 s window. */}
          <div className="vs-tune-row">
            <div className="vs-tune-rowtop">
              <span className="vs-tune-label">Preview start <span className="vs-tune-hint">m:ss</span></span>
              <span className="vs-tune-val">
                {startDisabled && maxStart <= 0
                  ? '0:00 (full clip)'
                  : `${fmtMSS(clampedStart)} – ${fmtMSS(clampedStart + FINE_TUNE_CLIP_SECONDS)}`}
              </span>
            </div>
            <input
              type="range"
              className="vs-tune-slider"
              min={0} max={Math.max(maxStart, 1)} step={1}
              value={clampedStart}
              disabled={startDisabled}
              onChange={(e) => setStartSeconds(Number(e.target.value))}
            />
          </div>

          {TUNE_SLIDERS.map((s) => (
            <div key={s.key} className="vs-tune-row">
              <div className="vs-tune-rowtop">
                <span className="vs-tune-label">{s.label} <span className="vs-tune-hint">{s.hint}</span></span>
                <span className="vs-tune-val">{s.fmt(params[s.key])}</span>
              </div>
              <input
                type="range"
                className="vs-tune-slider"
                min={s.min} max={s.max} step={s.step}
                value={params[s.key]}
                disabled={busy}
                onChange={(e) => setParam(s.key, Number(e.target.value))}
              />
            </div>
          ))}

          <div className="vs-tune-actions">
            <button className="vs-tune-preview-btn" onClick={handlePreview} disabled={busy}>
              {busy ? '⏳ Rendering…' : '▶ Preview 12 sec'}
            </button>
            <button
              type="button"
              className="vs-tune-reset-btn"
              onClick={handleReset}
              disabled={busy || atDefaults}
            >
              ↺ Reset to defaults
            </button>
            <span className="vs-tune-cost">First 2/track free · 50 cr after</span>
          </div>

          {(prevTake || curTake) && (
            <div className="vs-tune-compare">
              {/* A/B take toggle */}
              <div className="vs-toggle-group vs-tune-ab">
                <button
                  className={`vs-ptab ${ab === 'A' ? 'vs-ptab--active' : ''}`}
                  onClick={() => setAb('A')}
                  disabled={!prevTake}
                  title={prevTake ? undefined : 'No previous take yet'}
                >A · Previous</button>
                <button
                  className={`vs-ptab ${ab === 'B' ? 'vs-ptab--active' : ''}`}
                  onClick={() => setAb('B')}
                  disabled={!curTake}
                >B · New</button>
              </div>

              {/* Mini vocals-only player for the selected take */}
              {selectedUrl && (
                <>
                  <audio
                    ref={audioRef}
                    src={selectedUrl}
                    preload="metadata"
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onEnded={() => { setPlaying(false); setProgress(0) }}
                    onTimeUpdate={() => {
                      const a = audioRef.current
                      if (a && a.duration) setProgress(a.currentTime / a.duration)
                    }}
                  />
                  <div className="vs-tune-mini">
                    <button className="vs-play-btn" onClick={handleTogglePlay} aria-label={playing ? 'Pause' : 'Play'}>
                      {playing ? '⏸' : '▶'}
                    </button>
                    <div className="vs-tune-bar"><div className="vs-tune-bar-fill" style={{ width: `${progress * 100}%` }} /></div>
                    <span className="vs-tune-side">{ab === 'A' ? 'Previous' : 'New'} take</span>
                  </div>
                </>
              )}

              <button
                className="vs-tune-apply"
                onClick={() => selected && onApplyToFull(selected.params)}
                disabled={!selected}
                title="Re-render the full song with the selected take's settings (200 cr)"
              >
                ✓ Apply {ab === 'A' ? 'Previous' : 'New'} to Full Track · 200 cr
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ResultStep
// ---------------------------------------------------------------------------
export function ResultStep({
  onNewSwap, onRegenerate, regenCapReached, onToast,
  onTunedPreview, onApplyToFull,
  convertedVocalsUrl, convertedVocalsUrl2, stemResult, duetUntouchedVocalsUrl,
  persistMix, onFullMixReady,
}: ResultStepProps) {
  const [barsAnimated, setBarsAnimated] = useState(false)

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

  // ── Warmth (vocal polish) ────────────────────────────────────────────────
  // 0..100, default 0 = no change (identical mix to before). Debounced before it
  // drives a re-render so dragging doesn't re-mix on every pixel. Applies to the
  // CONVERTED vocal in the full-song swapped mix (and the saved track).
  const [warmth, setWarmth] = useState(0)
  const [debouncedWarmth, setDebouncedWarmth] = useState(0)
  const [warmthRendering, setWarmthRendering] = useState(false)
  // Latest settled warmth, read (not depended-on) by the build effect so a
  // regenerate rebuilds at the current warmth without the effect re-firing on
  // every warmth change.
  const warmthRef = useRef(0)
  warmthRef.current = debouncedWarmth
  // The parent persists the swap exactly once (it nulls its persist context after
  // the first onFullMixReady). So we DEFER that single upload until warmth has
  // settled — guaranteeing the saved file matches what the user hears. Reset on
  // each new swap/regenerate (top of the build effect).
  const persistedRef = useRef(false)
  // Skips the warmth re-render effect's first run (the build effect already
  // rendered the swapped mix at this warmth on mount).
  const warmthInitRef = useRef(true)

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

  // Debounce the warmth slider → debouncedWarmth is what actually drives a re-mix.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedWarmth(warmth), 280)
    return () => clearTimeout(t)
  }, [warmth])

  // Build BOTH full-song mixes in parallel as soon as the URLs are ready.
  useEffect(() => {
    if (!convertedVocalsUrl || !stemResult?.vocalsUrl) return
    // New swap / regenerate → re-arm the deferred one-shot persist.
    persistedRef.current = false

    // Collect non-empty music stem URLs (the shared instrumental bed)
    const musicUrls = [
      stemResult.instrumentalUrl,
      stemResult.bassUrl,
      stemResult.drumsUrl,
      stemResult.otherUrl,
    ].filter((u): u is string => Boolean(u))

    if (musicUrls.length === 0) {
      // No music stems — Full song mode is impossible. Force vocals-only and
      // persist the vocal (null path) so the swap still lands in Recent Swaps.
      setFullMixState('no-stems')
      setMode('vocals')
      persistedRef.current = true
      if (persistMix) onFullMixReady?.(null)
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
      // Original (reference) mix is never warmed — only the swapped vocal is.
      mixStems([stemResult.leadVocalsUrl || stemResult.vocalsUrl], musicUrls),
      mixStems(swapVocalUrls, musicUrls, { warmth: warmthRef.current }),
    ])
      .then(([origBlob, swapBlob]) => {
        if (cancelled) return
        if (!origBlob || !swapBlob) {
          setFullMixState('error')
          persistedRef.current = true
          if (persistMix) onFullMixReady?.(null) // fall back to vocal-only persist
          return
        }
        const origUrl = URL.createObjectURL(origBlob)
        const swapUrl = URL.createObjectURL(swapBlob)
        mixedOriginalRef.current = origUrl
        mixedSwappedRef.current = swapUrl
        setMixedOriginalUrl(origUrl)
        setMixedSwappedUrl(swapUrl)
        setFullMixState('ready')
        // NOTE: upload+persist is intentionally NOT done here — it's deferred
        // until warmth settles (see the persist effect below) so the saved file
        // reflects the warmth the user chose, not the initial warmth-0 render.
      })
      .catch(() => {
        if (cancelled) return
        setFullMixState('error')
        persistedRef.current = true
        if (persistMix) onFullMixReady?.(null)
      })

    return () => { cancelled = true }
  }, [convertedVocalsUrl, stemResult?.vocalsUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live warmth preview: when settled warmth changes, re-render ONLY the swapped
  // full-song mix (music bed + the Original reference mix stay untouched). No
  // fullMixState flip, so the player never drops to the "Mixing…" banner — we
  // just swap in the warmed URL when it's ready.
  useEffect(() => {
    if (warmthInitRef.current) { warmthInitRef.current = false; return }
    if (!convertedVocalsUrl || !stemResult?.vocalsUrl) return
    const musicUrls = [
      stemResult.instrumentalUrl,
      stemResult.bassUrl,
      stemResult.drumsUrl,
      stemResult.otherUrl,
    ].filter((u): u is string => Boolean(u))
    if (musicUrls.length === 0) return // no full mix to warm
    const swapVocalUrls = [
      convertedVocalsUrl,
      ...(duetUntouchedVocalsUrl ? [duetUntouchedVocalsUrl] : []),
      ...(convertedVocalsUrl2 ? [convertedVocalsUrl2] : []),
    ]
    let cancelled = false
    setWarmthRendering(true)
    mixStems(swapVocalUrls, musicUrls, { warmth: debouncedWarmth })
      .then((blob) => {
        if (cancelled || !blob) return
        const url = URL.createObjectURL(blob)
        if (mixedSwappedRef.current) URL.revokeObjectURL(mixedSwappedRef.current)
        mixedSwappedRef.current = url
        setMixedSwappedUrl(url)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setWarmthRendering(false) })
    return () => { cancelled = true }
  }, [debouncedWarmth]) // eslint-disable-line react-hooks/exhaustive-deps

  // Deferred one-shot persist: the parent saves the swap exactly once (it nulls
  // its persist context after the first onFullMixReady). Wait until the swapped
  // mix is ready AND warmth has settled (not mid-drag, not re-rendering), then
  // upload that settled mix a single time so Recent Swaps matches what was heard.
  useEffect(() => {
    if (!persistMix || persistedRef.current) return
    if (fullMixState !== 'ready' || !mixedSwappedUrl) return
    if (warmthRendering || debouncedWarmth !== warmth) return // still settling
    const t = setTimeout(() => {
      if (persistedRef.current) return
      persistedRef.current = true
      uploadFullMixMp3(mixedSwappedUrl).then((path) => onFullMixReady?.(path))
    }, 1000)
    return () => clearTimeout(t)
  }, [persistMix, fullMixState, mixedSwappedUrl, warmthRendering, debouncedWarmth, warmth]) // eslint-disable-line react-hooks/exhaustive-deps

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
            <div className="vs-result-score-lbl">Quality Score <span className="vs-est-tag">Est.</span></div>
            <div className="grad-text" style={{ fontFamily: 'var(--font-grotesk),"Space Grotesk",sans-serif', fontSize: '36px', fontWeight: 700, letterSpacing: '-1px', lineHeight: 1 }}>
              ~82<span style={{ fontSize: '14px', fontWeight: 400, color: '#5A5A80', letterSpacing: 0, marginLeft: '6px', background: 'none', WebkitTextFillColor: '#5A5A80' }}> / 100</span>
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
                <span>{bar.label}</span><span>~{bar.pct}%</span>
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

        {/* Polish — free, client-side vocal sweetening on the CONVERTED vocal.
            Unlike the Fine-tune panel (a paid RVC re-convert), this is a Web Audio
            EQ baked into the full-song mix and the saved track. Hidden when there's
            no full mix to colour. */}
        {fullMixState !== 'no-stems' && (
          <div className="vs-polish">
            <div className="vs-polish-head">
              <span className="vs-polish-title">Polish</span>
              <span className="vs-polish-val">
                {warmth === 0 ? 'Off' : `+${((warmth / 100) * WARMTH_MAX_DB).toFixed(1)} dB`}
                {warmthRendering && <span className="vs-polish-spin" />}
              </span>
            </div>
            <div className="vs-polish-row">
              <label className="vs-polish-label" htmlFor="vs-warmth">
                Warmth <span className="vs-polish-hint">— adds body/warmth to the vocal</span>
              </label>
              <input
                id="vs-warmth"
                type="range"
                min={0}
                max={100}
                step={1}
                value={warmth}
                onChange={(e) => setWarmth(Number(e.target.value))}
                className="vs-polish-slider"
              />
            </div>
            <div className="vs-polish-foot">Free · client-side · baked into the full-song mix &amp; the saved track.</div>
          </div>
        )}

        {/* Fine-tune panel — single-voice swaps only for v1 (duet tuning is a
            follow-up). Hidden when a second converted vocal is present. */}
        {!convertedVocalsUrl2 && (
          <FineTunePanel
            onTunedPreview={onTunedPreview}
            onApplyToFull={onApplyToFull}
            onToast={onToast}
            durationSeconds={duration}
          />
        )}

        {/* Regen row */}
        <div className="vs-regen-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: '#5A5A80' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M4 4v5h5M20 20v-5h-5" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" />
              <path d="M20 9A8 8 0 0 0 5.66 5.66M4 15a8 8 0 0 0 14.34 3.34" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" />
            </svg>
            {regenCapReached ? (
              <>Maximum voice strength reached for this track.</>
            ) : (
              <>Regenerate for a <strong style={{ color: '#8B5CF6' }}>stronger voice match</strong> · costs <strong style={{ color: '#8B5CF6' }}>200 cr</strong></>
            )}
          </div>
          <button
            className="vs-regen-btn"
            onClick={() => onRegenerate()}
            disabled={regenCapReached}
          >↺ Regenerate</button>
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
        .vs-est-tag {
          display: inline-block; font-size: 8px; font-weight: 700;
          letter-spacing: 1px; text-transform: uppercase;
          padding: 1px 5px; border-radius: 4px; vertical-align: middle;
          background: rgba(90,90,128,.15); color: #5A5A80;
          border: 1px solid rgba(90,90,128,.25); margin-left: 4px;
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
        .vs-polish {
          background: #0E0E20; border: 1px solid #1E1E3A; border-radius: 10px;
          padding: 12px 14px; margin-bottom: 14px;
        }
        .vs-polish-head {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 9px;
        }
        .vs-polish-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 12px; font-weight: 700; color: #C4B5FD; letter-spacing: 0.3px;
          text-transform: uppercase;
        }
        .vs-polish-val {
          display: inline-flex; align-items: center; gap: 6px;
          font-size: 12px; font-weight: 600; color: #8B5CF6;
        }
        .vs-polish-spin {
          width: 9px; height: 9px; border-radius: 50%;
          border: 1.5px solid rgba(139,92,246,.3); border-top-color: #8B5CF6;
          animation: vsPolishSpin 0.7s linear infinite;
        }
        @keyframes vsPolishSpin { to { transform: rotate(360deg); } }
        .vs-polish-row { display: flex; align-items: center; gap: 12px; }
        .vs-polish-label { font-size: 12px; color: #C4C4E0; white-space: nowrap; }
        .vs-polish-hint { color: #5A5A80; }
        .vs-polish-slider {
          flex: 1; min-width: 120px; height: 4px; cursor: pointer;
          accent-color: #8B5CF6;
        }
        .vs-polish-foot { font-size: 11px; color: #5A5A80; margin-top: 8px; }
        @media (max-width: 560px) {
          .vs-polish-row { flex-direction: column; align-items: stretch; gap: 7px; }
          .vs-polish-slider { width: 100%; }
        }
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

        /* Fine-tune panel */
        .vs-tune {
          background: #0E0E20; border: 1px solid #1E1E3A;
          border-radius: 10px; margin-bottom: 14px; overflow: hidden;
        }
        .vs-tune-head {
          width: 100%; display: flex; align-items: center; justify-content: space-between;
          padding: 10px 14px; background: transparent; border: none; cursor: pointer;
          color: #C4C4E0; font-size: 13px; font-weight: 600;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
        }
        .vs-tune-head:hover { color: #F0F0FF; }
        .vs-tune-adv {
          font-size: 9px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase;
          padding: 2px 6px; border-radius: 999px; margin-left: 6px;
          background: rgba(139,92,246,.15); color: #A78BFA; border: 1px solid rgba(139,92,246,.3);
        }
        .vs-tune-chev { color: #5A5A80; font-size: 10px; }
        .vs-tune-body { padding: 4px 14px 14px; border-top: 1px solid #1E1E3A; }
        .vs-tune-row { margin-top: 12px; }
        .vs-tune-rowtop { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
        .vs-tune-label { font-size: 12px; color: #C4C4E0; }
        .vs-tune-hint { font-size: 10px; color: #5A5A80; font-variant-numeric: tabular-nums; }
        .vs-tune-val {
          font-size: 12px; color: #A78BFA; font-weight: 600;
          font-variant-numeric: tabular-nums;
        }
        .vs-tune-slider { width: 100%; accent-color: #8B5CF6; cursor: pointer; }
        .vs-tune-slider:disabled { opacity: 0.5; cursor: not-allowed; }
        .vs-tune-actions { display: flex; align-items: center; gap: 12px; margin-top: 16px; }
        .vs-tune-preview-btn {
          padding: 8px 16px; border-radius: 8px; border: none;
          background: linear-gradient(135deg,#8B5CF6,#EC4899); color: #fff;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .vs-tune-preview-btn:hover:not(:disabled) { box-shadow: 0 6px 18px rgba(139,92,246,.4); }
        .vs-tune-preview-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .vs-tune-reset-btn {
          padding: 8px 14px; border-radius: 8px;
          border: 1px solid rgba(139,92,246,.4); background: transparent; color: #C4B5FD;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .vs-tune-reset-btn:hover:not(:disabled) { background: rgba(139,92,246,.12); }
        .vs-tune-reset-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .vs-tune-cost { font-size: 11px; color: #5A5A80; }
        .vs-tune-compare {
          margin-top: 16px; padding-top: 14px; border-top: 1px solid #1E1E3A;
          display: flex; flex-direction: column; gap: 12px;
        }
        .vs-tune-ab { align-self: flex-start; border: 1px solid #1E1E3A; border-radius: 8px; }
        .vs-tune-mini { display: flex; align-items: center; gap: 12px; }
        .vs-tune-bar { flex: 1; height: 5px; background: #1E1E3A; border-radius: 3px; overflow: hidden; }
        .vs-tune-bar-fill { height: 100%; background: linear-gradient(135deg,#8B5CF6,#EC4899); border-radius: 3px; }
        .vs-tune-side { font-size: 11px; color: #5A5A80; min-width: 80px; text-align: right; }
        .vs-tune-apply {
          align-self: flex-start; padding: 8px 16px; border-radius: 8px;
          border: 1px solid rgba(16,185,129,.4); background: rgba(16,185,129,.1);
          color: #10B981; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .vs-tune-apply:hover:not(:disabled) { background: rgba(16,185,129,.18); }
        .vs-tune-apply:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </>
  )
}
