// Voice Swap's mix as ONE Web Audio graph, used two ways:
//  • live — LivePlayer plays it in an AudioContext; knob changes move the
//    graph's parameters while the song plays (no re-render, no file swap);
//  • offline — renderMix builds the SAME graph in an OfflineAudioContext with
//    the same settings and returns the PRE-MASTER mix; the saved / downloaded
//    file is that mix mastered by audio-dsp/master.ts (gain + look-ahead
//    limiter) — live, the same gain and the same limiter run as an AudioWorklet.
// Same nodes + same settings + seeded reverb noise → the saved file sounds
// like what was heard. Every node is always present; a control at its neutral
// value is transparent (a 0 dB shelf is unity, a 0% wet send adds nothing).
//
// Signal flow (per the previous offline mixer, mixStems in ResultStep):
//   voices ×g(1−blend) ┐
//   originals ×g·blend ├→ vocal bus (×1.3 makeup × Level) → Warmth → Bass → Treble
//   harmony/partner ×g ┘     → reverb (dry 1−w | Studio room or Concert Hall) → echo
//   music+backing ×0.8 → [glue compressor] (+ a touch of the voice's room) ─┐
//   → [clean | Lo-fi | Radio] → ×0.62 = PRE-MASTER
//   → master gain → limiter (−1 dBFS) → out   (g = 1/√N for N main vocals)

import { LIMITER_WORKLET, MASTER_CEILING_DB, MASTER_LOOKAHEAD_S, MASTER_RELEASE_S } from '@/lib/audio-dsp/master'

export type PolishStyle = 'none' | 'hall' | 'lofi' | 'radio'

export interface MixParams {
  warmth: number    // knob 0–100 → 0…WARMTH_MAX_DB low-shelf
  bass: number      // dB
  treble: number    // dB
  reverb: number    // knob 0–100 → 0…REVERB_MAX_WET
  echo: number      // knob 0–100 → 0…ECHO_MAX_WET
  levelDb: number   // Vocal level
  blend: number     // Voice blend, % original singer (0–BLEND_MAX)
  style: PolishStyle
  vocalsOnly: boolean
  bedRoom: number   // share of the voice's Studio room on the music (0–1) — "shared room"
  glue: boolean     // gentle compression of the MUSIC (never the voice — it costs the singer's identity)
}

export interface MixInputs {
  voices: AudioBuffer[]          // the converted voice(s), Character applied
  harmony: AudioBuffer[]         // added harmony voices
  partner: AudioBuffer | null    // duet: the singer that wasn't converted
  originals: AudioBuffer[]       // Voice blend: the original singer(s), in the take's key
  bed: AudioBuffer | null        // music + backing vocals, in the take's key
}

export const NEUTRAL_PARAMS: MixParams = { warmth: 0, bass: 0, treble: 0, reverb: 0, echo: 0, levelDb: 0, blend: 0, style: 'none', vocalsOnly: false, bedRoom: 0, glue: false }
// Blend f (founder's pick, 2026-10-09): the music gets 6% of the voice's room.
export const BED_ROOM = 0.06

