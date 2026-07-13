'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SavedVoice } from './RecordStep'

// Real Studio-Clone training phases, driven entirely by backend status — never
// a timer. The sequence maps onto the visible stages in TrainingStep:
//   preparing            → "Preparing your voice data"   (/api/prepare-dataset)
//   queued | training    → "Training your voice model"   (poll /api/voice-lab/train)
//   finalizing           → "Almost ready"                (model_url has landed)
//   ready                → advance to Test
//   failed               → error + retry
export type TrainPhase =
  | 'idle'
  | 'preparing'
  | 'queued'
  | 'training'
  | 'finalizing'
  | 'ready'
  | 'failed'

// Training runs for minutes, so a relaxed poll keeps us honest without hammering
// Replicate (each GET reconciles the prediction and writes status back to the row).
const POLL_MS = 8000
// Brief "Almost ready" beat once the real model_url is confirmed, before Test.
const FINALIZE_MS = 1000
// Once training is 'ready' but the durable model_path hasn't landed yet, keep
// polling (each GET drives the server-side self-heal) for a few rounds before
// giving up and proceeding — the voice is already usable via model_url, so we
// never block the user on durability indefinitely. ~6 × POLL_MS ≈ 48 s worst case,
// and only in the rare event the first persist attempt missed.
const MAX_DURABILITY_POLLS = 6

interface UseTrainingOpts {
  onReady: (voiceId: string, modelUrl: string) => void
}

export function useStudioTraining({ onReady }: UseTrainingOpts) {
  const [phase, setPhase] = useState<TrainPhase>('idle')
  const [error, setError] = useState<string | null>(null)

  const pollRef = useRef<ReturnType<typeof setInterval>>()
  const finalizeRef = useRef<ReturnType<typeof setTimeout>>()
  const mountedRef = useRef(true)
  // Guards against stale responses if the user switches to a different voice
  // mid-flight — only the currently active voice's responses mutate state.
  const activeIdRef = useRef<string | null>(null)
  // Counts consecutive 'ready'-but-not-yet-durable polls, so we can stop waiting
  // on the durable copy after MAX_DURABILITY_POLLS rather than poll forever.
  const durabilityPollsRef = useRef(0)
  const onReadyRef = useRef(onReady)
  useEffect(() => { onReadyRef.current = onReady }, [onReady])

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = undefined }
  }, [])

  const clearTimers = useCallback(() => {
    stopPolling()
    if (finalizeRef.current) { clearTimeout(finalizeRef.current); finalizeRef.current = undefined }
  }, [stopPolling])

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false; clearTimers() }
  }, [clearTimers])

  // One real status check. Reconciles from the backend and moves the phase.
  const poll = useCallback(async (voiceId: string) => {
    try {
      const res = await fetch(`/api/voice-lab/train?id=${encodeURIComponent(voiceId)}`)
      const data = await res.json().catch(() => ({}))
      if (!mountedRef.current || activeIdRef.current !== voiceId) return
      // Transient network/Replicate hiccup — keep polling rather than fail the run.
      if (!res.ok) return

      if (data.status === 'ready' && data.modelUrl) {
        // Hold in "Almost ready" until the durable copy (model_path) is confirmed —
        // each extra poll re-fires the server-side self-heal. The voice is already
        // usable via model_url, so after the cap we proceed regardless of durability.
        if (!data.modelPath && durabilityPollsRef.current < MAX_DURABILITY_POLLS) {
          durabilityPollsRef.current++
          setPhase('finalizing')
          return // leave the interval running; next tick drives another heal attempt
        }
        if (!data.modelPath) {
          console.warn(`[useTraining] proceeding to ready without a durable model_path after ${MAX_DURABILITY_POLLS} attempts`)
        }
        stopPolling()
        setPhase('finalizing')
        finalizeRef.current = setTimeout(() => {
          if (!mountedRef.current || activeIdRef.current !== voiceId) return
          setPhase('ready')
          onReadyRef.current(voiceId, data.modelUrl)
        }, FINALIZE_MS)
        return
      }
      if (data.status === 'failed') {
        stopPolling()
        setError(typeof data.error === 'string' && data.error ? data.error : 'Training failed. Please try again.')
        setPhase('failed')
        return
      }
      // Still in progress. 'starting' = queued on a GPU; 'processing' = training.
      setPhase(data.replicateStatus === 'starting' ? 'queued' : 'training')
    } catch {
      // Network error — keep the interval alive and try again next tick.
    }
  }, [stopPolling])

  const startPolling = useCallback((voiceId: string) => {
    stopPolling()
    durabilityPollsRef.current = 0 // fresh durability budget for this tracking run
    poll(voiceId) // immediate, so returning users see true status without waiting
    pollRef.current = setInterval(() => poll(voiceId), POLL_MS)
  }, [poll, stopPolling])

  // Full Studio flow: prepare dataset → start training → poll to completion.
  // `denoise` (default true) = the Voice Lab "Clean up background noise"
  // toggle, applied server-side before the sample is split into clips.
  const start = useCallback(async (voice: SavedVoice, denoise = true) => {
    clearTimers()
    setError(null)
    activeIdRef.current = voice.id
    setPhase('preparing')
    try {
      // 1. (Optionally clean) + split + zip + upload the sample into the RVC
      //    dataset format.
      const prep = await fetch('/api/prepare-dataset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // No audioUrl: the route signs a fresh URL from the clone's sample_path,
        // so training no longer depends on the (now-removed) stored sample_url.
        body: JSON.stringify({ voiceCloneId: voice.id, denoise }),
      })
      const prepData = await prep.json().catch(() => ({}))
      if (!mountedRef.current || activeIdRef.current !== voice.id) return
      if (!prep.ok) throw new Error(prepData.error ?? 'Could not prepare your voice data')

      // 2. Kick off Replicate training (returns immediately).
      const tr = await fetch('/api/voice-lab/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceCloneId: voice.id }),
      })
      const trData = await tr.json().catch(() => ({}))
      if (!mountedRef.current || activeIdRef.current !== voice.id) return
      if (!tr.ok) throw new Error(trData.error ?? 'Could not start training')

      // 3. Track real status until ready/failed.
      setPhase('queued')
      startPolling(voice.id)
    } catch (err) {
      if (!mountedRef.current || activeIdRef.current !== voice.id) return
      setError(err instanceof Error ? err.message : 'Training failed to start')
      setPhase('failed')
    }
  }, [clearTimers, startPolling])

  // Resume tracking a voice whose training was already started (return visit,
  // or opening an in-progress voice from My Voices). The first poll corrects the
  // phase to the true current status (training / ready / failed).
  const resume = useCallback((voiceId: string) => {
    clearTimers()
    setError(null)
    activeIdRef.current = voiceId
    setPhase('training')
    startPolling(voiceId)
  }, [clearTimers, startPolling])

  const retry = useCallback((voice: SavedVoice, denoise = true) => start(voice, denoise), [start])

  const reset = useCallback(() => {
    clearTimers()
    activeIdRef.current = null
    setError(null)
    setPhase('idle')
  }, [clearTimers])

  return { phase, error, start, resume, retry, reset }
}
