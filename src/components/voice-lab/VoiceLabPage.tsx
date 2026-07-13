'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { VLSidebar } from './VLSidebar'
import { VLTopbar } from './VLTopbar'
import { SetupStep } from './SetupStep'
import { RecordStep, SavedVoice } from './RecordStep'
import { TrainingStep } from './TrainingStep'
import { TestStep } from './TestStep'
import { VLRightPanel } from './VLRightPanel'
import { useStudioTraining } from './useTraining'
import { VToast } from '@/components/voice-swap/VToast'

type Step = 1 | 2 | 3 | 4
type CloneType = 'express' | 'studio'

export function VoiceLabPage() {
  const [step, setStep] = useState<Step>(1)
  // Both tiers run the same real training pipeline; Express uses a shorter
  // recording and fewer epochs (decided server-side) for a ~15-min turnaround.
  const [cloneType, setCloneType] = useState<CloneType>('studio')
  // "Clean up background noise" — optional ffmpeg cleanup (highpass + afftdn)
  // applied server-side to the training sample before it's split into clips.
  // Default ON (most users record on phones); turn OFF for an already-clean
  // studio recording. Free — no credit charge.
  const [denoise, setDenoise] = useState(true)

  // My Voices — real rows from voice_clones, fetched on mount and
  // updated locally whenever RecordStep saves a new sample.
  const [voices, setVoices] = useState<SavedVoice[]>([])
  const [voicesLoading, setVoicesLoading] = useState(true)
  // The most recently saved voice — passed to TrainingStep and TestStep for real UI
  const [savedVoice, setSavedVoice] = useState<SavedVoice | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id
      if (!uid) { setVoicesLoading(false); return }

      const { data: clones, error } = await supabase
        .from('voice_clones')
        .select('id, name, type, status, model_url, sample_url, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })

      if (!error && clones) {
        const list = clones as SavedVoice[]
        setVoices(list)
        // Voice Library state, merged best-effort in a SEPARATE query so a
        // deploy that outruns migration 20260713000000 (published columns)
        // can't break the main voices list.
        supabase
          .from('voice_clones')
          .select('id, published, library_bio')
          .eq('user_id', uid)
          .then(({ data: pub, error: pubErr }) => {
            if (pubErr || !pub) return
            const byId = new Map(pub.map((p) => [p.id, p]))
            setVoices((prev) => prev.map((v) => {
              const p = byId.get(v.id)
              return p ? { ...v, published: !!p.published, library_bio: p.library_bio } : v
            }))
          })
        // Reconcile any voice still marked 'training': training may have finished
        // while nobody was polling, so the row's status can be stale. One GET per
        // such voice self-heals the row and refreshes the badge to the truth.
        list.filter((v) => v.status === 'training').forEach(async (v) => {
          try {
            const res = await fetch(`/api/voice-lab/train?id=${encodeURIComponent(v.id)}`)
            const d = await res.json().catch(() => ({}))
            if (!res.ok) return
            if (d.status === 'ready' && d.modelUrl) {
              setVoices((prev) => prev.map((x) => x.id === v.id ? { ...x, status: 'ready', model_url: d.modelUrl } : x))
            } else if (d.status === 'failed') {
              setVoices((prev) => prev.map((x) => x.id === v.id ? { ...x, status: 'failed' } : x))
            }
          } catch { /* leave badge as-is on transient error */ }
        })
      }
      setVoicesLoading(false)
    })
  }, [])

  function handleVoiceSaved(voice: SavedVoice) {
    setVoices((prev) => [voice, ...prev])
    setSavedVoice(voice)
  }

  // Test step state
  const [testPlaying, setTestPlaying] = useState(false)

  // Toast
  const [toast, setToast] = useState({ visible: false, message: '' })

  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>()
  // Mirrors `step` for use inside async callbacks without stale closures.
  const stepRef = useRef<Step>(step)
  useEffect(() => { stepRef.current = step }, [step])

  // Body overflow: hidden on desktop, auto on mobile
  useEffect(() => {
    function sync() {
      if (window.innerWidth >= 900) {
        document.body.style.overflow = 'hidden'
        document.documentElement.style.overflow = 'hidden'
      } else {
        document.body.style.overflow = ''
        document.documentElement.style.overflow = ''
      }
    }
    sync()
    window.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('resize', sync)
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }, [])

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ visible: true, message })
    toastTimerRef.current = setTimeout(() => setToast({ visible: false, message: '' }), 3000)
  }, [])

  // Real training: when the backend confirms model_url has landed, persist it
  // locally and advance to Test — but only if the user is still on the Train
  // screen, so a background completion doesn't yank them out of another step.
  const handleTrainingReady = useCallback((voiceId: string, modelUrl: string) => {
    setVoices((prev) => prev.map((v) => v.id === voiceId ? { ...v, status: 'ready', model_url: modelUrl } : v))
    setSavedVoice((prev) => prev && prev.id === voiceId ? { ...prev, status: 'ready', model_url: modelUrl } : prev)
    if (stepRef.current === 3) setStep(4)
    showToast('Your Studio Clone is ready!')
  }, [showToast])

  const training = useStudioTraining({ onReady: handleTrainingReady })
  const trainingPhase = training.phase

  // Keep the My Voices badge in sync with the active training run.
  useEffect(() => {
    const id = savedVoice?.id
    if (!id) return
    if (trainingPhase === 'preparing' || trainingPhase === 'queued' || trainingPhase === 'training' || trainingPhase === 'finalizing') {
      setVoices((prev) => prev.map((v) => v.id === id && v.status !== 'training' ? { ...v, status: 'training' } : v))
    } else if (trainingPhase === 'failed') {
      setVoices((prev) => prev.map((v) => v.id === id ? { ...v, status: 'failed' } : v))
    }
  }, [trainingPhase, savedVoice?.id])

  // Global cleanup
  useEffect(() => {
    return () => {
      clearTimeout(toastTimerRef.current)
    }
  }, [])

  function goStep(n: Step) {
    setStep(n)
  }

  // Begin a real Studio training run for the most recently saved voice.
  function handleStartTraining() {
    if (!savedVoice) {
      showToast('Record and save your voice first')
      setStep(2)
      return
    }
    setStep(3)
    training.start(savedVoice, denoise)
  }

  // Delete a voice: remove storage files + row, reset UI if it was the active voice.
  async function handleDeleteVoice(id: string) {
    const res = await fetch(
      `/api/voice-lab/delete-clone?id=${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    )
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error ?? 'Delete failed')
    }
    setVoices((prev) => prev.filter((v) => v.id !== id))
    if (savedVoice?.id === id) {
      setSavedVoice(null)
      training.reset()
      setStep(1)
    }
    showToast('Voice deleted')
  }

  // Publish/unpublish a voice to the free community Voice Library. The route
  // enforces consent + ready-status server-side; this just reflects the result.
  async function handlePublishVoice(id: string, publish: boolean, consent: boolean, bio: string) {
    const res = await fetch('/api/library/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceId: id, publish, consent, bio }),
    })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error(d.error ?? 'Could not update the Library')
    }
    setVoices((prev) => prev.map((v) =>
      v.id === id ? { ...v, published: publish, library_bio: publish ? (bio.trim() || null) : v.library_bio } : v
    ))
    showToast(publish ? 'Published to the Voice Library' : 'Removed from the Voice Library')
  }

  // Open a voice from My Voices and reflect its true current status.
  function handleOpenVoice(v: SavedVoice) {
    setSavedVoice(v)
    if (v.status === 'ready' && v.model_url) {
      setStep(4)
      return
    }
    setStep(3)
    if (v.status === 'training' || v.status === 'failed') {
      training.resume(v.id) // first poll corrects to the real status
    } else {
      training.start(v, denoise) // pending / never-trained — run the full flow
    }
  }

  const showActionBar = step === 1 || step === 2

  return (
    <>
      <div className="vl-shell">
        <VLSidebar />

        <div className="vl-centre">
          <VLTopbar step={step} onGoStep={goStep} />

          <div className="vl-workspace">
            {step === 1 && (
              <SetupStep cloneType={cloneType} setCloneType={setCloneType} />
            )}
            {step === 2 && (
              <RecordStep
                cloneType={cloneType}
                onToast={showToast}
                onSaved={handleVoiceSaved}
              />
            )}
            {step === 3 && (
              <TrainingStep
                cloneType={cloneType}
                phase={training.phase}
                error={training.error}
                voiceName={savedVoice?.name ?? null}
                onRetry={() => savedVoice && training.retry(savedVoice, denoise)}
              />
            )}
            {step === 4 && (
              <TestStep
                testPlaying={testPlaying}
                setTestPlaying={setTestPlaying}
                onToast={showToast}
                onTrainAnother={() => goStep(1)}
                savedVoice={savedVoice}
              />
            )}
          </div>

          {showActionBar && (
            <div className="vl-action-bar">
              <div className="vl-ab-hint">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="#9D5CFF" strokeWidth="1.5"/>
                  <path d="M12 8v4m0 4h.01" stroke="#9D5CFF" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                {cloneType === 'studio' ? (
                  <span>Studio clone uses <b style={{ color: '#9D5CFF' }}>1 of 3</b> monthly slots on your Pro plan</span>
                ) : (
                  <span>Express clone — <b style={{ color: '#9D5CFF' }}>same real training</b>, shorter recording, ready in ~15 minutes</span>
                )}
              </div>
              {step === 2 && (
                <label className="vl-denoise-toggle" title="Free ffmpeg cleanup (rumble filter + gentle noise reduction) applied to your sample before training. Turn off for an already-clean studio recording.">
                  <input
                    type="checkbox"
                    checked={denoise}
                    onChange={(e) => setDenoise(e.target.checked)}
                  />
                  <span>Clean up background noise <em>(recommended)</em></span>
                </label>
              )}
              <div className="vl-ab-btns">
                {step > 1 && (
                  <button className="vl-btn-back" onClick={() => goStep((step - 1) as Step)}>
                    ← Back
                  </button>
                )}
                <button
                  className="vl-btn-next"
                  onClick={() => (step === 1 ? goStep(2) : handleStartTraining())}
                >
                  {step === 1 ? 'Continue to Recording' : 'Start Training'}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14m-6-6l6 6-6 6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>

        <VLRightPanel onToast={showToast} voices={voices} voicesLoading={voicesLoading} onOpenVoice={handleOpenVoice} onDeleteVoice={handleDeleteVoice} onPublishVoice={handlePublishVoice} />
      </div>

      <VToast visible={toast.visible} message={toast.message} />

      <style suppressHydrationWarning>{`
        .vl-shell {
          display: grid;
          grid-template-columns: 216px 1fr 252px;
          height: 100vh;
          overflow: hidden;
          background: #05050F;
        }
        .vl-centre {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          min-width: 0;
          border-right: 1px solid #2E2E56;
        }
        .vl-workspace {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          scrollbar-width: thin;
          scrollbar-color: #3C3C6A transparent;
        }
        .vl-workspace::-webkit-scrollbar { width: 4px; }
        .vl-workspace::-webkit-scrollbar-thumb { background: #3C3C6A; border-radius: 2px; }
        .vl-action-bar {
          flex-shrink: 0;
          border-top: 1px solid #2E2E56;
          padding: 14px 24px;
          background: #09091A;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .vl-denoise-toggle {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 11.5px;
          color: #A8A8CC;
          cursor: pointer;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .vl-denoise-toggle input { accent-color: #9D5CFF; cursor: pointer; }
        .vl-denoise-toggle em { color: #8E8EB4; font-style: normal; }
        .vl-denoise-toggle:hover { color: #C4C4E0; }
        .vl-ab-hint {
          font-size: 11px;
          color: #8E8EB4;
          display: flex;
          align-items: center;
          gap: 5px;
          flex: 1;
        }
        .vl-ab-btns {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-shrink: 0;
        }
        .vl-btn-back {
          padding: 10px 20px;
          border-radius: 8px;
          border: 1px solid #383866;
          background: transparent;
          color: #C4C4E0;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .vl-btn-back:hover { border-color: #8E8EB4; color: #F0F0FF; }
        .vl-btn-next {
          padding: 10px 24px;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.25s;
          display: flex;
          align-items: center;
          gap: 7px;
          white-space: nowrap;
        }
        .vl-btn-next:hover { box-shadow: 0 8px 28px rgba(157,92,255,.4); transform: translateY(-1px); }

        @media (max-width: 900px) {
          .vl-shell {
            display: flex !important;
            flex-direction: column !important;
            height: auto !important;
            min-height: 100vh;
            overflow: visible !important;
          }
          .vl-centre {
            height: auto !important;
            overflow: visible !important;
            border-right: none !important;
          }
          .vl-workspace {
            overflow: visible !important;
            padding: 14px !important;
          }
          .vl-action-bar {
            flex-wrap: wrap;
            padding: 12px 14px !important;
            position: sticky;
            bottom: 0;
            z-index: 50;
          }
          .vl-ab-hint { width: 100%; order: 3; justify-content: center; }
          .vl-ab-btns { width: 100%; justify-content: flex-end; }
        }

        @media (max-width: 420px) {
          .vl-workspace { padding: 12px !important; }
          .vl-action-bar { padding: 10px 12px !important; }
          .vl-btn-next, .vl-btn-back { padding: 9px 14px; font-size: 12px; }
        }
      `}</style>
    </>
  )
}