export const WARMTH_FREQ_HZ = 200
export const WARMTH_MAX_DB = 10
export const BASS_FREQ_HZ = 100
export const TREBLE_FREQ_HZ = 8000
export const BASS_MAX_DB = 16
export const TREBLE_MAX_DB = 20
export const REVERB_MAX_WET = 0.5
const REVERB_IR_SECONDS = 1.8
const REVERB_IR_DECAY = 2.5
export const ECHO_MAX_WET = 0.5
// Low cut on every reverb's return (2026-10-10 sound study): the rooms were
// full-range noise, so they piled reverb onto the voice's low end and the
// music's bass and kick — part of the muddiness.
const REVERB_LOW_CUT_HZ = 250
// Glue (music only), made much gentler (2026-10-10): the old −24 dB / 1.8:1
// halved the song's loudness range (7.7 → ~4 LU) and tilted it toward bass.
const GLUE_THRESHOLD_DB = -18
const GLUE_RATIO = 1.3
const GLUE_KNEE_DB = 12
const ECHO_DELAY_S = 0.3
const ECHO_FEEDBACK = 0.35
const ECHO_DAMP_HZ = 3500
const HALL_IR_SECONDS = 3.2
const HALL_IR_DECAY = 1.6
const HALL_PREDELAY_S = 0.04
export const LEVEL_MAX_DB = 9
export const BLEND_MAX = 50
// The separated-then-converted vocal sits low against the music; lift it.
const VOCAL_MAKEUP = 1.3
const MUSIC_GAIN = 0.8
const BUTTERWORTH_Q_DB = -3.01 // Web Audio low/high-pass Q is in dB; −3.01 dB = Q 0.707
// Level before mastering: the ×0.7 headroom × 0.89 trim of the old final
// stage. The music's glue sees the music at that same level (as when tuned).
const PRE_MASTER_GAIN = 0.7 * 0.89
// Fallback limiter when AudioWorklet isn't available (old browsers only): the
// previous Web Audio compressor settings.
const FALLBACK_LIMIT_DB = -3
const SMOOTH_S = 0.02 // knob moves glide over ~20 ms (no clicks)

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// Reverb impulse: decaying noise from a SEEDED generator, so the live graph
// and the saved-file render use the identical room.
function impulse(ctx: BaseAudioContext, seconds: number, decay: number, seed: number): AudioBuffer {
  const length = Math.max(1, Math.round(ctx.sampleRate * seconds))
  const buf = ctx.createBuffer(2, length, ctx.sampleRate)
  let s = seed >>> 0
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < length; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / length, decay)
  }
  return buf
}

function bitcrushCurve(bits: number): Float32Array<ArrayBuffer> {
  const n = 65536, steps = 2 ** (bits - 1), curve = new Float32Array(n)
  for (let i = 0; i < n; i++) curve[i] = Math.round(((i / (n - 1)) * 2 - 1) * steps) / steps
  return curve
}

export class MixGraph {
  private ctx: BaseAudioContext
  private live: boolean
  readonly voiceIn: GainNode
  readonly blendIn: GainNode
  readonly extraIn: GainNode
  readonly bedIn: GainNode
  private vocalBus: GainNode
  private warmthF: BiquadFilterNode
  private bassF: BiquadFilterNode
  private trebleF: BiquadFilterNode
  private revDry: GainNode
  private roomWet: GainNode
  private hallWet: GainNode
  private echoDry: GainNode
  private echoWet: GainNode
  private clean: GainNode
  private lofi: GainNode
  private radio: GainNode
  private bedRoomWet: GainNode
  private glueOn: GainNode
  private glueOff: GainNode
  private masterGain: GainNode | null = null
  private hasOriginals = false
  private params: MixParams

