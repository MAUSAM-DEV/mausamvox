// Page side of mp3.worker.ts: encode a mix to MP3 off the page. If a worker
// can't be created (or crashes), the same encoder runs on the page instead.
import { encodeMp3Pcm } from '@/lib/audio-dsp/mp3'

let worker: Worker | null = null
let workerFailed = false
let nextId = 1
const pending = new Map<number, { resolve: (b: Uint8Array) => void; reject: (e: Error) => void }>()

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker
  try {
    worker = new Worker(new URL('./mp3.worker.ts', import.meta.url))
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; bytes?: Uint8Array; error?: string }>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok && e.data.bytes) p.resolve(e.data.bytes)
      else p.reject(new Error(e.data.error ?? 'MP3 encoding failed'))
    }
    worker.onerror = (e) => {
      console.error('[mp3] worker error:', e.message)
      workerFailed = true
      worker?.terminate()
      worker = null
      pending.forEach((p) => p.reject(new Error('MP3 encoding failed')))
      pending.clear()
    }
  } catch (err) {
    console.warn('[mp3] no worker — encoding on the page:', err)
    workerFailed = true
    worker = null
  }
  return worker
}

// `channels` are handed over to the worker (their buffers move) — pass copies.
export async function encodeMp3Background(channels: Float32Array[], sampleRate: number, kbps: number): Promise<Blob> {
  const w = getWorker()
  const bytes = w
    ? await new Promise<Uint8Array>((resolve, reject) => {
        const id = nextId++
        pending.set(id, { resolve, reject })
        w.postMessage({ id, channels, sampleRate, kbps }, channels.map((c) => c.buffer))
      })
    : encodeMp3Pcm(channels, sampleRate, kbps)
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'audio/mpeg' })
}
