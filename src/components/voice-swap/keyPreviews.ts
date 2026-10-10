// Compare keys (Configure → Song Key): three ~15 s chorus previews of the swap
// in three keys, so the user can pick the one that sounds most like them.
// Browser side: pick the chorus, cut + upload the lead excerpt, start the
// three conversions (/api/key-compare), wait (lib/poll), then mix each with
// the same 15 s of music in its key through the Result screen's default
// chain (studio voice, Studio polish, mastering) — what you hear is what the
// full swap will sound like.

import { encodeWav } from './audioClip'
import { renderMix, type MixInputs } from './liveMix'
import { DEFAULT_MIX_PARAMS } from './ResultStep'
import { dspAirShare, dspMaster, dspPolishVoice, dspRemoveDoubles, dspShift } from './dspClient'
import { pollUntil, PollError } from '@/lib/poll'
import { KEY_COMPARE_SECONDS, songTag } from '@/lib/key-compare-shared'
import { MASTER_TARGET_FALLBACK } from '@/lib/audio-dsp/master'
import { KEY_SHIFT_MAX } from './ConfigStep'

const SR = 44100

export interface KeyPreview { key: number; isAuto: boolean; buffer: AudioBuffer }
export class KeyCompareLimit extends Error { constructor(public retryAfterSecs: number) { super('limit') } }

// What a comparison needs from the page.
export interface KeyCompareSources {
  trackKey: string            // the upload's storage path
  voiceId: string
  autoKey: number             // the Auto Song Key for this song + voice
  octaveShift: number         // auto octave match applied to the voice
  pitchShift: number          // the Pitch Shift control
  autotune: number            // 0…1
  leadUrl: string
  backingUrl?: string
  hqInstrumentalUrl?: string  // studio-quality split: the one instrumental
  bassUrl?: string; drumsUrl?: string; otherUrl?: string
}

// Auto, Auto −2, Auto +2 inside ±KEY_SHIFT_MAX; near the edge the outer
// option moves inward (e.g. Auto −3 → −4 / −3 / −1), always three keys.
export function keyTriple(auto: number): number[] {
  const inRange = (k: number) => Math.max(-KEY_SHIFT_MAX, Math.min(KEY_SHIFT_MAX, k))
  const keys = new Set([inRange(auto - 2), auto, inRange(auto + 2)])
  for (let d = 1; keys.size < 3 && d <= 2 * KEY_SHIFT_MAX; d++) {
    for (const k of [auto - d, auto + d]) if (keys.size < 3 && Math.abs(k) <= KEY_SHIFT_MAX) keys.add(k)
  }
  return Array.from(keys).sort((a, b) => a - b)
}