  // `master`: live playback adds the master gain + limiter after the
  // pre-master mix (worklet = the 'mvx-limiter' processor is loaded in ctx);
  // offline renders stop at the pre-master mix.
  constructor(ctx: BaseAudioContext, params: MixParams, out: AudioNode = ctx.destination, master_: { worklet: boolean; gain: number } | null = null) {
    this.ctx = ctx
    this.live = !(ctx instanceof OfflineAudioContext)
    this.params = params
    const gain = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g }
    const filter = (type: BiquadFilterType, f: number) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.gain.value = 0; return b }

    this.voiceIn = gain(); this.blendIn = gain(0); this.extraIn = gain(); this.bedIn = gain(MUSIC_GAIN)
    this.vocalBus = gain(VOCAL_MAKEUP)
    this.voiceIn.connect(this.vocalBus); this.blendIn.connect(this.vocalBus); this.extraIn.connect(this.vocalBus)

    // Tone (linear shelves — order doesn't matter), then the time effects.
    this.warmthF = filter('lowshelf', WARMTH_FREQ_HZ)
    this.bassF = filter('lowshelf', BASS_FREQ_HZ)
    this.trebleF = filter('highshelf', TREBLE_FREQ_HZ)
    this.vocalBus.connect(this.warmthF); this.warmthF.connect(this.bassF); this.bassF.connect(this.trebleF)

    // Reverb: dry + Studio room OR Concert Hall (pre-delayed long hall).
    const echoIn = gain()
    this.revDry = gain(); this.roomWet = gain(0); this.hallWet = gain(0)
    const room = ctx.createConvolver(); room.buffer = impulse(ctx, REVERB_IR_SECONDS, REVERB_IR_DECAY, 1)
    const hall = ctx.createConvolver(); hall.buffer = impulse(ctx, HALL_IR_SECONDS, HALL_IR_DECAY, 2)
    const pre = ctx.createDelay(1); pre.delayTime.value = HALL_PREDELAY_S
    this.trebleF.connect(this.revDry); this.revDry.connect(echoIn)
    const lowCut = () => { const f = filter('highpass', REVERB_LOW_CUT_HZ); f.Q.value = BUTTERWORTH_Q_DB; return f }
    const roomCut = lowCut(), hallCut = lowCut()
    this.trebleF.connect(room); room.connect(roomCut); roomCut.connect(this.roomWet); this.roomWet.connect(echoIn)
    this.trebleF.connect(pre); pre.connect(hall); hall.connect(hallCut); hallCut.connect(this.hallWet); this.hallWet.connect(echoIn)

    // Echo: feedback delay, each repeat darker (tape-echo style).
    const styleIn = gain()
    this.echoDry = gain(); this.echoWet = gain(0)
    const delay = ctx.createDelay(1); delay.delayTime.value = ECHO_DELAY_S
    const damp = filter('lowpass', ECHO_DAMP_HZ)
    const fb = gain(ECHO_FEEDBACK)
    echoIn.connect(this.echoDry); this.echoDry.connect(styleIn)
    echoIn.connect(delay); delay.connect(damp); damp.connect(fb); fb.connect(delay)
    delay.connect(this.echoWet); this.echoWet.connect(styleIn)
    // Glue on the MUSIC only (2026-10-09): on the whole mix it squeezed the
    // voice too and moved it toward the original singer (speaker similarity
    // lead +0.149 → +0.085). Same settings, fed at the level it was tuned on.
    const bed = gain()
    const glue = ctx.createDynamicsCompressor()
    glue.threshold.value = GLUE_THRESHOLD_DB; glue.knee.value = GLUE_KNEE_DB; glue.ratio.value = GLUE_RATIO; glue.attack.value = 0.03; glue.release.value = 0.25
    const glueInLevel = gain(PRE_MASTER_GAIN), glueOutLevel = gain(1 / PRE_MASTER_GAIN)
    this.glueOn = gain(0); this.glueOff = gain(1)
    this.bedIn.connect(glueInLevel); glueInLevel.connect(glue); glue.connect(glueOutLevel); glueOutLevel.connect(this.glueOn); this.glueOn.connect(bed)
    this.bedIn.connect(this.glueOff); this.glueOff.connect(bed)
    bed.connect(styleIn)
    // Shared room: the music through the voice's Studio room (its own copy).
    const bedRoom = ctx.createConvolver(); bedRoom.buffer = impulse(ctx, REVERB_IR_SECONDS, REVERB_IR_DECAY, 1)
    this.bedRoomWet = gain(0)
    const bedRoomCut = lowCut()
    bed.connect(bedRoom); bedRoom.connect(bedRoomCut); bedRoomCut.connect(this.bedRoomWet); this.bedRoomWet.connect(styleIn)

    // Pre-master, then — live only — the master
    // gain and the look-ahead limiter.
    const premaster = gain(PRE_MASTER_GAIN)
    const master = premaster
    if (!master_) premaster.connect(out)
    else {
      this.masterGain = gain(master_.gain)
      premaster.connect(this.masterGain)
      let limiter: AudioNode
      if (master_.worklet) {
        limiter = new AudioWorkletNode(ctx, 'mvx-limiter', {
          numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
          processorOptions: { ceilingDb: MASTER_CEILING_DB, lookaheadS: MASTER_LOOKAHEAD_S, releaseS: MASTER_RELEASE_S },
        })
      } else {
        const c = ctx.createDynamicsCompressor()
        c.threshold.value = FALLBACK_LIMIT_DB; c.knee.value = 0; c.ratio.value = 20; c.attack.value = 0.002; c.release.value = 0.1
        limiter = c
      }
      this.masterGain.connect(limiter); limiter.connect(out)
    }
    // Whole-mix colour: clean, Lo-fi or Radio (one path open at a time).
    this.clean = gain(1); styleIn.connect(this.clean); this.clean.connect(master)
    const band = (lo: number, hi: number, input: AudioNode) => {
      const hp = filter('highpass', lo), lp = filter('lowpass', hi)
      hp.Q.value = BUTTERWORTH_Q_DB; lp.Q.value = BUTTERWORTH_Q_DB
      input.connect(hp); hp.connect(lp); return lp
    }
    // Lo-fi: 250 Hz–3.8 kHz, 25% 12-bit crunch, 25 ms slap-back, squashed.
    this.lofi = gain(0); styleIn.connect(this.lofi)
    const lofiBand = band(250, 3800, this.lofi)
    const crush = ctx.createWaveShaper(); crush.curve = bitcrushCurve(12)
    const lofiSum = gain(), lofiDry = gain(0.75), lofiWet = gain(0.25)
    lofiBand.connect(lofiDry); lofiDry.connect(lofiSum); lofiBand.connect(crush); crush.connect(lofiWet); lofiWet.connect(lofiSum)
    const slap = ctx.createDelay(0.1); slap.delayTime.value = 0.025
    const slapGain = gain(0.19)
    lofiSum.connect(slap); slap.connect(slapGain)
    const lofiComp = ctx.createDynamicsCompressor()
    lofiComp.threshold.value = -8; lofiComp.knee.value = 0; lofiComp.ratio.value = 12; lofiComp.attack.value = 0.003; lofiComp.release.value = 0.1
    lofiSum.connect(lofiComp); slapGain.connect(lofiComp)
    const lofiOut = gain(1.4); lofiComp.connect(lofiOut); lofiOut.connect(master)
    // Radio: 400 Hz–3.5 kHz, heavy compression.
    this.radio = gain(0); styleIn.connect(this.radio)
    const radioBand = band(400, 3500, this.radio)
    const radioComp = ctx.createDynamicsCompressor()
    radioComp.threshold.value = -22; radioComp.knee.value = 3; radioComp.ratio.value = 6; radioComp.attack.value = 0.005; radioComp.release.value = 0.08
    radioBand.connect(radioComp)
    const radioOut = gain(2); radioComp.connect(radioOut); radioOut.connect(master)

    this.set(params)
  }

  // Apply settings: glides in a live context, exact values offline.
  set(p: MixParams) {
    this.params = p
    const t = this.ctx.currentTime
    const to = (param: AudioParam, v: number) => {
      if (this.live) param.setTargetAtTime(v, t, SMOOTH_S)
      else param.value = v
    }
    const b = this.hasOriginals ? clamp(p.blend, 0, BLEND_MAX) / 100 : 0
    to(this.voiceIn.gain, 1 - b)
    to(this.blendIn.gain, b)
    to(this.vocalBus.gain, VOCAL_MAKEUP * Math.pow(10, clamp(p.levelDb, -LEVEL_MAX_DB, LEVEL_MAX_DB) / 20))
    to(this.warmthF.gain, (clamp(p.warmth, 0, 100) / 100) * WARMTH_MAX_DB)
    to(this.bassF.gain, clamp(p.bass, -BASS_MAX_DB, BASS_MAX_DB))
    to(this.trebleF.gain, clamp(p.treble, -TREBLE_MAX_DB, TREBLE_MAX_DB))
    const rw = (clamp(p.reverb, 0, 100) / 100) * REVERB_MAX_WET
    to(this.revDry.gain, 1 - rw)
    to(this.roomWet.gain, p.style === 'hall' ? 0 : rw)
    to(this.hallWet.gain, p.style === 'hall' ? rw : 0)
    const ew = (clamp(p.echo, 0, 100) / 100) * ECHO_MAX_WET
    to(this.echoDry.gain, 1 - ew)
    to(this.echoWet.gain, ew)
    to(this.bedIn.gain, p.vocalsOnly ? 0 : MUSIC_GAIN)
    to(this.bedRoomWet.gain, clamp(p.bedRoom, 0, 1))
    to(this.glueOn.gain, p.glue ? 1 : 0)
    to(this.glueOff.gain, p.glue ? 0 : 1)
    to(this.clean.gain, p.style === 'lofi' || p.style === 'radio' ? 0 : 1)
    to(this.lofi.gain, p.style === 'lofi' ? 1 : 0)
    to(this.radio.gain, p.style === 'radio' ? 1 : 0)
  }

  // Master gain (live): glides so a new loudness setting never jumps.
  setMasterGain(g: number) {
    if (!this.masterGain) return
    if (this.live) this.masterGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.3)
    else this.masterGain.gain.value = g
  }

  // Start every input buffer at `when`, from `offset` seconds into the song.
  // Returns the sources (stop them to stop playback).
  start(inputs: MixInputs, when: number, offset: number): AudioBufferSourceNode[] {
    const main = inputs.voices.length + (inputs.partner ? 1 : 0)
    const g = 1 / Math.sqrt(Math.max(1, main))
    const hadOriginals = this.hasOriginals
    this.hasOriginals = inputs.originals.length > 0
    if (hadOriginals !== this.hasOriginals) this.set(this.params)
    const sources: AudioBufferSourceNode[] = []
    const play = (buf: AudioBuffer, dest: AudioNode, gainValue: number) => {
      if (offset >= buf.duration) return
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      const gn = this.ctx.createGain(); gn.gain.value = gainValue
      src.connect(gn); gn.connect(dest)
      src.start(when, offset)
      src.onended = () => { try { gn.disconnect() } catch { /* already gone */ } }
      sources.push(src)
    }
    inputs.voices.forEach((b) => play(b, this.voiceIn, g))
    inputs.harmony.forEach((b) => play(b, this.extraIn, g))
    if (inputs.partner) play(inputs.partner, this.extraIn, g)
    inputs.originals.forEach((b) => play(b, this.blendIn, g))
    if (inputs.bed) play(inputs.bed, this.bedIn, 1)
    return sources
  }
}

