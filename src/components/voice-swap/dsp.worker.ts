// Background thread for Voice Swap's heavier sound processing (key change,
// voice character, harmony, key finding) so the page never freezes. Pure
// number-crunching on Float32Arrays — see src/lib/audio-dsp.

import { shiftAudio } from '@/lib/audio-dsp/stretch'
import { detectKey } from '@/lib/audio-dsp/key-detect'
import { renderHarmony } from '@/lib/audio-dsp/harmony'
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
    } else if (req.op === 'key') {
      ctx.postMessage({ id: req.id, ok: true, key: detectKey(req.mono, req.sampleRate) })
    } else {
      const { stem, mode } = await renderHarmony(req.mono, req.sampleRate, req.voices, req.key, req.formantSemitones)
      ctx.postMessage({ id: req.id, ok: true, channels: [stem], mode }, [stem.buffer])
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
