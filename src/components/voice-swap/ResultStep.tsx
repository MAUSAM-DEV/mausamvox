'use client'

import { useEffect, useRef, useState } from 'react'
import type { StemResult } from './UploadStep'
import { encodeWav, encodeMp3, encodeMp3FromWav, SAVED_MP3_KBPS } from './audioClip'
import {
  LivePlayer, renderMix, NEUTRAL_PARAMS, BED_ROOM, type MixInputs, type MixParams, type PolishStyle,
  WARMTH_MAX_DB, BASS_MAX_DB, TREBLE_MAX_DB, REVERB_MAX_WET, ECHO_MAX_WET, LEVEL_MAX_DB, BLEND_MAX,
} from './liveMix'
import { matchPolish, type MatchedPolish } from '@/lib/polish-match'
import { keyName, type KeyEstimate } from '@/lib/audio-dsp/key-detect'
import { harmonyMode } from '@/lib/audio-dsp/harmony-mode'
import type { ShiftOptions } from '@/lib/audio-dsp/stretch'
import { dspHarmony, dspKey, dspRemoveDoubles, dspShift, dspPolishVoice, dspAirShare, dspLufs, dspMaster } from './dspClient'
import { DEFAULT_AIR_TARGET_DB } from '@/lib/audio-dsp/voice-polish'
import { clampTarget, MASTER_TARGET_FALLBACK } from '@/lib/audio-dsp/master'
import { ShareControl } from '@/components/share/ShareControl'
import { ShareVideoButton } from '@/components/share/ShareVideoButton'

type AbSide = 'Original' | 'Swapped'
type PlayMode = 'full' | 'vocals'
// Full-song mix lifecycle: needs music stems → preparing → ready, or no-stems/error.
type FullMixState = 'mixing' | 'ready' | 'error' | 'no-stems'

interface ResultStepProps {
  onNewSwap: () => void
  onToast: (msg: string) => void
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
  // Set while the result is an UNSAVED preview that can be saved as the full
  // swap without re-converting: the credits it will cost (200 − paid preview).
  previewSaveCost?: number | null
  onSavePreview?: () => void
  // Key change chosen on Configure for THIS take (semitones). The voice was
  // converted in the new key; the music (not drums) is shifted here to match.
  keyShift?: number
  // Auto-tune used for this take ('Light' / 'Strong'), shown as a chip.
  autotuneLabel?: string | null
  // The exact vocal stem(s) that were converted, in convertedVocalsUrl(2)
  // order — Voice blend mixes these (the original singer) under the new voice.
  convertedSourceUrls?: string[]
  // First save of a full swap (it runs in the background for ~a minute).
  saveStatus?: 'saving' | 'saved' | 'failed' | null
  onSaveFailed?: () => void
}

const AB_SIDES: AbSide[] = ['Original', 'Swapped']
const PLAY_MODES: { id: PlayMode; label: string }[] = [
  { id: 'full', label: 'Full song' },
  { id: 'vocals', label: 'Vocals only' },
]

// Encode a WAV mix to MP3 (320 kbps) and upload it to audio-uploads via the
// presign → PUT flow (bypasses Vercel's body limit — a full-song mix is
// large). Returns the storage path, or null on any failure.
async function uploadMixMp3(wav: Blob, filename = 'swap-full-mix.mp3'): Promise<string | null> {
  try {
    const mp3 = encodeMp3FromWav(await wav.arrayBuffer(), SAVED_MP3_KBPS)
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

// ── Default "Studio" polish preset ──────────────────────────────────────────
// New swaps START at these values so they come out finished, not bone-dry.
// "Raw" zeros all five. Tune the natural-unit constants below; they convert to
// the knobs' internal units. Studio = "Blend f" / Q i (founder, 2026-10-09):
// with the studio voice (voice-polish.ts), the music sharing 6% of the voice's
// room, glue compression, Level −2 dB and mastering to the original's loudness.
const STUDIO_WARMTH_DB = 4      // +4 dB low-shelf warmth
const STUDIO_REVERB_WET = 0.19 // 19% wet reverb (knob 38)
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

// Song-matched polish (src/lib/polish-match.ts) → knob units. Warmth/Reverb
// knobs are 0–100 of their max; Treble/Bass knobs ARE dB. Echo/Bass stay 0.
type PolishPreset = { warmth: number; reverb: number; echo: number; bass: number; treble: number }
function matchedToPreset(m: MatchedPolish): PolishPreset {
  return {
    warmth: Math.round((m.warmthDb / WARMTH_MAX_DB) * 100),
    reverb: Math.round((m.reverbWet / REVERB_MAX_WET) * 100),
    echo: 0,
    bass: 0,
    treble: m.trebleDb,
  }
}
const MATCH_SAMPLE_RATE = 22050   // enough for the 5–10 kHz band
const MATCH_MAX_SECONDS = 90      // bounds decode memory

// Decode a URL to mono at 22.05 kHz (first 90 s). null on any failure.
async function decodeForMatch(url: string): Promise<Float32Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const ctx = new OfflineAudioContext(1, 1, MATCH_SAMPLE_RATE)
    const buf = await ctx.decodeAudioData(await res.arrayBuffer())
    const n = Math.min(buf.length, MATCH_MAX_SECONDS * buf.sampleRate)
    const out = new Float32Array(n)
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c)
      for (let i = 0; i < n; i++) out[i] += ch[i] / buf.numberOfChannels
    }
    return out
  } catch { return null }
}
const RAW_PRESET = { warmth: 0, reverb: 0, echo: 0, bass: 0, treble: 0 }

// ── Voice controls (Result screen) ───────────────────────────────────────────
// Picked from the founder's "Option test" clips (2026-10-04).
const CHARACTER_MAX = 4     // Voice character: formants −4…+4 semitones
type HarmonySetting = 'off' | '2' | '4'
interface VoiceFx { level: number; blend: number; character: number; harmony: HarmonySetting; style: PolishStyle }
type VoiceLayerFx = { character: number; harmony: HarmonySetting; studio: boolean }
const DEFAULT_FX: VoiceFx = { level: -2, blend: 0, character: 0, harmony: 'off', style: 'none' }
const HALL_REVERB = 70 // Concert Hall preset: Reverb knob 70 = 35% wet

