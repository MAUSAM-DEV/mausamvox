'use client'

import { useEffect, useRef, useState } from 'react'
import type { StemResult } from './UploadStep'
import { encodeWav, encodeMp3, createReverbImpulse } from './audioClip'
import { ShareControl } from '@/components/share/ShareControl'

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
  // instrumentalPath is the sibling MUSIC-ONLY mix (Performance Mode's "Music
  // only" backing) — best-effort, null whenever its render/upload fails.
  persistMix?: boolean
  onFullMixReady?: (mixedPath: string | null, instrumentalPath?: string | null) => void
  // Re-save the saved track's audio when polish changes AFTER the first save
  // (UPDATE the same row — no re-conversion, no credits). Returns success.
  onPolishResave?: (mixedPath: string) => Promise<boolean> | void
  // Name(s) of the voice model(s) the swap used — shown in the result summary.
  voiceName?: string | null
  // The saved voice_swaps row id, set once the parent's persist succeeds.
  // Share needs it (a public link points at the SAVED track); null disables
  // the Share button with a "saving…" hint until the save lands.
  persistedSwapId?: string | null
}

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
async function uploadFullMixMp3(wavMixUrl: string, filename = 'swap-full-mix.mp3'): Promise<string | null> {
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
      body: JSON.stringify({ filename, contentType: 'audio/mpeg' }),
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
const WARMTH_MAX_DB = 10

// Bass / Treble: two BIPOLAR shelving EQs on the CONVERTED VOCAL path only,
// chained alongside Warmth and BEFORE the Reverb/Echo time effects. The knob
// value IS the dB, over ±BASS_MAX_DB / ±TREBLE_MAX_DB. At 0 dB NO filter node
// is inserted, so the graph stays byte-identical to before these controls
// existed (same guarantee Warmth has at zero). Bass = low-shelf, Treble =
// high-shelf. MAX are the tuning knobs for the range (defaults stay 0).
const BASS_FREQ_HZ = 100
const TREBLE_FREQ_HZ = 8000
const BASS_MAX_DB = 16   // Bass shelf range: −16..+16 dB
const TREBLE_MAX_DB = 20 // Treble shelf range: −20..+20 dB

// Reverb: a short synthetic "vocal space" convolution chained AFTER warmth, on
// the same CONVERTED VOCAL path (music bed untouched). reverb 0..100 maps to
// 0..REVERB_MAX_WET of wet mix — capped well under 100% since a fully-wet
// soloed vocal sounds washy/unnatural. At reverb 0 NO convolver/split nodes
// are inserted at all, so the graph is byte-identical to before this control.
const REVERB_MAX_WET = 0.5
const REVERB_IR_SECONDS = 1.8
const REVERB_IR_DECAY = 2.5

// Echo: a feedback delay chained AFTER reverb on the same CONVERTED VOCAL path
// (music bed untouched). echo 0..100 maps to 0..ECHO_MAX_WET of wet mix. Delay
// time and feedback are fixed internals (one-knob philosophy, like reverb's
// fixed IR): 0.30s ≈ a classic vocal echo, feedback 0.35 gives 2–3 audible
// repeats (35% → 12% → 4%) then dies — kept well under 1.0 (runaway) and under
// 0.5 (mush build-up). A lowpass in the feedback loop darkens each successive
// repeat ("tape echo") so repeats never fight the lead vocal. At echo 0 NO
// delay/split nodes are inserted at all — byte-identical to before this control.
const ECHO_DELAY_S = 0.3
const ECHO_FEEDBACK = 0.35
const ECHO_DAMP_HZ = 3500
const ECHO_MAX_WET = 0.5

// ── Default "Studio" polish preset ──────────────────────────────────────────
// New swaps START at these values so they come out finished, not bone-dry.
// This ONLY changes the initial knob values — the byte-identical-at-0 bypass is
// untouched (a control at 0 still inserts no node; "Raw" zeros all five). Tune
// the natural-unit constants below; they convert to the knobs' internal units.
const STUDIO_WARMTH_DB = 4      // +4 dB low-shelf warmth
const STUDIO_REVERB_WET = 0.15 // 15% wet reverb
const STUDIO_ECHO_WET = 0      // no echo by default
const STUDIO_BASS_DB = 0       // flat
const STUDIO_TREBLE_DB = 0     // flat

// Knob-unit preset values: Warmth/Reverb/Echo knobs are 0..100 → 0..MAX; the
// Bass/Treble knob value IS dB. Rounded to the knobs' integer step.
const STUDIO_WARMTH = Math.round((STUDIO_WARMTH_DB / WARMTH_MAX_DB) * 100)   // 40
const STUDIO_REVERB = Math.round((STUDIO_REVERB_WET / REVERB_MAX_WET) * 100) // 30
const STUDIO_ECHO = Math.round((STUDIO_ECHO_WET / ECHO_MAX_WET) * 100)       // 0
const STUDIO_BASS = STUDIO_BASS_DB                                           // 0
const STUDIO_TREBLE = STUDIO_TREBLE_DB                                       // 0

const STUDIO_PRESET = { warmth: STUDIO_WARMTH, reverb: STUDIO_REVERB, echo: STUDIO_ECHO, bass: STUDIO_BASS, treble: STUDIO_TREBLE }
const RAW_PRESET = { warmth: 0, reverb: 0, echo: 0, bass: 0, treble: 0 }

async function mixStems(
  vocalsUrls: string[],
  musicUrls: string[],
  opts?: { warmth?: number; reverb?: number; echo?: number; bass?: number; treble?: number },
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

  // STRICT: every requested stem must decode, or the whole mix fails (null →
  // the caller's 'error' state). A partial mix used to slip through here — an
  // expired music-stem URL quietly produced a vocals-only "full song" that
  // looked like success. Better an honest error than a silently wrong file.
  const failedCount = [...vocalBufs, ...musicBufs].filter((b) => b === null).length
  if (failedCount > 0) {
    console.error(`[mixStems] ${failedCount}/${vocalsUrls.length + musicUrls.length} stem fetches failed — aborting mix (stale URLs?)`)
    return null
  }
  const validVocals = vocalBufs.filter((b): b is AudioBuffer => b !== null)
  const validMusic = musicBufs.filter((b): b is AudioBuffer => b !== null)
  // An empty vocal list is a legitimate request — the music-only instrumental
  // render for Performance Mode's "Music only" backing. Only bail when there
  // is nothing at all to mix.
  if (validVocals.length === 0 && validMusic.length === 0) return null

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
  // Bass / Treble shelving gain (dB); the knob value IS the dB. 0 → no filter.
  const bassDb = opts?.bass ? Math.max(-BASS_MAX_DB, Math.min(BASS_MAX_DB, opts.bass)) : 0
  const trebleDb = opts?.treble ? Math.max(-TREBLE_MAX_DB, Math.min(TREBLE_MAX_DB, opts.treble)) : 0
  // Wet fraction for the vocal path; 0 at default reverb → no convolver.
  const reverbWet = opts?.reverb
    ? (Math.min(100, Math.max(0, opts.reverb)) / 100) * REVERB_MAX_WET
    : 0
  // Wet fraction for the vocal path; 0 at default echo → no delay bus.
  const echoWet = opts?.echo
    ? (Math.min(100, Math.max(0, opts.echo)) / 100) * ECHO_MAX_WET
    : 0

  // Vocal sink — where the VOCAL path terminates (the music bed always goes
  // straight to destination). With echo off this IS the destination, so no
  // nodes exist and the graph is byte-identical to before. With echo on it's
  // the input of ONE shared feedback-delay bus for ALL vocal channels (delay
  // is linear, so sharing is identical to per-channel, just cheaper — same
  // reasoning as the shared reverb convolver). Built lazily on first use.
  let echoBusIn: GainNode | null = null
  function getVocalSink(): AudioNode {
    if (echoWet <= 0) return offline.destination
    if (!echoBusIn) {
      const input = offline.createGain()
      input.gain.value = 1

      const dry = offline.createGain()
      dry.gain.value = 1 - echoWet
      input.connect(dry)
      dry.connect(offline.destination)

      // Feedback loop: delay → lowpass damp → feedback gain → back into delay.
      // The damp filter sits INSIDE the loop, so each successive repeat gets
      // darker (tape-echo style); the first repeat passes through undamped.
      const delay = offline.createDelay(1)
      delay.delayTime.value = ECHO_DELAY_S
      const damp = offline.createBiquadFilter()
      damp.type = 'lowpass'
      damp.frequency.value = ECHO_DAMP_HZ
      const feedback = offline.createGain()
      feedback.gain.value = ECHO_FEEDBACK
      delay.connect(damp)
      damp.connect(feedback)
      feedback.connect(delay)

      const wetGain = offline.createGain()
      wetGain.gain.value = echoWet
      input.connect(delay)
      delay.connect(wetGain)
      wetGain.connect(offline.destination)

      echoBusIn = input
    }
    return echoBusIn
  }

  // Shared dry/wet reverb bus — ONE ConvolverNode for ALL vocal channels.
  // Convolution distributes over summed inputs, so feeding every vocal
  // channel into one shared convolver is identical to giving each its own,
  // just cheaper. Built lazily so a reverb=0 render never creates it.
  // Outputs feed the vocal sink (echo bus when echo>0, else destination) so
  // the chain is warmth → reverb → echo → destination.
  let reverbBus: { dry: GainNode; wetIn: ConvolverNode } | null = null
  function getReverbBus() {
    if (!reverbBus) {
      const dry = offline.createGain()
      dry.gain.value = 1 - reverbWet
      dry.connect(getVocalSink())

      const convolver = offline.createConvolver()
      convolver.buffer = createReverbImpulse(offline, REVERB_IR_SECONDS, REVERB_IR_DECAY)

      const wetGain = offline.createGain()
      wetGain.gain.value = reverbWet
      convolver.connect(wetGain)
      wetGain.connect(getVocalSink())

      reverbBus = { dry, wetIn: convolver }
    }
    return reverbBus
  }

  function addSource(buf: AudioBuffer, gain: number, warm = false) {
    const gainNode = offline.createGain()
    gainNode.gain.value = gain
    const src = offline.createBufferSource()
    src.buffer = buf
    src.connect(gainNode)
    // Tone EQ (Warmth low-shelf, then Bass low-shelf, then Treble high-shelf),
    // then reverb, then echo — all ONLY on the vocal path (warm=true) and ONLY
    // inserted when their amount is non-zero, so at warmth=0/bass=0/treble=0/
    // reverb=0/echo=0 the graph is byte-identical to before these controls
    // existed. Linear shelves commute, so the order among the three EQs is
    // sonically irrelevant; EQ deliberately sits BEFORE the time effects.
    let node: AudioNode = gainNode
    if (warm && warmthDb > 0) {
      const eq = offline.createBiquadFilter()
      eq.type = 'lowshelf'
      eq.frequency.value = WARMTH_FREQ_HZ
      eq.gain.value = warmthDb
      node.connect(eq)
      node = eq
    }
    if (warm && bassDb !== 0) {
      const eq = offline.createBiquadFilter()
      eq.type = 'lowshelf'
      eq.frequency.value = BASS_FREQ_HZ
      eq.gain.value = bassDb
      node.connect(eq)
      node = eq
    }
    if (warm && trebleDb !== 0) {
      const eq = offline.createBiquadFilter()
      eq.type = 'highshelf'
      eq.frequency.value = TREBLE_FREQ_HZ
      eq.gain.value = trebleDb
      node.connect(eq)
      node = eq
    }
    if (warm && reverbWet > 0) {
      const { dry, wetIn } = getReverbBus()
      node.connect(dry)
      node.connect(wetIn)
    } else {
      // Vocal without reverb still routes through the echo bus (vocal sink);
      // music always terminates at the destination untouched.
      node.connect(warm ? getVocalSink() : offline.destination)
    }
    src.start(0)
  }

  // Converted-vocal makeup: the separated-then-reconverted vocal sits low
  // against the reconstructed backing (no mix-bus makeup on the isolated stem),
  // so lift it a touch. Pure gain on the always-present vocal gainNode — wholly
  // independent of the Warmth/Bass/Treble EQ nodes (which are still only
  // inserted when non-zero), so the byte-identical-at-0 Polish guarantee is
  // untouched. The −1 dBFS headroom limiter below still catches any new peaks.
  // This is the ONE tuning knob for clone loudness — adjust here.
  const VOCAL_MAKEUP = 1.3
  // VOCAL_MAKEUP/√N per vocal channel: keeps perceived loudness flat as N grows.
  const vocalGain = VOCAL_MAKEUP / Math.sqrt(validVocals.length)
  for (const buf of validVocals) addSource(buf, vocalGain, true) // vocal: warmth-eligible + makeup
  for (const buf of validMusic) addSource(buf, 0.8)              // music: never warmed, no makeup

  const rendered = await offline.startRendering()

  // −1 dB safety headroom: polish gain (the warmth low-shelf especially) can
  // push the summed mix past full scale, and encodeWav/encodeMp3 hard-clamp
  // anything over ±1.0 into audible clipping. A single post-render scale,
  // applied only when the peak actually exceeds −1 dBFS, is transparent —
  // pure gain, no pumping, no tone change — and covers both the preview
  // player and the saved file (which is re-encoded from this same render).
  const HEADROOM = 0.8913 // 10^(-1/20) ≈ −1 dBFS
  let peak = 0
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const data = rendered.getChannelData(c)
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i])
      if (a > peak) peak = a
    }
  }
  if (peak > HEADROOM) {
    const scale = HEADROOM / peak
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const data = rendered.getChannelData(c)
      for (let i = 0; i < data.length; i++) data[i] *= scale
    }
    console.log(`[mixStems] peak ${peak.toFixed(3)} over −1 dBFS — scaled by ${scale.toFixed(3)} to avoid encode clipping`)
  }

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
// Polish knob — rotary dial for the Warmth/Reverb/Echo/Bass/Treble controls.
// value + onChange over [min, max] (default 0–100 keeps Warmth/Reverb/Echo
// byte-identical). Drag vertically (~200px = full travel), arrow keys when
// focused, double-click resets to `resetTo`. For a BIPOLAR range (Bass/Treble,
// −12..+12, resetTo 0) the value arc fills outward from the centre detent; for
// a unipolar range (resetTo = min) it fills from the left end exactly as before.
// ---------------------------------------------------------------------------
const KNOB_SWEEP = 270 // degrees of dial travel; gap centered at the bottom

