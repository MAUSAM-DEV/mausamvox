// Background thread for MP3 encoding of the saved mix (mp3Client.ts) — its
// own worker, so a ~13 s encode never delays the DSP worker's knob updates.
import { encodeMp3Pcm } from '@/lib/audio-dsp/mp3'

type Req = { id: number; channels: Float32Array[]; sampleRate: number; kbps: number }
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<Req>) => void) | null
  postMessage: (msg: unknown, transfer?: Transferable[]) => void
}

ctx.onmessage = (e) => {
  const { id, channels, sampleRate, kbps } = e.data
  try {
    const bytes = encodeMp3Pcm(channels, sampleRate, kbps)
    ctx.postMessage({ id, ok: true, bytes }, [bytes.buffer])
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