// Decode a URL to an AudioBuffer at 44.1 kHz (throws on failure) and move
// audio between AudioBuffers and plain arrays for the worker. One shared
// OfflineAudioContext decodes everything: it holds no audio hardware, so the
// several decodes an effect needs can't hit a browser's live-context limit.
let decodeCtx: OfflineAudioContext | null = null
async function decodeUrl(url: string): Promise<AudioBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch failed (${res.status})`)
  if (!decodeCtx) decodeCtx = new OfflineAudioContext(2, 1, 44100)
  return decodeCtx.decodeAudioData(await res.arrayBuffer())
}
const channelsOf = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c).slice())
function monoOf(b: AudioBuffer): Float32Array {
  const out = new Float32Array(b.length)
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < d.length; i++) out[i] += d[i] / b.numberOfChannels
  }
  return out
}
function toBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const b = new AudioBuffer({ length: channels[0].length, numberOfChannels: channels.length, sampleRate })
  channels.forEach((c, i) => b.getChannelData(i).set(c))
  return b
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
      { a: 0.30, f: 0.013, s: 0.032, c: 'rgba(157,92,255,.9)', lw: 1.8 },
      { a: 0.16, f: 0.024, s: 0.058, c: 'rgba(249,69,158,.5)', lw: 1.3 },
      { a: 0.09, f: 0.038, s: 0.085, c: 'rgba(12,199,232,.3)',  lw: 1.0 },
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
// Mouse-wheel tuning for the knobs (see PolishKnob): deltas at least this big are
// notched-wheel clicks; smaller isolated events (gap > KNOB_WHEEL_GAP_MS) count as
// one notch; continuous small deltas (trackpad / Magic Mouse) add up per step.
const KNOB_WHEEL_NOTCH_PX = 40
const KNOB_WHEEL_GAP_MS = 120
const KNOB_WHEEL_SMOOTH_PX = 20

function PolishKnob({
  id, label, hint, value, onChange, format, min = 0, max = 100, step = 1, resetTo = 0,
}: {
  id: string; label: string; hint: string; value: number
  onChange: (v: number) => void; format: (v: number) => string
  min?: number; max?: number; step?: number; resetTo?: number
}) {
  const drag = useRef<{ startY: number; startValue: number } | null>(null)
  // Mouse wheel over the knob: one notch = one step (1% on the % knobs, 1 dB on
  // Bass/Treble); wheel up = more. A native NON-passive listener so the page
  // doesn't scroll while the pointer is over the knob (React's onWheel is passive).
  const wrapRef = useRef<HTMLDivElement>(null)
  const live = useRef({ value, onChange, min, max, step })
  live.current = { value, onChange, min, max, step }
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    let acc = 0, last = 0
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const now = performance.now(), isolated = now - last > KNOB_WHEEL_GAP_MS
      last = now
      const dir = -Math.sign(e.deltaY)
      if (dir === 0) return
      let steps = 0
      if (e.deltaMode === 1) {                       // lines (Firefox): 3 lines ≈ 1 notch
        acc += -e.deltaY / 3; steps = Math.trunc(acc); acc -= steps
      } else if (e.deltaMode === 2) {                // pages
        steps = dir
      } else if (Math.abs(e.deltaY) >= KNOB_WHEEL_NOTCH_PX) {
        steps = dir * Math.max(1, Math.round(Math.abs(e.deltaY) / 100))  // classic notched wheel (~100 px)
        acc = 0
      } else if (isolated) {                         // a lone small event = one Mac mouse notch
        steps = dir; acc = 0
      } else {                                       // trackpad / Magic Mouse stream
        acc += -e.deltaY / KNOB_WHEEL_SMOOTH_PX; steps = Math.trunc(acc); acc -= steps
      }
      if (steps === 0) return
      const k = live.current
      const next = Math.max(k.min, Math.min(k.max, Math.round((k.value + steps * k.step) / k.step) * k.step))
      if (next !== k.value) k.onChange(next)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
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
    <div className="vs-knob" title={hint} ref={wrapRef}>
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
        <circle cx={c} cy={c} r={r} fill="none" stroke="#2E2E56" strokeWidth="4"
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
            <stop offset="0%" stopColor="#9D5CFF" />
            <stop offset="100%" stopColor="#F9459E" />
          </linearGradient>
        </defs>
      </svg>
      <span className="vs-knob-label">{label}</span>
      <span className="vs-knob-val">{format(value)}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ResultStep
// ---------------------------------------------------------------------------
export function ResultStep({
  onNewSwap, onToast,
  convertedVocalsUrl, convertedVocalsUrl2, stemResult, duetUntouchedVocalsUrl,
  persistMix, onFullMixReady, onPolishResave, voiceName, persistedSwapId, previewSaveCost, onSavePreview,
  keyShift = 0, autotuneLabel, convertedSourceUrls, saveStatus, onSaveFailed,
}: ResultStepProps) {
  const [ab, setAb] = useState<AbSide>('Swapped')
  const [mode, setMode] = useState<PlayMode>('full')
  // Full-song mix lifecycle (decode + key change + Original side render).
  const [fullMixState, setFullMixState] = useState<FullMixState>('mixing')
  // Character / Harmony / Blend audio being (re)made in the worker.
  const [updating, setUpdating] = useState<string | null>(null)
  // A download being rendered ('wav' | 'mp3').
  const [preparing, setPreparing] = useState<'wav' | 'mp3' | null>(null)

  // ── Live player: plays the mix graph; its state IS the button state ─────────
  const playerRef = useRef<LivePlayer | null>(null)
  if (!playerRef.current && typeof window !== 'undefined') playerRef.current = new LivePlayer()
  const player = playerRef.current
  const [, rerender] = useState(0)
  useEffect(() => {
    const p = playerRef.current
    if (!p) return
    p.onChange = () => rerender((x) => x + 1)
    return () => p.dispose()
  }, [])
  const playing = !!player?.playing
  // Playhead clock while playing: 10 updates a second from the player's own
  // clock (a timer, not animation frames — those pause in hidden tabs/panes).
  const [clock, setClock] = useState(0)
  useEffect(() => {
    if (!playing || !player) return
    setClock(player.currentTime())
    const id = setInterval(() => setClock(player.currentTime()), 100)
    return () => clearInterval(id)
  }, [playing, player])
  const currentTime = playing ? clock : (player?.currentTime() ?? 0)
  const duration = player?.duration() ?? 0

  // ── Polish knobs (instant: they move the live graph) ────────────────────────
  // Studio is the default (Diagnosis 6, 2026-10-04). The debounced copies only
  // decide when the SAVED file is refreshed — playback follows the knobs live.
  const [warmth, setWarmth] = useState(STUDIO_WARMTH)
  const [reverb, setReverb] = useState(STUDIO_REVERB)
  const [echo, setEcho] = useState(STUDIO_ECHO)
  const [bass, setBass] = useState(STUDIO_BASS)
  const [treble, setTreble] = useState(STUDIO_TREBLE)
  const applyPreset = (p: PolishPreset) => {
    setWarmth(p.warmth); setReverb(p.reverb); setEcho(p.echo); setBass(p.bass); setTreble(p.treble)
  }

  // ── Voice controls + polish style ──────────────────────────────────────────
  const [level, setLevel] = useState(DEFAULT_FX.level)
  const [blend, setBlend] = useState(DEFAULT_FX.blend)
  const [character, setCharacter] = useState(DEFAULT_FX.character)
  const [harmony, setHarmony] = useState<HarmonySetting>(DEFAULT_FX.harmony)
  const [style, setStyle] = useState<PolishStyle>(DEFAULT_FX.style)

  // Which polish is on (Match song is worked out in the background, below).
  const [polishSource, setPolishSource] = useState<'studio' | 'matched' | 'custom' | 'raw' | 'hall' | 'lofi' | 'radio'>('studio')
  // Studio voice (de-ess + compression + air): on, except after tapping Raw
  // (turning a knob afterwards keeps it off; any other preset turns it on).
  const [studioVoice, setStudioVoice] = useState(true)

  // Live: every knob move goes straight to the graph.
  const liveParams: MixParams = { warmth, bass, treble, reverb, echo, levelDb: level, blend, style, vocalsOnly: mode === 'vocals', bedRoom: BED_ROOM, glue: true }
  const liveParamsRef = useRef(liveParams)
  liveParamsRef.current = liveParams
  useEffect(() => { player?.setParams(liveParams) }, [warmth, bass, treble, reverb, echo, level, blend, style, mode]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { player?.setView({ side: ab === 'Original' ? 'original' : 'swapped', vocalsOnly: mode === 'vocals' }) }, [ab, mode, player])

  // Settled settings (for the saved file): 600 ms after the last change.
  const settingsSig = `${warmth}|${bass}|${treble}|${reverb}|${echo}|${level}|${blend}|${style}|${character}|${harmony}|${studioVoice}`
  const [settledSig, setSettledSig] = useState(settingsSig)
  useEffect(() => {
    const t = setTimeout(() => setSettledSig(settingsSig), 600)
    return () => clearTimeout(t)
  }, [settingsSig])

  // Character, Harmony and the studio voice need the worker (slower): debounce, then rebuild.
  const [voiceFx, setVoiceFx] = useState<VoiceLayerFx>({ character: DEFAULT_FX.character, harmony: DEFAULT_FX.harmony, studio: true })
  useEffect(() => {
    const t = setTimeout(() => setVoiceFx({ character, harmony, studio: studioVoice }), 280)
    return () => clearTimeout(t)
  }, [character, harmony, studioVoice])

  // ── Song-matched polish: worked out in the background, applied on tap ──────
  const [matched, setMatched] = useState<{ preset: PolishPreset; info: MatchedPolish } | null>(null)
  const userSet = (setter: (v: number) => void) => (v: number) => { setPolishSource('custom'); setter(v) }
  const originalVocalUrl = stemResult?.leadVocalsUrl || stemResult?.vocalsUrl || ''
  useEffect(() => {
    if (!convertedVocalsUrl || !originalVocalUrl) return
    let cancelled = false
    ;(async () => {
      const original = await decodeForMatch(originalVocalUrl)
      const converted = original ? await decodeForMatch(convertedVocalsUrl) : null
      if (cancelled || !original || !converted) return
      const info = matchPolish(original, converted, MATCH_SAMPLE_RATE)
      setMatched({ preset: matchedToPreset(info), info })
    })().catch(() => { /* no Match song chip */ })
    return () => { cancelled = true }
  }, [convertedVocalsUrl, originalVocalUrl])

  // ── Processed audio (key change, Character, Harmony, Blend's original) ──────
  // Made in the background worker (dspClient) and cached, so turning an
  // unrelated knob never redoes them. One cached result per group.
  const procCacheRef = useRef(new Map<string, { group: string; buf: Promise<AudioBuffer> }>())
  function cached(group: string, key: string, make: () => Promise<AudioBuffer>): Promise<AudioBuffer> {
    const cache = procCacheRef.current
    const hit = cache.get(key)
    if (hit) return hit.buf
    cache.forEach((v, k) => { if (v.group === group) cache.delete(k) })
    const buf = make()
    cache.set(key, { group, buf })
    buf.catch(() => cache.delete(key))
    return buf
  }
  const fxErrorShownRef = useRef(false)
  function fxFallback<T>(what: string, fallback: T) {
    return (err: unknown) => {
      console.error(`[voice-fx] ${what} failed:`, err)
      if (!fxErrorShownRef.current) { fxErrorShownRef.current = true; onToast(`Couldn't apply ${what} on this device — playing without it`) }
      return fallback
    }
  }

  const tonalUrls = [stemResult?.instrumentalUrl, stemResult?.bassUrl, stemResult?.otherUrl].filter((u): u is string => Boolean(u))
  const musicUrlsAll = [stemResult?.instrumentalUrl, stemResult?.bassUrl, stemResult?.drumsUrl, stemResult?.otherUrl].filter((u): u is string => Boolean(u))
  // The song's original backing vocals / chorus (lead/backing split). The swap
  // converts only the lead, so they're mixed back under it. Not for duets:
  // their stems come from the FULL vocal, so the backing is already inside.
  const backingUrl = stemResult?.leadVocalsUrl && stemResult.backingVocalsUrl && !convertedVocalsUrl2 && !duetUntouchedVocalsUrl
    ? stemResult.backingVocalsUrl
    : null
  const converted = [convertedVocalsUrl, convertedVocalsUrl2].filter((u): u is string => Boolean(u))

  const decoded = (url: string) => cached(`dec:${url}`, `dec|${url}`, () => decodeUrl(url))
  async function shiftBuffer(b: AudioBuffer, opts: ShiftOptions): Promise<AudioBuffer> {
    return toBuffer(await dspShift(channelsOf(b), b.sampleRate, opts), b.sampleRate)
  }
  // Sum buffers into one stereo buffer.
  function sum(bufs: AudioBuffer[]): AudioBuffer {
    const sr = bufs[0].sampleRate
    const len = Math.max(...bufs.map((b) => b.length))
    const out = [new Float32Array(len), new Float32Array(len)]
    for (const b of bufs) for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(Math.min(c, b.numberOfChannels - 1))
      for (let i = 0; i < d.length; i++) out[c][i] += d[i]
    }
    return toBuffer(out, sr)
  }
  // A vocal that wasn't converted (duet partner, the backing vocals, Blend's
  // original singer) moved to the take's key, formants kept.
  function inKey(url: string, decodeIt: () => Promise<AudioBuffer> = () => decodeUrl(url)): Promise<AudioBuffer> {
    if (!keyShift) return decodeIt()
    return cached(`key:${url}`, `key|${url}|${keyShift}`, async () => shiftBuffer(await decodeIt(), { semitones: keyShift, formantCompensation: true }))
  }
  // Music (+ backing vocals unless musicOnly) in the take's key; drums stay put.
  async function buildBed(opts: { musicOnly?: boolean; originalKey?: boolean } = {}): Promise<AudioBuffer | null> {
    if (musicUrlsAll.length === 0) return null
    const parts: AudioBuffer[] = []
    if (opts.originalKey || !keyShift || tonalUrls.length === 0) {
      parts.push(...await Promise.all(musicUrlsAll.map(decodeUrl)))
    } else {
      const tonal = await shiftBuffer(sum(await Promise.all(tonalUrls.map(decodeUrl))), { semitones: keyShift })
      parts.push(tonal)
      if (stemResult?.drumsUrl) parts.push(await decodeUrl(stemResult.drumsUrl))
    }
    if (backingUrl && !opts.musicOnly) {
      const raw = await decodeUrl(backingUrl)
      if (opts.originalKey) parts.push(raw) // the Original side keeps the song as it was
      else {
        // Under the swapped voice: drop the backing's same-note doubles of the
        // original lead (they sounded like a second voice — doubles.ts), keep
        // the harmonies and chorus; then move it to the take's key.
        const lead = await decoded(stemResult!.leadVocalsUrl!)
        const clean = await dspRemoveDoubles(channelsOf(raw), raw.sampleRate, monoOf(lead))
          .then((chs) => toBuffer(chs, raw.sampleRate)).catch(fxFallback('the backing clean-up', raw))
        parts.push(!keyShift ? clean : await shiftBuffer(clean, { semitones: keyShift, formantCompensation: true }).catch(fxFallback('the key change', clean)))
      }
    }
    return sum(parts)
  }

  // The song's key (from the original music), found once — for Add harmony.
  const [songKey, setSongKey] = useState<KeyEstimate | null | 'pending' | 'none'>(null)
  const songKeyRef = useRef<Promise<KeyEstimate | null> | null>(null)
  function getSongKey(): Promise<KeyEstimate | null> {
    if (!songKeyRef.current) {
      setSongKey('pending')
      songKeyRef.current = (async () => {
        if (tonalUrls.length === 0) return null
        const key = await dspKey(monoOf(sum(await Promise.all(tonalUrls.map(decodeUrl)))), 44100)
        console.log('[voice-fx] song key', keyName(key), key)
        return key
      })().catch((err) => { console.error('[voice-fx] key detection failed:', err); return null })
      songKeyRef.current.then((k) => setSongKey(k ?? 'none'))
    }
    return songKeyRef.current
  }
  const shiftedKey = (k: KeyEstimate | null) => (k ? { ...k, tonic: (((k.tonic + keyShift) % 12) + 12) % 12 } : null)

  // Studio voice target: the ORIGINAL lead's share of air (voice-polish.ts),
  // so each song's voice gets as bright as its own singer was.
  const airTargetRef = useRef<Promise<number> | null>(null)
  function airTarget(): Promise<number> {
    const leadUrl = stemResult?.leadVocalsUrl || stemResult?.vocalsUrl
    airTargetRef.current ??= (async () => {
      if (!leadUrl) return DEFAULT_AIR_TARGET_DB
      const lead = await decoded(leadUrl)
      const v = await dspAirShare(monoOf(lead), lead.sampleRate)
      console.log('[voice-fx] original lead air share', v.toFixed(1), 'dB')
      return Number.isFinite(v) && v > -60 ? v : DEFAULT_AIR_TARGET_DB
    })().catch(() => DEFAULT_AIR_TARGET_DB)
    return airTargetRef.current
  }
  // The converted voice with the studio voice applied (or as it came, for Raw).
  function baseVoice(url: string, studio: boolean): Promise<AudioBuffer> {
    if (!studio) return decoded(url)
    return cached(`pol:${url}`, `pol|${url}`, async () => {
      const v = await decoded(url)
      return toBuffer([await dspPolishVoice(monoOf(v), v.sampleRate, await airTarget())], v.sampleRate)
    }).catch(fxFallback('the studio voice', null)).then((b) => b ?? decoded(url))
  }

  // Voices (studio voice + Character applied) and harmony layers for these settings.
  async function voiceLayers(fx: VoiceLayerFx): Promise<{ voices: AudioBuffer[]; harmony: AudioBuffer[] }> {
    const voices = await Promise.all(converted.map(async (url) => fx.character
      ? cached(`char:${url}`, `char|${url}|${fx.character}|${fx.studio}`, async () => shiftBuffer(await baseVoice(url, fx.studio), { formantSemitones: fx.character }))
        .catch(fxFallback('voice character', null)).then((b) => b ?? baseVoice(url, fx.studio))
      : baseVoice(url, fx.studio)))
    const harmonyBufs = fx.harmony === 'off' ? [] : (await Promise.all(converted.map((url) => {
      const n = fx.harmony === '4' ? 4 : 2
      return cached(`harm:${url}`, `harm|${url}|${n}|${fx.character}|${fx.studio}`, async () => {
        const key = shiftedKey(await getSongKey())
        const v = await baseVoice(url, fx.studio)
        const { stem } = await dspHarmony(monoOf(v), v.sampleRate, n, key, fx.character)
        return toBuffer([stem], v.sampleRate)
      }).catch(fxFallback('harmony', null))
    }))).filter((b): b is AudioBuffer => b !== null)
    return { voices, harmony: harmonyBufs }
  }

  // ── Mastering (master.ts): as loud as the uploaded song, peaks at −1 dBFS ──
  // Target = the upload's loudness. The gain is found on the pre-master mix
  // for the settled settings; the live player uses it with the same limiter.
  const targetRef = useRef<Promise<number> | null>(null)
  function masterTarget(): Promise<number> {
    targetRef.current ??= (async () => {
      const path = stemResult?.storagePath
      if (!path) return MASTER_TARGET_FALLBACK
      const res = await fetch('/api/upload-stem/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
      if (!res.ok) return MASTER_TARGET_FALLBACK
      const { url } = await res.json()
      const song = await decodeUrl(url)
      const l = await dspLufs(channelsOf(song), song.sampleRate)
      console.log('[master] uploaded song loudness', l.toFixed(1), 'LUFS → target', clampTarget(l).toFixed(1))
      return clampTarget(l)
    })().catch(() => MASTER_TARGET_FALLBACK)
    return targetRef.current
  }
  // Mastered swapped mix for these settings (+ its gain), cached per settings
  // and audio; Vocals-only renders use the full mix's gain.
  const bufIdsRef = useRef({ ids: new WeakMap<AudioBuffer, number>(), next: 1 })
  const bufId = (b: AudioBuffer | null) => {
    if (!b) return 0
    const r = bufIdsRef.current
    if (!r.ids.has(b)) r.ids.set(b, r.next++)
    return r.ids.get(b)!
  }
  const masterCacheRef = useRef<{ key: string; result: Promise<{ gain: number; buf: AudioBuffer }> } | null>(null)
  function masteredMix(params: MixParams): Promise<{ gain: number; buf: AudioBuffer }> {
    const full = { ...params, vocalsOnly: false }
    const inp = inputsRef.current!
    // Blend's original singer only changes the mix when Blend is up.
    const audioKey = [...inp.voices, ...inp.harmony, inp.partner, inp.bed, ...(full.blend > 0 ? inp.originals : [])].map(bufId).join(',')
    const key = `${JSON.stringify(full)}|${audioKey}`
    if (masterCacheRef.current?.key === key) return masterCacheRef.current.result
    const result = (async () => {
      const pre = await renderMix(inp, full)
      const { gain, channels } = await dspMaster(channelsOf(pre), pre.sampleRate, await masterTarget())
      return { gain, buf: toBuffer(channels, pre.sampleRate) }
    })()
    masterCacheRef.current = { key, result }
    result.catch(() => { if (masterCacheRef.current?.result === result) masterCacheRef.current = null })
    return result
  }
  async function masterWithGain(pre: AudioBuffer, gain: number): Promise<AudioBuffer> {
    const { channels } = await dspMaster(channelsOf(pre), pre.sampleRate, 0, gain)
    return toBuffer(channels, pre.sampleRate)
  }

  // Current swapped-side inputs (what plays AND what gets saved).
  const inputsRef = useRef<MixInputs | null>(null)
  function setInputs(next: MixInputs) {
    inputsRef.current = next
    player?.setSwapped(next)
  }

  // ── Build everything when a new converted vocal arrives ─────────────────────
  // Re-arms saving: a new take is saved as a first save (new row + its own
  // music-only backing), even if the settings are unchanged.
  const persistedRef = useRef(false)
  const lastSavedSigRef = useRef<string | null>(null)
  const savingRef = useRef(false)
  const saveRetriesRef = useRef(0)
  useEffect(() => {
    if (!convertedVocalsUrl || !stemResult?.vocalsUrl) return
    persistedRef.current = false
    lastSavedSigRef.current = null
    savingRef.current = false
    let cancelled = false
    setFullMixState('mixing')
    const mixStart = performance.now()
    ;(async () => {
      // 1. The voice first, so "Vocals only" can play while the music is prepared.
      const [layers, partner] = await Promise.all([
        voiceLayers(voiceFx),
        duetUntouchedVocalsUrl ? inKey(duetUntouchedVocalsUrl).catch(fxFallback('the key change', null)) : Promise.resolve(null),
      ])
      if (cancelled) return
      setInputs({ ...layers, partner, originals: [], bed: null })
      if (musicUrlsAll.length === 0) {
        // No music stems — Full song is impossible; save the vocal (null path).
        setFullMixState('no-stems'); setMode('vocals')
        persistedRef.current = true
        if (persistMix) onFullMixReady?.(null)
        return
      }
      // 2. Music + backing in the take's key, and the Original side.
      const bed = await buildBed()
      const leadUrl = stemResult.leadVocalsUrl || stemResult.vocalsUrl
      const lead = await decoded(leadUrl)
      const originalBed = keyShift ? await buildBed({ originalKey: true }) : bed
      const originalPre = await renderMix({ voices: [lead], harmony: [], partner: null, originals: [], bed: originalBed }, NEUTRAL_PARAMS)
      if (cancelled) return
      setInputs({ ...inputsRef.current!, bed })
      // Mastering: the swapped side's gain, and the Original side mastered to
      // the same loudness so the A/B compare is fair.
      const [{ gain }, originalFull] = await Promise.all([
        masteredMix(liveParamsRef.current),
        masterTarget().then((t) => dspMaster(channelsOf(originalPre), originalPre.sampleRate, t)).then((m) => toBuffer(m.channels, originalPre.sampleRate)),
      ])
      if (cancelled) return
      player?.setMasterGain(gain)
      player?.setOriginal(originalFull, lead)
      setFullMixState('ready')
      console.log(`[timing] stage=mix ms=${Math.round(performance.now() - mixStart)}`)
      // 3. Blend's original singer(s), ready in the background so Blend is instant.
      const originals = await Promise.all((convertedSourceUrls ?? []).filter(Boolean).map((u) => inKey(u, () => decoded(u))))
        .catch(fxFallback('voice blend', [] as AudioBuffer[]))
      if (!cancelled && inputsRef.current) setInputs({ ...inputsRef.current, originals })
    })().catch((err) => {
      if (cancelled) return
      console.error('[result] mix preparation failed:', err)
      setFullMixState('error'); setMode('vocals')
      persistedRef.current = true
      if (persistMix) onFullMixReady?.(null)
    })
    return () => { cancelled = true }
  }, [convertedVocalsUrl, stemResult?.vocalsUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Character / Harmony changed → rebuild those layers (old sound keeps playing
  // until the new one is ready, then continues from the same moment).
  const voiceFxInitRef = useRef(true)
  useEffect(() => {
    if (voiceFxInitRef.current) { voiceFxInitRef.current = false; return }
    if (!inputsRef.current) return
    let cancelled = false
    setUpdating(voiceFx.harmony !== 'off' ? 'Updating harmony…' : 'Updating voice…')
    voiceLayers(voiceFx)
      .then((layers) => { if (!cancelled && inputsRef.current) setInputs({ ...inputsRef.current, ...layers }) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setUpdating(null) })
    return () => { cancelled = true }
  }, [voiceFx.character, voiceFx.harmony, voiceFx.studio]) // eslint-disable-line react-hooks/exhaustive-deps

  // Settled knobs → new mastering gain for live playback (the swapped mix's
  // loudness moved; the master brings it back to the target).
  useEffect(() => {
    if (fullMixState !== 'ready' || updating || settledSig !== settingsSig || !inputsRef.current?.bed) return
    let cancelled = false
    masteredMix(liveParamsRef.current)
      .then(({ gain }) => { if (!cancelled) player?.setMasterGain(gain) })
      .catch((err) => console.error('[master] failed:', err))
    return () => { cancelled = true }
  }, [settledSig, settingsSig, fullMixState, updating]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Saved track = offline render of the same graph with the settled settings
  const settledParams = (): MixParams => liveParams.vocalsOnly ? { ...liveParams, vocalsOnly: false } : liveParams
  const savedFlashTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const [savedFlash, setSavedFlash] = useState(false)
  const settledSigRef = useRef(settledSig)
  settledSigRef.current = settledSig
  async function savePolish() {
    if (savingRef.current || !inputsRef.current?.bed) return
    const sig = settledSigRef.current
    if (sig === lastSavedSigRef.current) return
    const firstSave = lastSavedSigRef.current === null
    savingRef.current = true
    let saved = false
    const uploadStart = performance.now()
    try {
      const { buf: mix, gain } = await masteredMix(settledParams())
      const mixPath = await uploadMixMp3(encodeWav(mix))
      if (!mixPath) {
        saved = false
      } else if (firstSave) {
        // Music-only backing (Perform Live / Sing along), in the take's key —
        // built + uploaded ONCE on the first save. Strictly best-effort.
        let instrumentalPath: string | null | undefined
        try {
          const music = await buildBed({ musicOnly: true })
          if (music) instrumentalPath = await uploadMixMp3(encodeWav(await masterWithGain(await renderMix({ voices: [], harmony: [], partner: null, originals: [], bed: music }, NEUTRAL_PARAMS), gain)), 'swap-instrumental.mp3')
        } catch { /* row just won't offer the music-only backing */ }
        console.log(`[timing] stage=upload ms=${Math.round(performance.now() - uploadStart)}`)
        onFullMixReady?.(mixPath, instrumentalPath)
        saved = true
      } else {
        const ok = await onPolishResave?.(mixPath)
        saved = ok !== false
      }
    } catch {
      saved = false
    }
    savingRef.current = false
    if (saved) {
      saveRetriesRef.current = 0
      lastSavedSigRef.current = sig
      setSavedFlash(true)
      clearTimeout(savedFlashTimerRef.current)
      savedFlashTimerRef.current = setTimeout(() => setSavedFlash(false), 2200)
      if (settledSigRef.current !== sig) void savePolish()
    } else if (firstSave) {
      // A failed FIRST save: retry twice, then say so.
      if (saveRetriesRef.current < 2) { saveRetriesRef.current++; setTimeout(() => { void savePolish() }, 3000) }
      else { onToast("Couldn't save your track — check your connection. Change any knob to try again, or download it now."); onSaveFailed?.() }
    }
  }
  // Keep the SAVED track in sync with the settled settings (first run inserts
  // the row; later changes UPDATE it — no re-conversion, no credits).
  useEffect(() => {
    if (!persistMix || persistedRef.current) return
    if (fullMixState !== 'ready' || updating) return
    if (settledSig !== settingsSig || character !== voiceFx.character || harmony !== voiceFx.harmony || studioVoice !== voiceFx.studio) return
    if (savingRef.current || settledSig === lastSavedSigRef.current) return
    const t = setTimeout(() => { void savePolish() }, 1000)
    return () => clearTimeout(t)
  }, [persistMix, fullMixState, updating, settledSig, settingsSig, voiceFx]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(savedFlashTimerRef.current), [])

  // ── Player controls ─────────────────────────────────────────────────────────
  const fullReady = fullMixState === 'ready'
  function handleSelectSide(side: AbSide) {
    if (side !== ab) setAb(side)
  }
  function handleSelectMode(m: PlayMode) {
    if (m === mode) return
    if (m === 'full' && !fullReady) return
    setMode(m)
  }
  // Waveform: click or drag (mouse or finger) to seek; while dragging the
  // shading follows the finger and the song jumps there on release. (The
  // separate slider bar under it was removed, 2026-10-09.)
  const [scrub, setScrub] = useState<number | null>(null)
  const fracAt = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }
  const seekProps = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => { if (!duration) return; e.currentTarget.setPointerCapture(e.pointerId); setScrub(fracAt(e)) },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => { if (scrub !== null) setScrub(fracAt(e)) },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => { if (scrub === null) return; player?.seek(fracAt(e) * duration); setScrub(null) },
    onPointerCancel: () => setScrub(null),
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      const to = e.key === 'ArrowRight' ? currentTime + 5 : e.key === 'ArrowLeft' ? currentTime - 5 : e.key === 'Home' ? 0 : e.key === 'End' ? duration : null
      if (to === null || !player) return
      e.preventDefault(); player.seek(to)
    },
  }

  // Downloads: the same graph offline, mastered (Original side: its own render).
  async function renderForDownload(): Promise<AudioBuffer | null> {
    if (!player) return null
    if (ab === 'Original') return mode === 'vocals' ? player.original.vocals : player.original.full
    if (!inputsRef.current) return null
    const full = await masteredMix(liveParams)
    if (mode !== 'vocals' || !inputsRef.current.bed) return full.buf
    return masterWithGain(await renderMix(inputsRef.current, liveParams), full.gain)
  }
  async function handleDownload(kind: 'wav' | 'mp3') {
    setPreparing(kind)
    try {
      const buf = await renderForDownload()
      if (!buf) { onToast('Nothing to download yet'); return }
      const blob = kind === 'wav' ? encodeWav(buf) : encodeMp3(buf, SAVED_MP3_KBPS)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `voice-swap-${ab.toLowerCase()}-${mode === 'full' ? 'mix' : 'vocals'}.${kind}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      onToast(kind === 'wav' ? `Downloading ${ab} ${mode === 'full' ? 'mix' : 'vocals'} (WAV)…` : 'MP3 downloaded!')
    } catch (err) {
      console.error('[download] failed:', err)
      onToast('Download failed — try again')
    } finally {
      setPreparing(null)
    }
  }

  function fmt(t: number) {
    const s = Math.max(0, Math.round(t))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  const fullMixing = mode === 'full' && fullMixState === 'mixing'
  const canPlay = !!player?.canPlay()
  const progress = duration ? currentTime / duration : 0
  // What the bar shows: the drag position while scrubbing, else playback.
  const shown = scrub ?? progress
  const shownTime = scrub !== null ? scrub * duration : currentTime

  return (
    <>
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
            <div className="grad-text vs-result-title" style={{ fontFamily: 'var(--font-grotesk),"Space Grotesk",sans-serif', fontSize: '28px', fontWeight: 700, letterSpacing: '-0.5px', lineHeight: 1.15 }}>
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
              {!canPlay ? (
                <div className="vs-mix-note vs-mix-note--err">
                  {ab === 'Original' && fullMixState === 'mixing' ? 'Preparing the original…' : `No audio available for ${ab} / ${mode === 'full' ? 'Full song' : 'Vocals only'}.`}
                </div>
              ) : (
                <>
                  <div
                    className="vs-wave-container"
                    role="slider" tabIndex={0} aria-label="Song position"
                    aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(shownTime)} aria-valuetext={fmt(shownTime)}
                    {...seekProps}
                  >
                    <PlayerWaveCanvas playing={playing} />
                    <div className="vs-wave-played" style={{ width: `${shown * 100}%` }} />
                    <div className="vs-playhead" style={{ left: `${shown * 100}%` }} />
                  </div>
                  <div className="vs-player-controls">
                    <span className="vs-time">{fmt(shownTime)}</span>
                    <button className="vs-play-btn" onClick={() => player?.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
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
        {/* Voice — free, client-side changes to the swapped voice (level, blend
            with the original singer, character, harmony). Same pipeline as
            Polish: both tabs + baked into the saved track. */}
        {fullMixState !== 'no-stems' && (
          <div className="vs-polish">
            <div className="vs-polish-head">
              <span className="vs-polish-title">Voice</span>
              {updating && <span className="vs-updating"><span className="vs-polish-spin" /> {updating} <span className="vs-updating-sub">(still playing the previous sound)</span></span>}
              <span className="vs-polish-presets">
                {keyShift !== 0 && <span className="vs-fx-chip" title="Set on the Configure step — the voice was converted in this key and the music (not drums) is shifted to match">Key {keyShift > 0 ? '+' : ''}{keyShift}</span>}
                {autotuneLabel && <span className="vs-fx-chip" title="Set on the Configure step">Auto-tune · {autotuneLabel}</span>}
                <button className="vs-polish-preset" onClick={() => { setLevel(DEFAULT_FX.level); setBlend(0); setCharacter(0); setHarmony('off') }} title="Back to the default voice settings">Reset</button>
              </span>
            </div>
            <div className="vs-knob-row">
              <PolishKnob
                id="level"
                label="Level"
                hint="Vocal level against the music, −9 to +9 dB — drag up/down, double-click to reset"
                value={level}
                onChange={setLevel}
                min={-LEVEL_MAX_DB} max={LEVEL_MAX_DB} resetTo={DEFAULT_FX.level}
                format={(v) => (v === 0 ? '0 dB' : `${v > 0 ? '+' : ''}${v} dB`)}
              />
              {(convertedSourceUrls?.length ?? 0) > 0 && (
                <PolishKnob
                  id="blend"
                  label="Blend"
                  hint="Mix in the original singer under your voice, 0–50% — drag up/down, double-click to reset"
                  value={blend}
                  onChange={setBlend}
                  max={BLEND_MAX}
                  format={(v) => (v === 0 ? 'Off' : `${v}% original`)}
                />
              )}
              <PolishKnob
                id="character"
                label="Character"
                hint="Deeper ↔ brighter voice, same notes — drag up/down, double-click to reset"
                value={character}
                onChange={setCharacter}
                min={-CHARACTER_MAX} max={CHARACTER_MAX}
                format={(v) => (v === 0 ? 'Natural' : v < 0 ? `Deeper ${-v}` : `Brighter ${v}`)}
              />
            </div>
            <div className="vs-harm-row">
              <span className="vs-harm-lbl">Add harmony</span>
              {(['off', '2', '4'] as HarmonySetting[]).map((h) => (
                <button key={h} className={`vs-polish-preset${harmony === h ? ' vs-polish-preset--on' : ''}`} onClick={() => setHarmony(h)}>
                  {h === 'off' ? 'Off' : `${h} voices`}
                </button>
              ))}
            </div>
            <div className="vs-polish-foot">
              {harmony !== 'off' && (
                songKey === 'pending' || songKey === null ? <>Finding the song&rsquo;s key…{' '}</>
                : songKey === 'none' ? <>Harmony: <strong>octaves</strong> (couldn&rsquo;t read the key, so it stays safe).{' '}</>
                : harmonyMode(shiftedKey(songKey)) === 'scale'
                ? <>Harmony: <strong>{harmony === '4' ? 'a 3rd and a 5th above, an octave below' : 'a 3rd above'}</strong>, following the {keyName(shiftedKey(songKey)!)} scale so every note is in key.{' '}</>
                : <>Harmony: <strong>octaves</strong> — {shiftedKey(songKey)!.mode === 'minor' ? `the song is in ${keyName(shiftedKey(songKey)!)}` : 'the key isn’t clear enough for thirds'}, so octaves keep it from sounding off.{' '}</>
              )}
              Level and Blend are instant; Character and Harmony take a few seconds. Free · applies to both tabs &amp; baked into the saved track.
            </div>
          </div>
        )}

        {fullMixState !== 'no-stems' && (
          <div className="vs-polish">
            <div className="vs-polish-head">
              <span className="vs-polish-title">Polish</span>
              {savedFlash && <span className="vs-polish-saved">Saved ✓</span>}
              <span className="vs-polish-presets">
                {matched && (
                  <button className={`vs-polish-preset${polishSource === 'matched' ? ' vs-polish-preset--on' : ''}`} onClick={() => { setPolishSource('matched'); setStudioVoice(true); setStyle('none'); applyPreset(matched.preset) }} title="Warmth, treble and reverb matched to the original singer's vocal">Match song</button>
                )}
                <button className={`vs-polish-preset${polishSource === 'studio' ? ' vs-polish-preset--on' : ''}`} onClick={() => { setPolishSource('studio'); setStudioVoice(true); setStyle('none'); applyPreset(STUDIO_PRESET) }} title="The standard Studio polish (smooth voice with air, warmth, shared room)">Studio</button>
                <button className={`vs-polish-preset${polishSource === 'hall' ? ' vs-polish-preset--on' : ''}`} onClick={() => { setPolishSource('hall'); setStudioVoice(true); setStyle('hall'); applyPreset({ ...STUDIO_PRESET, reverb: HALL_REVERB }) }} title="A big concert-hall reverb on the voice">Concert Hall</button>
                <button className={`vs-polish-preset${polishSource === 'lofi' ? ' vs-polish-preset--on' : ''}`} onClick={() => { setPolishSource('lofi'); setStudioVoice(true); setStyle('lofi'); applyPreset(STUDIO_PRESET) }} title="Warm, worn, band-limited sound — colours the whole song">Lo-fi</button>
                <button className={`vs-polish-preset${polishSource === 'radio' ? ' vs-polish-preset--on' : ''}`} onClick={() => { setPolishSource('radio'); setStudioVoice(true); setStyle('radio'); applyPreset(STUDIO_PRESET) }} title="Narrow, punchy old-radio sound — colours the whole song">Radio</button>
                <button className={`vs-polish-preset${polishSource === 'raw' ? ' vs-polish-preset--on' : ''}`} onClick={() => { setPolishSource('raw'); setStudioVoice(false); setStyle('none'); applyPreset(RAW_PRESET) }} title="No polish — the bone-dry converted vocal (still mastered)">Raw</button>
              </span>
            </div>
            <div className="vs-knob-row">
              <PolishKnob
                id="warmth"
                label="Warmth"
                hint="Adds body/warmth to the vocal — drag up/down, double-click to reset"
                value={warmth}
                onChange={userSet(setWarmth)}
                format={(v) => (v === 0 ? 'Off' : `+${((v / 100) * WARMTH_MAX_DB).toFixed(1)} dB`)}
              />
              <PolishKnob
                id="bass"
                label="Bass"
                hint="Low-shelf EQ (~100 Hz), −16 to +16 dB — drag up/down, double-click to reset"
                value={bass}
                onChange={userSet(setBass)}
                min={-BASS_MAX_DB} max={BASS_MAX_DB}
                format={(v) => (v === 0 ? '0 dB' : `${v > 0 ? '+' : ''}${v} dB`)}
              />
              <PolishKnob
                id="treble"
                label="Treble"
                hint="High-shelf EQ (~8 kHz), −20 to +20 dB — drag up/down, double-click to reset"
                value={treble}
                onChange={userSet(setTreble)}
                min={-TREBLE_MAX_DB} max={TREBLE_MAX_DB}
                format={(v) => (v === 0 ? '0 dB' : `${v > 0 ? '+' : ''}${v} dB`)}
              />
              <PolishKnob
                id="reverb"
                label="Reverb"
                hint="Adds space/room to the vocal — drag up/down, double-click to reset"
                value={reverb}
                onChange={userSet(setReverb)}
                format={(v) => (v === 0 ? 'Off' : `${Math.round((v / 100) * REVERB_MAX_WET * 100)}% wet`)}
              />
              <PolishKnob
                id="echo"
                label="Echo"
                hint="Adds repeats/echo to the vocal — drag up/down, double-click to reset"
                value={echo}
                onChange={userSet(setEcho)}
                format={(v) => (v === 0 ? 'Off' : `${Math.round((v / 100) * ECHO_MAX_WET * 100)}% wet`)}
              />
            </div>
            <div className="vs-polish-foot">
              {polishSource === 'matched' && matched
                ? <>Polish <strong>matched to this song</strong> from the original singer&rsquo;s vocal — warmth +{matched.info.warmthDb} dB, treble {matched.info.trebleDb > 0 ? '+' : ''}{matched.info.trebleDb} dB, {Math.round(matched.info.reverbWet * 100)}% reverb. Tap <strong>Studio</strong> for the standard polish or <strong>Raw</strong> for the dry voice.</>
                : style === 'hall'
                ? <><strong>Concert Hall</strong> — a big hall reverb on the voice.</>
                : style === 'lofi'
                ? <><strong>Lo-fi</strong> — the whole song gets a warm, worn, band-limited sound.</>
                : style === 'radio'
                ? <><strong>Radio</strong> — the whole song gets a narrow, punchy old-radio sound.</>
                : polishSource === 'raw'
                ? <><strong>Raw</strong> — the converted voice as it came, no polish (the song is still mastered to the original&rsquo;s loudness).</>
                : <>A default <strong>Studio</strong> polish: a smoothed voice with its top-end &ldquo;air&rdquo; restored, warmth, a room shared with the music — mastered to the original song&rsquo;s loudness. Tap <strong>Raw</strong> for the bone-dry voice, or adjust the knobs.</>}
              {' '}Instant · free · applies to both tabs &amp; baked into the saved track.
            </div>
          </div>
        )}


        {/* Unsaved preview → save it as the full swap (no re-conversion) */}
        {previewSaveCost != null && onSavePreview && (
          <div className="vs-save-preview">
            <div className="vs-save-preview-txt">
              <strong>This is a preview — not saved yet.</strong> Like it? Save this exact take as your full swap —
              no re-conversion{previewSaveCost < 200 ? <>, and the {200 - previewSaveCost} cr you paid for the preview counts toward it</> : null}.
            </div>
            <button className="vs-save-preview-btn" onClick={onSavePreview}>💾 Save as full swap · {previewSaveCost} cr</button>
          </div>
        )}

        {/* First save: it takes about a minute — say so, so nobody looks in
            Saved Tracks too early (2026-10-09 live test). */}
        {saveStatus && (
          <div className={`vs-save-status vs-save-status--${saveStatus}`} role="status">
            {saveStatus === 'saving' && <><span className="vs-polish-spin" /> Saving to your library… about a minute. You can keep listening; please keep this page open.</>}
            {saveStatus === 'saved' && <>✓ Saved to your library · <a href="/swaps">Open Saved Tracks</a></>}
            {saveStatus === 'failed' && <>Couldn&rsquo;t save this track — download it now, or change any knob to try again.</>}
          </div>
        )}

        {/* Download / Share */}
        <div className="vs-dl-row">
          <button
            className="vs-dl-btn vs-dl-btn--primary"
            onClick={() => { void handleDownload('wav') }}
            disabled={fullMixing || !canPlay || preparing !== null}
          >
            {fullMixing
              ? '⏳ Mixing…'
              : preparing === 'wav'
                ? '⏳ Preparing…'
                : mode === 'full'
                  ? `↓ ${ab} Mix (WAV)`
                  : `↓ ${ab} Vocals`}
          </button>
          <button
            className="vs-dl-btn vs-dl-btn--outline"
            onClick={() => { void handleDownload('mp3') }}
            disabled={fullMixing || !canPlay || preparing !== null}
            title="Download as 320 kbps MP3"
          >
            {preparing === 'mp3' ? '⏳ Encoding…' : `↓ MP3`}
          </button>
          <ShareControl
            swapId={persistedSwapId ?? null}
            initialToken={null}
            onToast={onToast}
          />
          <ShareVideoButton
            swapId={persistedSwapId ?? null}
            songName={stemResult?.fileName?.replace(/\.[^.]+$/, '') ?? 'My track'}
            onToast={onToast}
          />
          <button className="vs-dl-btn vs-dl-btn--outline" onClick={onNewSwap}>+ New Swap</button>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .vs-result-top { display: flex; align-items: center; gap: 20px; }
        .vs-result-score-lbl {
          font-size: 10px; font-weight: 700; letter-spacing: 2px;
          text-transform: uppercase; color: #8E8EB4; margin-bottom: 4px;
        }
        .vs-result-check {
          width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0;
          background: linear-gradient(135deg, #9D5CFF, #F9459E);
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 8px 24px rgba(157,92,255,.35);
        }
        .vs-result-chip {
          padding: 3px 10px; border-radius: 999px;
          background: rgba(16,185,129,.08); border: 1px solid rgba(16,185,129,.2);
          font-size: 11px; font-weight: 600; color: #10B981;
        }
        .vs-player {
          background: #0E0E20; border: 1px solid #2E2E56;
          border-radius: 12px; overflow: hidden; margin-bottom: 14px;
        }
        .vs-player-tabs { display: flex; align-items: center; border-bottom: 1px solid #2E2E56; padding: 0 4px; }
        .vs-toggle-group { display: flex; }
        .vs-toggle-spacer { flex: 1; }
        .vs-ptab {
          padding: 8px 14px; border: none; background: transparent;
          font-size: 11px; font-weight: 500; color: #8E8EB4;
          cursor: pointer; transition: all 0.2s; position: relative;
        }
        .vs-ptab:hover:not(:disabled) { color: #F0F0FF; }
        .vs-ptab:disabled { color: #3A3A55; cursor: not-allowed; }
        .vs-ptab--active { color: #F0F0FF; font-weight: 600; }
        .vs-ptab--active::after {
          content: ''; position: absolute; bottom: 0; left: 4px; right: 4px;
          height: 2px; background: linear-gradient(135deg,#9D5CFF,#F9459E,#0CC7E8);
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
          border-top-color: #9D5CFF;
          border-right-color: #F9459E;
          animation: vs-spin 0.8s linear infinite;
        }
        @keyframes vs-spin { to { transform: rotate(360deg); } }
        .vs-mixing-title {
          font-size: 14px; font-weight: 600; color: #C4C4E0; margin-bottom: 3px;
        }
        .vs-mixing-sub { font-size: 11px; color: #8E8EB4; line-height: 1.5; }

        /* Mix note (fallback/error) */
        .vs-mix-note {
          font-size: 11px; color: #F59E0B; background: rgba(245,158,11,.06);
          border-bottom: 1px solid rgba(245,158,11,.15); padding: 8px 14px;
        }
        .vs-mix-note--err { color: #F87171; background: rgba(248,113,113,.06); border-bottom-color: rgba(248,113,113,.15); }

        .vs-wave-container { position: relative; cursor: pointer; touch-action: none; }
        .vs-wave-container:focus-visible { outline: 2px solid #9D5CFF; outline-offset: 2px; border-radius: 4px; }
        .vs-playhead {
          position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px;
          background: rgba(255,255,255,.9); pointer-events: none; z-index: 3;
        }
        .vs-wave-played { position: absolute; top: 0; bottom: 0; left: 0; background: rgba(157,92,255,.14); pointer-events: none; z-index: 1; }
        .vs-player-controls {
          display: flex; align-items: center; justify-content: space-between;
          padding: 4px 14px 10px;
        }
        .vs-time { font-size: 11px; color: #8E8EB4; font-variant-numeric: tabular-nums; }
        .vs-play-btn {
          width: 32px; height: 32px; border-radius: 50%; border: none;
          background: linear-gradient(135deg,#9D5CFF,#F9459E);
          color: #fff; font-size: 12px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.2s; box-shadow: 0 4px 12px rgba(157,92,255,.4);
        }
        .vs-play-btn:hover { transform: scale(1.1); box-shadow: 0 6px 18px rgba(157,92,255,.5); }
        .vs-polish {
          background: #0E0E20; border: 1px solid #2E2E56; border-radius: 10px;
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
          border: 1.5px solid rgba(157,92,255,.3); border-top-color: #9D5CFF;
          animation: vsPolishSpin 0.7s linear infinite;
        }
        @keyframes vsPolishSpin { to { transform: rotate(360deg); } }
        .vs-updating { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #C4B5FD; margin-left: 8px; }
        .vs-updating-sub { color: #8E8EB4; }
        .vs-polish-saved {
          font-size: 10px; font-weight: 700; color: #34D399;
          letter-spacing: 0.3px; animation: vsSavedFade 0.25s ease;
        }
        @keyframes vsSavedFade { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } }
        .vs-polish-presets { display: flex; gap: 8px; margin-left: auto; }
        .vs-polish-preset {
          border: 1px solid #3C3C6A; background: transparent; color: #A0A0C8;
          font-size: 10px; font-weight: 600; padding: 3px 9px; border-radius: 7px;
          cursor: pointer; transition: all 0.2s; white-space: nowrap;
        }
        .vs-polish-preset:hover { border-color: #9D5CFF; color: #C4B5FD; }
        .vs-polish-preset--on { border-color: #9D5CFF; color: #F0F0FF; background: rgba(157,92,255,.18); }
        .vs-polish-presets { flex-wrap: wrap; justify-content: flex-end; }
        .vs-fx-chip {
          font-size: 10px; font-weight: 600; padding: 3px 9px; border-radius: 7px; white-space: nowrap;
          color: #34D399; background: rgba(16,185,129,.08); border: 1px solid rgba(16,185,129,.25);
        }
        .vs-harm-row { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
        .vs-harm-lbl { font-size: 12px; color: #C4C4E0; margin-right: 4px; }
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
        .vs-knob svg:focus-visible { outline: 2px solid #9D5CFF; outline-offset: 2px; }
        .vs-knob-label { font-size: 12px; color: #C4C4E0; }
        .vs-knob-val {
          font-size: 11px; font-weight: 600; color: #9D5CFF;
          font-variant-numeric: tabular-nums;
        }
        .vs-polish-foot { font-size: 11px; color: #8E8EB4; margin-top: 8px; text-align: center; }
        .vs-save-preview {
          display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
          padding: 12px 14px; margin-bottom: 14px; border-radius: 10px;
          background: rgba(157,92,255,.08); border: 1px solid rgba(157,92,255,.35);
        }
        .vs-save-preview-txt { font-size: 12px; color: #C4C4E0; line-height: 1.5; flex: 1 1 260px; }
        .vs-save-preview-txt strong { color: #F0F0FF; }
        .vs-save-preview-btn {
          padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer;
          background: linear-gradient(135deg,#9D5CFF,#F9459E); color: #fff; font-size: 13px; font-weight: 700;
        }
        .vs-save-status {
          display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
          padding: 10px 14px; margin-bottom: 14px; border-radius: 10px; font-size: 12px; line-height: 1.5;
        }
        .vs-save-status--saving { color: #C4B5FD; background: rgba(157,92,255,.08); border: 1px solid rgba(157,92,255,.3); }
        .vs-save-status--saved { color: #34D399; background: rgba(16,185,129,.07); border: 1px solid rgba(16,185,129,.25); }
        .vs-save-status--saved a { color: #F0F0FF; font-weight: 600; }
        .vs-save-status--failed { color: #F87171; background: rgba(248,113,113,.06); border: 1px solid rgba(248,113,113,.25); }
        .vs-dl-row { display: flex; gap: 8px; flex-wrap: wrap; }
        .vs-dl-btn {
          padding: 10px 20px; border-radius: 8px;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.25s;
        }
        .vs-dl-btn--primary {
          background: linear-gradient(135deg,#9D5CFF,#F9459E,#0CC7E8);
          border: none; color: #fff; flex: 1; min-width: 120px;
        }
        .vs-dl-btn--primary:hover:not(:disabled) { box-shadow: 0 8px 24px rgba(157,92,255,.4); transform: translateY(-1px); }
        .vs-dl-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .vs-dl-btn--outline {
          background: transparent; border: 1px solid #3C3C6A; color: #C4C4E0;
        }
        .vs-dl-btn--outline:hover { border-color: #9D5CFF; color: #9D5CFF; }

        /* Phones: finger-sized controls, rows that wrap, nothing wider than the screen */
        @media (max-width: 600px) {
          .vs-result-top { gap: 12px; }
          .vs-result-check { width: 42px; height: 42px; }
          .vs-result-title { font-size: 22px !important; }
          .vs-player-tabs { flex-wrap: wrap; }
          .vs-ptab { padding: 12px 14px; font-size: 13px; }
          .vs-play-btn { width: 48px; height: 48px; font-size: 16px; }
          .vs-polish { padding: 12px 10px; }
          .vs-polish-head { flex-wrap: wrap; gap: 8px; }
          .vs-polish-presets { width: 100%; justify-content: flex-start; margin-left: 0; gap: 6px; }
          .vs-polish-preset { font-size: 12px; padding: 8px 12px; min-height: 36px; border-radius: 9px; }
          .vs-fx-chip { font-size: 11px; padding: 8px 10px; }
          .vs-knob-row { gap: 10px 4px; justify-content: space-around; }
          .vs-knob { min-width: 30%; }
          .vs-knob svg { width: 64px; height: 64px; }
          .vs-knob-label { font-size: 13px; }
          .vs-knob-val { font-size: 12px; }
          .vs-harm-row { gap: 6px; }
          .vs-harm-lbl { width: 100%; text-align: center; margin: 0 0 2px; }
          .vs-save-preview-btn { width: 100%; padding: 12px 16px; font-size: 14px; }
          .vs-dl-row { gap: 8px; }
          .vs-dl-btn { flex: 1 1 calc(50% - 8px); padding: 12px 10px; min-height: 44px; }
          .vs-dl-btn--primary { flex-basis: 100%; }
        }

      `}</style>
    </>
  )
}