async function decode(url: string): Promise<AudioBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Couldn't load the song's audio (${res.status})`)
  return new OfflineAudioContext(2, 1, SR).decodeAudioData(await res.arrayBuffer())
}
const channels = (b: AudioBuffer) => Array.from({ length: b.numberOfChannels }, (_, c) => b.getChannelData(c).slice())
const mono = (b: AudioBuffer) => { const o = new Float32Array(b.length); for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) o[i] += d[i] / b.numberOfChannels } return o }
const toBuffer = (chs: Float32Array[]) => { const b = new AudioBuffer({ length: chs[0].length, numberOfChannels: chs.length, sampleRate: SR }); chs.forEach((c, i) => b.getChannelData(i).set(c)); return b }
function slice(b: AudioBuffer, start: number, seconds: number): AudioBuffer {
  const a = Math.min(b.length, Math.round(start * b.sampleRate)), n = Math.max(1, Math.min(b.length - a, Math.round(seconds * b.sampleRate)))
  const out = new AudioBuffer({ length: n, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate })
  for (let c = 0; c < b.numberOfChannels; c++) out.getChannelData(c).set(b.getChannelData(c).subarray(a, a + n))
  return out
}
const sum = (bufs: AudioBuffer[]) => {
  const len = Math.max(...bufs.map((b) => b.length)), o = [new Float32Array(len), new Float32Array(len)]
  for (const b of bufs) for (let c = 0; c < 2; c++) { const d = b.getChannelData(Math.min(c, b.numberOfChannels - 1)); for (let i = 0; i < d.length; i++) o[c][i] += d[i] }
  return toBuffer(o)
}
const shift = async (b: AudioBuffer, semitones: number, formantCompensation = false) =>
  semitones ? toBuffer(await dspShift(channels(b), SR, { semitones, formantCompensation })) : b

// The chorus: the 15 s where the lead AND the backing vocals are strongest
// (1 s steps); without backing vocals, the loudest 15 s of the lead.
export function pickChorus(lead: AudioBuffer, backing: AudioBuffer | null, seconds = KEY_COMPARE_SECONDS): number {
  const rmsPerSecond = (b: AudioBuffer) => {
    const m = mono(b), out: number[] = []
    for (let s = 0; (s + 1) * SR <= m.length; s++) { let e = 0; for (let i = s * SR; i < (s + 1) * SR; i++) e += m[i] * m[i]; out.push(Math.sqrt(e / SR)) }
    return out
  }
  const L = rmsPerSecond(lead), B = backing ? rmsPerSecond(backing) : null
  const sorted = [...L].sort((a, b) => a - b), sung = sorted[Math.floor(sorted.length * 0.4)] ?? 0 // "singing" threshold
  let best = 0, bestScore = -1
  for (let s = 0; s + seconds <= L.length; s++) {
    let active = 0, lead = 0, back = 0
    for (let k = s; k < s + seconds; k++) { if (L[k] > sung) active++; lead += L[k]; back += B?.[k] ?? 0 }
    const score = B ? (active / seconds) * back : lead
    if (score > bestScore) { bestScore = score; best = s }
  }
  return best
}

async function uploadExcerpt(excerpt: AudioBuffer, trackKey: string): Promise<string> {
  const presign = await fetch('/api/upload-stem/presign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: `keycmp-${songTag(trackKey)}.wav`, contentType: 'audio/wav' }),
  })
  const p = await presign.json().catch(() => ({}))
  if (!presign.ok || !p.uploadUrl) throw new Error(p.error ?? "Couldn't prepare the excerpt")
  const put = await fetch(p.uploadUrl, { method: 'PUT', body: encodeWav(excerpt), headers: { 'Content-Type': 'audio/wav', 'x-upsert': 'false' } })
  if (!put.ok) throw new Error("Couldn't upload the excerpt")
  return p.path as string
}

// The whole comparison. `onStage` reports progress for the UI.
export async function makeKeyPreviews(src: KeyCompareSources, onStage?: (s: string) => void): Promise<KeyPreview[]> {
  const keys = keyTriple(src.autoKey)
  onStage?.('Finding the chorus')
  const [lead, backing] = await Promise.all([decode(src.leadUrl), src.backingUrl ? decode(src.backingUrl).catch(() => null) : Promise.resolve(null)])
  const start = pickChorus(lead, backing)
  const leadEx = slice(lead, start, KEY_COMPARE_SECONDS)
  const backEx = backing ? slice(backing, start, KEY_COMPARE_SECONDS) : null

  onStage?.('Converting')
  const excerptPath = await uploadExcerpt(leadEx, src.trackKey)
  const res = await fetch('/api/key-compare', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ excerptPath, trackKey: src.trackKey, voiceId: src.voiceId, autotune: src.autotune,
      pitches: keys.map((k) => Math.max(-24, Math.min(24, Math.round(src.octaveShift + src.pitchShift + k)))) }),
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 429) throw new KeyCompareLimit(Number(data.retryAfterSecs) || 3600)
  if (!res.ok || !Array.isArray(data.predictionIds)) throw new Error(data.error ?? `The previews didn't start (${res.status})`)

  // Music for the same 15 s (decoded once, cut, the full song dropped).
  const music = await (async () => {
    if (src.hqInstrumentalUrl) return { tonal: slice(await decode(src.hqInstrumentalUrl), start, KEY_COMPARE_SECONDS), drums: null }
    const cut = async (u?: string) => (u ? slice(await decode(u), start, KEY_COMPARE_SECONDS) : null)
    const [bass, other, drums] = await Promise.all([cut(src.bassUrl), cut(src.otherUrl), cut(src.drumsUrl)])
    const tonalParts = [bass, other].filter((b): b is AudioBuffer => !!b)
    return { tonal: tonalParts.length ? sum(tonalParts) : null, drums }
  })()
  const backClean = backEx
    ? toBuffer(await dspRemoveDoubles(channels(backEx), SR, mono(leadEx)).catch(() => channels(backEx)))
    : null
  const airTarget = await dspAirShare(mono(leadEx), SR).catch(() => undefined)

  const converted = await Promise.all((data.predictionIds as string[]).map((id) => pollUntil<string, { status?: string; error?: string; convertedVocalsUrl?: string }>({
    url: () => `/api/voice-convert?id=${id}`,
    intervalMs: 3000,
    maxWaitMs: 5 * 60 * 1000,
    what: 'the previews',
    read: (d, ok) => d.status === 'succeeded' && d.convertedVocalsUrl ? { done: d.convertedVocalsUrl }
      : d.status === 'failed' || d.status === 'canceled' || !ok ? { failed: `A preview failed${d.error ? `: ${String(d.error).slice(0, 100)}` : ''}` }
      : 'wait',
  })))

  onStage?.('Mixing')
  const previews: KeyPreview[] = []
  for (let i = 0; i < keys.length; i++) {
    const url = converted[i]
    if (!url) throw new PollError('A preview was cancelled')
    const raw = slice(await decode(url), 0, KEY_COMPARE_SECONDS)
    const voice = toBuffer([await dspPolishVoice(mono(raw), SR, airTarget ?? -25)])
    const k = keys[i]
    const bedParts: AudioBuffer[] = []
    if (music.tonal) bedParts.push(await shift(music.tonal, k))
    if (music.drums) bedParts.push(music.drums)
    if (backClean) bedParts.push(await shift(backClean, k, true))
    const inputs: MixInputs = { voices: [voice], harmony: [], partner: null, originals: [], bed: bedParts.length ? sum(bedParts) : null }
    const pre = await renderMix(inputs, DEFAULT_MIX_PARAMS)
    // Same loudness for all three, so the louder one doesn't just win.
    const { channels: mastered } = await dspMaster(channels(pre), SR, MASTER_TARGET_FALLBACK)
    previews.push({ key: k, isAuto: k === src.autoKey, buffer: toBuffer(mastered) })
  }
  return previews
}
