// Background thread for Voice Swap's heavier sound processing (key change,
// voice character, harmony, backing clean-up, key finding, Auto Song Key,
// studio voice, mastering) so the page never freezes. Pure
// number-crunching on Float32Arrays — see src/lib/audio-dsp.

import { shiftAudio } from '@/lib/audio-dsp/stretch'
import { detectKey } from '@/lib/audio-dsp/key-detect'
import { renderHarmony } from '@/lib/audio-dsp/harmony'
import { removeDoubles } from '@/lib/audio-dsp/doubles'
import { pitchStats, trackPitch } from '@/lib/audio-dsp/pitch-track'
import { polishVoice, airShare, sibilance } from '@/lib/audio-dsp/voice-polish'
import { lufs, limit, masterGain } from '@/lib/audio-dsp/master'
import { powerSpectrum, applyFilters, alignLag } from '@/lib/audio-dsp/tone-match'
import type { DspRequest, DspResponse } from './dspClient'

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<DspRequest>) => void) | null
  postMessage: (msg: DspResponse, transfer?: Transferable[]) => void
}

ctx.onmessage = async (e) => {
  const req = e.data
  try {
    if (req.op === 'shift') {
      const channels = await shiftAudio(req.channels, req.sampleRate, req.options)
      ctx.postMessage({ id: req.id, ok: true, channels }, channels.map((c) => c.buffer))
    } else if (req.op === 'doubles') {
      const channels = removeDoubles(req.channels, req.sampleRate, req.lead)
      ctx.postMessage({ id: req.id, ok: true, channels }, channels.map((c) => c.buffer))
    } else if (req.op === 'pitchStats') {
      ctx.postMessage({ id: req.id, ok: true, stats: pitchStats(req.mono, req.sampleRate) })
    } else if (req.op === 'key') {
      ctx.postMessage({ id: req.id, ok: true, key: detectKey(req.mono, req.sampleRate) })
    } else if (req.op === 'polish') {
      const out = polishVoice(req.mono, req.sampleRate, req.airTargetDb, req.sibTargetDb)
      ctx.postMessage({ id: req.id, ok: true, channels: [out] }, [out.buffer])
    } else if (req.op === 'airShare') {
      ctx.postMessage({ id: req.id, ok: true, value: airShare(req.mono, req.sampleRate), nums: [sibilance(req.mono, req.sampleRate)] })
    } else if (req.op === 'lufs') {
      ctx.postMessage({ id: req.id, ok: true, value: lufs(req.channels, req.sampleRate) })
    } else if (req.op === 'track') {
      const t = trackPitch(req.mono, req.sampleRate)
      const midi = Float32Array.from(t.midi)
      ctx.postMessage({ id: req.id, ok: true, channels: [midi], value: t.hopSeconds }, [midi.buffer])
    } else if (req.op === 'spectrum') {
      const spec = Float32Array.from(powerSpectrum(req.channels))
      ctx.postMessage({ id: req.id, ok: true, channels: [spec] }, [spec.buffer])
    } else if (req.op === 'filters') {
      const channels = applyFilters(req.channels, req.sampleRate, req.filters)
      ctx.postMessage({ id: req.id, ok: true, channels }, channels.map((c) => c.buffer))
    } else if (req.op === 'align') {
      const a = alignLag(req.channels, req.other, req.sampleRate)
      ctx.postMessage({ id: req.id, ok: true, nums: a ? [a.lag, a.gain] : [] })
    } else if (req.op === 'master') {
      const t0 = performance.now()
      const gain = req.gain ?? masterGain(req.channels, req.sampleRate, req.targetLufs)
      const t1 = performance.now()
      const channels = limit(req.channels, req.sampleRate, gain)
      ctx.postMessage({ id: req.id, ok: true, value: gain, channels, ms: { search: t1 - t0, limit: performance.now() - t1 } }, channels.map((c) => c.buffer))
    } else {
      const { stem, mode } = await renderHarmony(req.mono, req.sampleRate, req.voices, req.key, req.formantSemitones)
      ctx.postMessage({ id: req.id, ok: true, channels: [stem], mode }, [stem.buffer])
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