export function mixDuration(inputs: MixInputs): number {
  return Math.max(0, ...[...inputs.voices, ...inputs.harmony, ...inputs.originals, inputs.partner, inputs.bed]
    .filter((b): b is AudioBuffer => b !== null).map((b) => b.duration))
}

// The saved / downloaded file BEFORE mastering: the same graph, rendered
// offline up to the pre-master point (ResultStep masters it — master.ts).
export async function renderMix(inputs: MixInputs, params: MixParams, sampleRate = 44100): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(mixDuration(inputs) * sampleRate))
  const ctx = new OfflineAudioContext(2, length, sampleRate)
  const graph = new MixGraph(ctx, params)
  graph.start(inputs, 0, 0)
  return ctx.startRendering()
}

// The look-ahead limiter worklet (master.ts), loaded once per context.
// false = AudioWorklet unavailable → MixGraph falls back to a compressor.
const limiterLoads = new WeakMap<BaseAudioContext, Promise<boolean>>()
export function loadLimiter(ctx: BaseAudioContext): Promise<boolean> {
  let p = limiterLoads.get(ctx)
  if (!p) {
    p = (async () => {
      if (!ctx.audioWorklet) return false
      const url = URL.createObjectURL(new Blob([LIMITER_WORKLET], { type: 'application/javascript' }))
      try { await ctx.audioWorklet.addModule(url); return true }
      catch (err) { console.warn('[mix] limiter worklet unavailable — using the fallback limiter:', err); return false }
      finally { URL.revokeObjectURL(url) }
    })()
    limiterLoads.set(ctx, p)
  }
  return p
}