function PolishKnob({
  id, label, hint, value, onChange, format, min = 0, max = 100, step = 1, resetTo = 0,
}: {
  id: string; label: string; hint: string; value: number
  onChange: (v: number) => void; format: (v: number) => string
  min?: number; max?: number; step?: number; resetTo?: number
}) {
  const drag = useRef<{ startY: number; startValue: number } | null>(null)
  const r = 19, c = 24, circ = 2 * Math.PI * r
  const sweepFrac = KNOB_SWEEP / 360
  const range = max - min
  const clampV = (v: number) => Math.max(min, Math.min(max, v))
  const valueFrac = (value - min) / range
  const zeroFrac = (resetTo - min) / range
  const startFrac = Math.min(zeroFrac, valueFrac)
  const arcLen = Math.abs(valueFrac - zeroFrac)
  // Track and value arcs start at the 7:30 position (135° past 3 o'clock);
  // the value arc's start is offset to the detent for bipolar ranges.
  const arcStart = `rotate(135 ${c} ${c})`
  const valueArcStart = `rotate(${135 + startFrac * KNOB_SWEEP} ${c} ${c})`
  const pointerAngle = 135 + valueFrac * KNOB_SWEEP
  const pageStep = Math.max(step, Math.round(range / 10))

  const nudge = (e: React.KeyboardEvent, delta: number) => {
    e.preventDefault()
    onChange(clampV(value + delta))
  }

  return (
    <div className="vs-knob" title={hint}>
      <svg
        width="48" height="48" viewBox="0 0 48 48"
        role="slider" tabIndex={0} aria-label={label}
        aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
        aria-valuetext={format(value)}
        onPointerDown={(e) => {
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { startY: e.clientY, startValue: value }
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const delta = (drag.current.startY - e.clientY) * (range / 200)
          onChange(clampV(Math.round(drag.current.startValue + delta)))
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerCancel={() => { drag.current = null }}
        onDoubleClick={() => onChange(resetTo)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') nudge(e, step)
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') nudge(e, -step)
          else if (e.key === 'PageUp') nudge(e, pageStep)
          else if (e.key === 'PageDown') nudge(e, -pageStep)
          else if (e.key === 'Home') nudge(e, min - value)
          else if (e.key === 'End') nudge(e, max - value)
        }}
      >
        <circle cx={c} cy={c} r={r} fill="none" stroke="#1E1E3A" strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${circ * sweepFrac} ${circ}`} transform={arcStart}
        />
        {arcLen > 0 && (
          <circle cx={c} cy={c} r={r} fill="none" stroke={`url(#pk-${id})`} strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${circ * sweepFrac * arcLen} ${circ}`} transform={valueArcStart}
          />
        )}
        <line x1={c + 7} y1={c} x2={c + 13} y2={c} stroke="#C4B5FD" strokeWidth="2.5"
          strokeLinecap="round" transform={`rotate(${pointerAngle} ${c} ${c})`}
        />
        <defs>
          <linearGradient id={`pk-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>
        </defs>
      </svg>
      <span className="vs-knob-label">{label}</span>
      <span className="vs-knob-val">{format(value)}</span>
    </div>
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
  persistMix, onFullMixReady, onPolishResave, voiceName, persistedSwapId,
}: ResultStepProps) {
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
  // 0..100. NEW swaps start at the Studio preset (STUDIO_WARMTH) so they come
  // out finished, not dry; 0 is still a true bypass (no node). Debounced before
  // it drives a re-render so dragging doesn't re-mix on every pixel. Applies to
  // the CONVERTED vocal on BOTH the full-song swapped mix and the Vocals-only
  // playback (and the saved track), so soloing the vocal to judge it matches
  // what Full-song plays and what gets saved.
  const [warmth, setWarmth] = useState(STUDIO_WARMTH)
  const [debouncedWarmth, setDebouncedWarmth] = useState(STUDIO_WARMTH)
  const [warmthRendering, setWarmthRendering] = useState(false)
  // Latest settled warmth, read (not depended-on) by the build effect so a
  // regenerate rebuilds at the current warmth without the effect re-firing on
  // every warmth change.
  const warmthRef = useRef(STUDIO_WARMTH)
  warmthRef.current = debouncedWarmth
  // The parent persists the swap exactly once (it nulls its persist context after
  // the first onFullMixReady). So we DEFER that single upload until warmth has
  // settled — guaranteeing the saved file matches what the user hears. Reset on
  // each new swap/regenerate (top of the build effect).
  const persistedRef = useRef(false)
  // Skips the warmth re-render effect's first run (the build effect already
  // rendered the swapped mix at this warmth on mount).
  const warmthInitRef = useRef(true)

  // ── Reverb (vocal polish, chained after warmth) ──────────────────────────
  // 0..100. NEW swaps start at STUDIO_REVERB (light space); 0 = true bypass.
  // Same debounce/settle/persist pattern as warmth — see comments above.
  // Applies to the CONVERTED vocal on BOTH the full-song swapped mix and the
  // Vocals-only playback (and the saved track).
  const [reverb, setReverb] = useState(STUDIO_REVERB)
  const [debouncedReverb, setDebouncedReverb] = useState(STUDIO_REVERB)
  const reverbRef = useRef(STUDIO_REVERB)
  reverbRef.current = debouncedReverb

  // ── Echo (vocal polish, chained after reverb) ────────────────────────────
  // 0..100, default 0 = no change. Same debounce/settle/persist pattern as
  // warmth/reverb — see comments above. Applies to the CONVERTED vocal on BOTH
  // the full-song swapped mix and the Vocals-only playback (and the saved track).
  const [echo, setEcho] = useState(STUDIO_ECHO)
  const [debouncedEcho, setDebouncedEcho] = useState(STUDIO_ECHO)
  const echoRef = useRef(STUDIO_ECHO)
  echoRef.current = debouncedEcho

  // ── Bass / Treble (vocal polish tone EQ, chained alongside warmth) ────────
  // BIPOLAR −12..+12 dB, default 0 = no change. Same debounce/settle/persist
  // pattern as warmth/reverb/echo — applied to the CONVERTED vocal on BOTH the
  // full-song swapped mix and the Vocals-only playback (and the saved track).
  const [bass, setBass] = useState(STUDIO_BASS)
  const [debouncedBass, setDebouncedBass] = useState(STUDIO_BASS)
  const bassRef = useRef(STUDIO_BASS)
  bassRef.current = debouncedBass

  const [treble, setTreble] = useState(STUDIO_TREBLE)
  const [debouncedTreble, setDebouncedTreble] = useState(STUDIO_TREBLE)
  const trebleRef = useRef(STUDIO_TREBLE)
  trebleRef.current = debouncedTreble

  // Apply a whole preset in one tap (Studio default / Raw). setState only — the
  // debounce → re-render → both-tabs + saved-file wiring handles the rest.
  const applyPreset = (p: { warmth: number; reverb: number; echo: number; bass: number; treble: number }) => {
    setWarmth(p.warmth); setReverb(p.reverb); setEcho(p.echo); setBass(p.bass); setTreble(p.treble)
  }

  // ── Auto re-persist (the saved track always reflects the CURRENT polish) ────
  // Signature of the currently-settled polish; the persist effect re-saves only
  // when this changes from what was last stored (no redundant uploads).
  const polishSig = `${debouncedWarmth}|${debouncedReverb}|${debouncedEcho}|${debouncedBass}|${debouncedTreble}`
  const polishSigRef = useRef(polishSig)
  polishSigRef.current = polishSig
  const lastSavedSigRef = useRef<string | null>(null) // null = not yet saved
  const savingRef = useRef(false)                      // an upload is in flight
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const [savedFlash, setSavedFlash] = useState(false)  // brief "Saved ✓" pip

  // Upload the current mix and (re)persist the saved track. First call inserts
  // the row (+ the polish-independent music-only instrumental, once); later
  // calls UPDATE the same row — no re-conversion, no credits. Best-effort: a
  // failure keeps the previously-saved version and does not advance the marker.
  async function savePolish() {
    if (savingRef.current) return
    const sig = polishSigRef.current
    if (sig === lastSavedSigRef.current) return
    const mixUrl = mixedSwappedRef.current
    if (!mixUrl) return
    const firstSave = lastSavedSigRef.current === null
    savingRef.current = true
    let saved = false
    const uploadStart = performance.now()
    try {
      const mixPath = await uploadFullMixMp3(mixUrl)
      if (!mixPath) {
        saved = false // upload failed — keep the previous saved version
      } else if (firstSave) {
        // Music-only backing (Perform Live / Sing along) — polish-independent,
        // so built + uploaded ONCE on the first save. Strictly best-effort.
        let instrumentalPath: string | null | undefined
        const musicUrls = [
          stemResult?.instrumentalUrl, stemResult?.bassUrl, stemResult?.drumsUrl, stemResult?.otherUrl,
        ].filter((u): u is string => Boolean(u))
        if (musicUrls.length > 0) {
          try {
            const blob = await mixStems([], musicUrls)
            if (blob) {
              const url = URL.createObjectURL(blob)
              try { instrumentalPath = await uploadFullMixMp3(url, 'swap-instrumental.mp3') }
              finally { URL.revokeObjectURL(url) }
            }
          } catch { /* best-effort — row just won't offer the music-only backing */ }
        }
        console.log(`[timing] stage=upload ms=${Math.round(performance.now() - uploadStart)}`)
        onFullMixReady?.(mixPath, instrumentalPath) // fire-and-forget INSERT
        saved = true
      } else {
        const ok = await onPolishResave?.(mixPath) // awaited UPDATE
        console.log(`[timing] stage=upload ms=${Math.round(performance.now() - uploadStart)} resave=1`)
        saved = ok !== false
      }
    } catch {
      saved = false // best-effort — the previously-saved version stays intact
    }
    savingRef.current = false
    if (saved) {
      lastSavedSigRef.current = sig
      setSavedFlash(true)
      clearTimeout(savedFlashTimerRef.current)
      savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 2200)
      // Polish changed while we were uploading? Save the newer value now.
      if (polishSigRef.current !== sig && mixedSwappedRef.current) void savePolish()
    }
    // On failure: no immediate retry (avoid hammering) — the next settled change re-runs the effect.
  }

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

  // Pre-warm the bare-RVC pool the moment the result screen appears: a
  // regenerate or fine-tune "Apply to Full Track" from here starts minutes
  // from now, past the pool's observed re-chill window (<7 min, 2026-07-05).
  // Fire-and-forget — the server no-ops on the cover engine and rate-limits.
  useEffect(() => {
    fetch('/api/rvc-warm', { method: 'POST' }).catch(() => {})
  }, [])

  // Debounce the warmth slider → debouncedWarmth is what actually drives a re-mix.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedWarmth(warmth), 280)
    return () => clearTimeout(t)
  }, [warmth])

  // Debounce the reverb slider → debouncedReverb is what actually drives a re-mix.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedReverb(reverb), 280)
    return () => clearTimeout(t)
  }, [reverb])

  // Debounce the echo slider → debouncedEcho is what actually drives a re-mix.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedEcho(echo), 280)
    return () => clearTimeout(t)
  }, [echo])

  // Debounce the bass knob → debouncedBass is what actually drives a re-mix.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBass(bass), 280)
    return () => clearTimeout(t)
  }, [bass])

  // Debounce the treble knob → debouncedTreble is what actually drives a re-mix.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedTreble(treble), 280)
    return () => clearTimeout(t)
  }, [treble])

  // Build BOTH full-song mixes in parallel as soon as the URLs are ready.
  useEffect(() => {
    if (!convertedVocalsUrl || !stemResult?.vocalsUrl) return
    // New swap / regenerate (a NEW converted vocal, new prediction id) → re-arm
    // persistence from scratch: clear the error-fallback one-shot AND the
    // auto-persist markers so the fresh vocal is saved as a first-save (new
    // row + its own instrumental), even if the polish signature is unchanged.
    persistedRef.current = false
    lastSavedSigRef.current = null
    savingRef.current = false

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
    // Instrumentation only (browser console): wall-clock of the in-browser
    // mix/master (both reference + swapped renders). Grep devtools for [timing].
    const mixStart = performance.now()
    Promise.all([
      // Original (reference) mix is never warmed — only the swapped vocal is.
      mixStems([stemResult.leadVocalsUrl || stemResult.vocalsUrl], musicUrls),
      mixStems(swapVocalUrls, musicUrls, { warmth: warmthRef.current, reverb: reverbRef.current, echo: echoRef.current, bass: bassRef.current, treble: trebleRef.current }),
    ])
      .then(([origBlob, swapBlob]) => {
        if (cancelled) return
        console.log(`[timing] stage=mix ms=${Math.round(performance.now() - mixStart)}`)
        if (!origBlob || !swapBlob) {
          setFullMixState('error')
          // Drop to Vocals-only so playback keeps working AND the error note
          // (rendered only in vocals mode) is actually visible — mixStems is
          // now strict, so this fires whenever any stem URL has gone stale.
          setMode('vocals')
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
        setMode('vocals') // see the error branch above
        persistedRef.current = true
        if (persistMix) onFullMixReady?.(null)
      })

    return () => { cancelled = true }
  }, [convertedVocalsUrl, stemResult?.vocalsUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live polish preview: when settled warmth OR reverb changes, re-render ONLY
  // the swapped full-song mix (music bed + the Original reference mix stay
  // untouched). No fullMixState flip, so the player never drops to the
  // "Mixing…" banner — we just swap in the polished URL when it's ready.
  useEffect(() => {
    if (warmthInitRef.current) { warmthInitRef.current = false; return }
    if (!convertedVocalsUrl || !stemResult?.vocalsUrl) return
    const musicUrls = [
      stemResult.instrumentalUrl,
      stemResult.bassUrl,
      stemResult.drumsUrl,
      stemResult.otherUrl,
    ].filter((u): u is string => Boolean(u))
    if (musicUrls.length === 0) return // no full mix to polish
    const swapVocalUrls = [
      convertedVocalsUrl,
      ...(duetUntouchedVocalsUrl ? [duetUntouchedVocalsUrl] : []),
      ...(convertedVocalsUrl2 ? [convertedVocalsUrl2] : []),
    ]
    let cancelled = false
    setWarmthRendering(true)
    mixStems(swapVocalUrls, musicUrls, { warmth: debouncedWarmth, reverb: debouncedReverb, echo: debouncedEcho, bass: debouncedBass, treble: debouncedTreble })
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
  }, [debouncedWarmth, debouncedReverb, debouncedEcho, debouncedBass, debouncedTreble]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-persist (Option 2): keep the SAVED track in sync with the CURRENT
  // polish. Whenever the swapped mix is ready and polish has SETTLED to a value
  // we haven't stored yet, schedule savePolish after a ~1s quiet period. First
  // run inserts the row; later settled changes UPDATE it — no re-conversion, no
  // credits (savePolish handles the dedup/first-vs-resave). persistedRef is set
  // ONLY by the error/no-stems fallbacks below (a failed full mix can't be
  // re-polished), so those stay a genuine one-shot.
  useEffect(() => {
    if (!persistMix || persistedRef.current) return
    if (fullMixState !== 'ready' || !mixedSwappedUrl) return
    if (warmthRendering || debouncedWarmth !== warmth || debouncedReverb !== reverb || debouncedEcho !== echo || debouncedBass !== bass || debouncedTreble !== treble) return // still settling
    if (savingRef.current) return               // a save is in flight; its completion re-checks
    if (polishSig === lastSavedSigRef.current) return // this exact polish is already stored
    const t = setTimeout(() => { void savePolish() }, 1000)
    return () => clearTimeout(t)
  }, [persistMix, fullMixState, mixedSwappedUrl, warmthRendering, debouncedWarmth, warmth, debouncedReverb, reverb, debouncedEcho, echo, debouncedBass, bass, debouncedTreble, treble, polishSig]) // eslint-disable-line react-hooks/exhaustive-deps

  // Vocals-only playback source: blends duet channels (N>1) AND/OR applies the
  // same warmth+reverb+echo as the Full-song mix, so soloing the vocal to judge
  // the effects (or just listening on the Vocals-only tab) matches Full-song and
  // the saved file — both read the same debounced values. Falls back to
  // convertedVocalsUrl directly when there's nothing to blend or polish (single
  // vocal, all controls off), keeping that common case instant instead of
  // round-tripping through mixStems.
  useEffect(() => {
    const swapVocalUrls = [
      convertedVocalsUrl,
      ...(duetUntouchedVocalsUrl ? [duetUntouchedVocalsUrl] : []),
      ...(convertedVocalsUrl2 ? [convertedVocalsUrl2] : []),
    ].filter(Boolean) as string[]

    if (swapVocalUrls.length === 0) {
      setMixedSwappedVocalsUrl(null)
      return
    }
    if (swapVocalUrls.length === 1 && debouncedWarmth === 0 && debouncedReverb === 0 && debouncedEcho === 0 && debouncedBass === 0 && debouncedTreble === 0) {
      setMixedSwappedVocalsUrl(null)
      return
    }

    let cancelled = false
    mixStems(swapVocalUrls, [], { warmth: debouncedWarmth, reverb: debouncedReverb, echo: debouncedEcho, bass: debouncedBass, treble: debouncedTreble }).then((blob) => {
      if (cancelled || !blob) return
      if (mixedSwappedVocalsRef.current) URL.revokeObjectURL(mixedSwappedVocalsRef.current)
      const url = URL.createObjectURL(blob)
      mixedSwappedVocalsRef.current = url
      setMixedSwappedVocalsUrl(url)
    }).catch(() => {})

    return () => { cancelled = true }
  }, [convertedVocalsUrl, convertedVocalsUrl2, duetUntouchedVocalsUrl, debouncedWarmth, debouncedReverb, debouncedEcho, debouncedBass, debouncedTreble]) // eslint-disable-line react-hooks/exhaustive-deps

  // Revoke all three blob URLs on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      if (mixedOriginalRef.current) URL.revokeObjectURL(mixedOriginalRef.current)
      if (mixedSwappedRef.current) URL.revokeObjectURL(mixedSwappedRef.current)
      if (mixedSwappedVocalsRef.current) URL.revokeObjectURL(mixedSwappedVocalsRef.current)
      clearTimeout(savedFlashTimerRef.current)
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
        {/* Result summary — real facts only (voice used, length, what's in the
            file). We don't compute any quality metric, so we don't show one. */}
        <div className="vs-result-top" style={{ marginBottom: '20px' }}>
          <div className="vs-result-check" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="vs-result-score-lbl">Swap complete</div>
            <div className="grad-text" style={{ fontFamily: 'var(--font-grotesk),"Space Grotesk",sans-serif', fontSize: '28px', fontWeight: 700, letterSpacing: '-0.5px', lineHeight: 1.15 }}>
              Your track is ready
            </div>
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
              {voiceName && <span className="vs-result-chip">🎤 {voiceName}</span>}
              {duration > 0 && <span className="vs-result-chip">⏱ {fmt(duration)}</span>}
              <span className="vs-result-chip">
                {fullReady ? '♫ Full mix — vocals + music' : '♫ Converted vocals'}
              </span>
            </div>
          </div>
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
            Unlike the Fine-tune panel (a paid RVC re-convert), this is Web Audio
            tone EQ (Warmth low-shelf + Bass low-shelf + Treble high-shelf) then
            convolution reverb (Reverb) then feedback delay (Echo), applied on
            BOTH the Full-song and Vocals-only tabs (and baked into the saved
            track). Hidden when there's no full mix to colour. */}
        {fullMixState !== 'no-stems' && (
          <div className="vs-polish">
            <div className="vs-polish-head">
              <span className="vs-polish-title">Polish</span>
              {warmthRendering && <span className="vs-polish-spin" />}
              {savedFlash && <span className="vs-polish-saved">Saved ✓</span>}
              <span className="vs-polish-presets">
                <button className="vs-polish-preset" onClick={() => applyPreset(RAW_PRESET)} title="Zero all polish — the bone-dry converted vocal">Raw</button>
                <button className="vs-polish-preset" onClick={() => applyPreset(STUDIO_PRESET)} title="Back to the default Studio polish">Reset to defaults</button>
              </span>
            </div>
            <div className="vs-knob-row">
              <PolishKnob
                id="warmth"
                label="Warmth"
                hint="Adds body/warmth to the vocal — drag up/down, double-click to reset"
                value={warmth}
                onChange={setWarmth}
                format={(v) => (v === 0 ? 'Off' : `+${((v / 100) * WARMTH_MAX_DB).toFixed(1)} dB`)}
              />
              <PolishKnob
                id="bass"
                label="Bass"
                hint="Low-shelf EQ (~100 Hz), −16 to +16 dB — drag up/down, double-click to reset"
                value={bass}
                onChange={setBass}
                min={-BASS_MAX_DB} max={BASS_MAX_DB}
                format={(v) => (v === 0 ? '0 dB' : `${v > 0 ? '+' : ''}${v} dB`)}
              />
              <PolishKnob
                id="treble"
                label="Treble"
                hint="High-shelf EQ (~8 kHz), −20 to +20 dB — drag up/down, double-click to reset"
                value={treble}
                onChange={setTreble}
                min={-TREBLE_MAX_DB} max={TREBLE_MAX_DB}
                format={(v) => (v === 0 ? '0 dB' : `${v > 0 ? '+' : ''}${v} dB`)}
              />
              <PolishKnob
                id="reverb"
                label="Reverb"
                hint="Adds space/room to the vocal — drag up/down, double-click to reset"
                value={reverb}
                onChange={setReverb}
                format={(v) => (v === 0 ? 'Off' : `${Math.round((v / 100) * REVERB_MAX_WET * 100)}% wet`)}
              />
              <PolishKnob
                id="echo"
                label="Echo"
                hint="Adds repeats/echo to the vocal — drag up/down, double-click to reset"
                value={echo}
                onChange={setEcho}
                format={(v) => (v === 0 ? 'Off' : `${Math.round((v / 100) * ECHO_MAX_WET * 100)}% wet`)}
              />
            </div>
            <div className="vs-polish-foot">A default <strong>Studio</strong> polish (warmth + light reverb) is applied so it doesn&rsquo;t sound dry — tap <strong>Raw</strong> for the bone-dry output, or adjust the knobs. Free · client-side · applies to both tabs &amp; baked into the saved track.</div>
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
          <ShareControl
            swapId={persistedSwapId ?? null}
            initialToken={null}
            onToast={onToast}
          />
          <button className="vs-dl-btn vs-dl-btn--outline" onClick={onNewSwap}>+ New Swap</button>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .vs-result-top { display: flex; align-items: center; gap: 20px; }
        .vs-result-score-lbl {
          font-size: 10px; font-weight: 700; letter-spacing: 2px;
          text-transform: uppercase; color: #5A5A80; margin-bottom: 4px;
        }
        .vs-result-check {
          width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0;
          background: linear-gradient(135deg, #8B5CF6, #EC4899);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 8px 24px rgba(139,92,246,.35);
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
        .vs-polish-spin {
          width: 9px; height: 9px; border-radius: 50%;
          border: 1.5px solid rgba(139,92,246,.3); border-top-color: #8B5CF6;
          animation: vsPolishSpin 0.7s linear infinite;
        }
        @keyframes vsPolishSpin { to { transform: rotate(360deg); } }
        .vs-polish-saved {
          font-size: 10px; font-weight: 700; color: #34D399;
          letter-spacing: 0.3px; animation: vsSavedFade 0.25s ease;
        }
        @keyframes vsSavedFade { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
        .vs-polish-presets { display: flex; gap: 8px; margin-left: auto; }
        .vs-polish-preset {
          border: 1px solid #2A2A4A; background: transparent; color: #7878A0;
          font-size: 10px; font-weight: 600; padding: 3px 9px; border-radius: 7px;
          cursor: pointer; transition: all 0.2s; white-space: nowrap;
        }
        .vs-polish-preset:hover { border-color: #8B5CF6; color: #C4B5FD; }
        .vs-knob-row {
          display: flex; align-items: flex-start; justify-content: center;
          gap: 24px; flex-wrap: wrap;
        }
        .vs-knob {
          display: flex; flex-direction: column; align-items: center; gap: 2px;
        }
        .vs-knob svg {
          cursor: ns-resize; touch-action: none; border-radius: 50%;
        }
        .vs-knob svg:focus-visible { outline: 2px solid #8B5CF6; outline-offset: 2px; }
        .vs-knob-label { font-size: 12px; color: #C4C4E0; }
        .vs-knob-val {
          font-size: 11px; font-weight: 600; color: #8B5CF6;
          font-variant-numeric: tabular-nums;
        }
        .vs-polish-foot { font-size: 11px; color: #5A5A80; margin-top: 8px; text-align: center; }
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