// ---------------------------------------------------------------------------
// Live playback. Playing state lives HERE (not in browser media events), so
// the Play/Pause button always shows the truth.
// ---------------------------------------------------------------------------
export type PlayerView = { side: 'swapped' | 'original'; vocalsOnly: boolean }

export class LivePlayer {
  private ctx: AudioContext | null = null
  private graph: MixGraph | null = null
  private sources: AudioBufferSourceNode[] = []
  private originalOut: GainNode | null = null
  private startCtxTime = 0
  private startOffset = 0
  private offset = 0
  private token = 0
  playing = false
  view: PlayerView = { side: 'swapped', vocalsOnly: false }
  swapped: MixInputs | null = null
  original: { full: AudioBuffer | null; vocals: AudioBuffer | null } = { full: null, vocals: null }
  params: MixParams = NEUTRAL_PARAMS
  masterGain = 1        // mastering gain for the swapped side (ResultStep sets it)
  private worklet = false
  onChange: () => void = () => {}

  duration(): number {
    if (this.view.side === 'original') {
      const b = this.view.vocalsOnly ? this.original.vocals : this.original.full
      return b?.duration ?? 0
    }
    return this.swapped ? mixDuration(this.swapped) : 0
  }

  currentTime(): number {
    if (!this.playing || !this.ctx) return this.offset
    return Math.min(this.duration(), this.startOffset + (this.ctx.currentTime - this.startCtxTime))
  }

  canPlay(): boolean {
    return this.view.side === 'original'
      ? !!(this.view.vocalsOnly ? this.original.vocals : this.original.full)
      : !!this.swapped
  }

  async play() {
    if (this.playing || !this.canPlay()) return
    if (!this.ctx) this.ctx = new AudioContext()
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.worklet = await loadLimiter(this.ctx)
    if (this.playing) return
    if (this.offset >= this.duration() - 0.05) this.offset = 0
    this.startSources(this.offset)
    this.playing = true
    this.onChange()
  }

  pause() {
    if (!this.playing) return
    this.offset = this.currentTime()
    this.stopSources()
    this.playing = false
    this.onChange()
  }

  toggle() { if (this.playing) this.pause(); else void this.play() }

  seek(t: number) {
    const to = clamp(t, 0, this.duration())
    if (this.playing) { this.stopSources(); this.startSources(to) } else this.offset = to
    this.onChange()
  }

  setParams(p: MixParams) {
    this.params = p
    this.graph?.set(p)
  }

  setMasterGain(g: number) {
    this.masterGain = g
    this.graph?.setMasterGain(g)
  }

  // New audio for the swapped side (Character / Harmony / Blend ready):
  // carries on from the same moment.
  setSwapped(inputs: MixInputs) {
    this.swapped = inputs
    if (this.playing && this.view.side === 'swapped') this.restart()
    this.onChange()
  }

  setOriginal(full: AudioBuffer | null, vocals: AudioBuffer | null) {
    this.original = { full, vocals }
    if (this.playing && this.view.side === 'original') this.restart()
    this.onChange()
  }

  setView(v: PlayerView) {
    const sideChanged = v.side !== this.view.side || (v.side === 'original' && v.vocalsOnly !== this.view.vocalsOnly)
    this.view = v
    // Swapped Full ↔ Vocals only is a parameter (music on/off) — no restart.
    this.setParams({ ...this.params, vocalsOnly: v.vocalsOnly })
    if (sideChanged && this.playing) this.restart()
    this.onChange()
  }

  dispose() {
    this.stopSources()
    this.playing = false
    void this.ctx?.close()
    this.ctx = null
    this.graph = null
  }

  private restart() {
    const t = this.currentTime()
    this.stopSources()
    this.startSources(t)
  }

  private startSources(offset: number) {
    const ctx = this.ctx!
    const when = ctx.currentTime + 0.03
    const token = ++this.token
    if (this.view.side === 'swapped' && this.swapped) {
      if (!this.graph) this.graph = new MixGraph(ctx, { ...this.params, vocalsOnly: this.view.vocalsOnly }, ctx.destination, { worklet: this.worklet, gain: this.masterGain })
      this.sources = this.graph.start(this.swapped, when, offset)
    } else {
      const buf = this.view.vocalsOnly ? this.original.vocals : this.original.full
      if (!this.originalOut) { this.originalOut = ctx.createGain(); this.originalOut.connect(ctx.destination) }
      this.sources = []
      if (buf && offset < buf.duration) {
        const src = ctx.createBufferSource(); src.buffer = buf; src.connect(this.originalOut); src.start(when, offset)
        this.sources.push(src)
      }
    }
    this.startCtxTime = when
    this.startOffset = offset
    // End of song: stop and rewind (ignored if playback was restarted since).
    const longest = this.sources.reduce<AudioBufferSourceNode | null>((a, s) => (!a || (s.buffer?.duration ?? 0) > (a.buffer?.duration ?? 0) ? s : a), null)
    if (longest) {
      const prev = longest.onended
      longest.onended = (e) => {
        if (typeof prev === 'function') prev.call(longest, e)
        if (token !== this.token || !this.playing) return
        this.stopSources(); this.playing = false; this.offset = 0; this.onChange()
      }
    } else {
      this.playing = false
    }
  }

  private stopSources() {
    this.token++
    for (const s of this.sources) { try { s.stop() } catch { /* not started */ } }
    this.sources = []
  }
}
