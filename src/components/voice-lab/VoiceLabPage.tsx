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
import { VToast } from '@/components/voice-swap/VToast'

type Step = 1 | 2 | 3 | 4
type CloneType = 'express' | 'studio'

export function VoiceLabPage() {
  const [step, setStep] = useState<Step>(1)
  const [cloneType, setCloneType] = useState<CloneType>('express')

  // My Voices — real rows from voice_clones, fetched on mount and
  // updated locally whenever RecordStep saves a new sample.
  const [voices, setVoices] = useState<SavedVoice[]>([])
  const [voicesLoading, setVoicesLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id
      if (!uid) { setVoicesLoading(false); return }

      const { data: clones, error } = await supabase
        .from('voice_clones')
        .select('id, name, type, status, model_url, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })

      if (!error && clones) setVoices(clones as SavedVoice[])
      setVoicesLoading(false)
    })
  }, [])

  function handleVoiceSaved(voice: SavedVoice) {
    setVoices((prev) => [voice, ...prev])
  }

  // Training step state
  const [trainProgress, setTrainProgress] = useState(0)
  const [trainEta, setTrainEta] = useState(42)

  // Test step state
  const [testPlaying, setTestPlaying] = useState(false)

  // Toast
  const [toast, setToast] = useState({ visible: false, message: '' })

  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const trainTimerRef = useRef<ReturnType<typeof setInterval>>()
  const trainProgressRef = useRef(0)

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

  // Training animation — starts when step becomes 3
  useEffect(() => {
    if (step !== 3) return
    trainProgressRef.current = 0
    setTrainProgress(0)
    setTrainEta(42)
    clearInterval(trainTimerRef.current)
    trainTimerRef.current = setInterval(() => {
      const prev = trainProgressRef.current
      const next = Math.min(91, prev + Math.random() * 9 + 3)
      trainProgressRef.current = next
      setTrainProgress(next)
      setTrainEta(Math.max(1, Math.floor(42 * (1 - next / 100))))
      if (next >= 91) {
        clearInterval(trainTimerRef.current)
        setTimeout(() => {
          setStep(4)
          showToast('Training complete — quality 91/100!')
        }, 700)
      }
    }, 600)
    return () => clearInterval(trainTimerRef.current)
  }, [step, showToast])

  // Global cleanup
  useEffect(() => {
    return () => {
      clearInterval(trainTimerRef.current)
      clearTimeout(toastTimerRef.current)
    }
  }, [])

  function goStep(n: Step) {
    setStep(n)
  }

  const showActionBar = step === 1 || step === 2

  return (
    <>
      <div className="vl-shell">
        <VLSidebar onToast={showToast} />

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
                trainProgress={trainProgress}
                trainEta={trainEta}
              />
            )}
            {step === 4 && (
              <TestStep
                testPlaying={testPlaying}
                setTestPlaying={setTestPlaying}
                onToast={showToast}
                onTrainAnother={() => goStep(1)}
              />
            )}
          </div>

          {showActionBar && (
            <div className="vl-action-bar">
              <div className="vl-ab-hint">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="#8B5CF6" strokeWidth="1.5"/>
                  <path d="M12 8v4m0 4h.01" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                {cloneType === 'studio' ? (
                  <span>Studio clone uses <b style={{ color: '#8B5CF6' }}>1 of 3</b> monthly slots on your Pro plan</span>
                ) : (
                  <span>Express clones are <b style={{ color: '#8B5CF6' }}>unlimited</b> on your Pro plan</span>
                )}
              </div>
              <div className="vl-ab-btns">
                {step > 1 && (
                  <button className="vl-btn-back" onClick={() => goStep((step - 1) as Step)}>
                    ← Back
                  </button>
                )}
                <button className="vl-btn-next" onClick={() => goStep((step + 1) as Step)}>
                  {step === 1 ? 'Continue to Recording' : 'Start Training'}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                    <path d="M5 12h14m-6-6l6 6-6 6" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>

        <VLRightPanel onToast={showToast} voices={voices} voicesLoading={voicesLoading} />
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
          border-right: 1px solid #1E1E3A;
        }
        .vl-workspace {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          scrollbar-width: thin;
          scrollbar-color: #2A2A4A transparent;
        }
        .vl-workspace::-webkit-scrollbar { width: 4px; }
        .vl-workspace::-webkit-scrollbar-thumb { background: #2A2A4A; border-radius: 2px; }
        .vl-action-bar {
          flex-shrink: 0;
          border-top: 1px solid #1E1E3A;
          padding: 14px 24px;
          background: #09091A;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .vl-ab-hint {
          font-size: 11px;
          color: #5A5A80;
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
          border: 1px solid #272745;
          background: transparent;
          color: #C4C4E0;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .vl-btn-back:hover { border-color: #5A5A80; color: #F0F0FF; }
        .vl-btn-next {
          padding: 10px 24px;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
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
        .vl-btn-next:hover { box-shadow: 0 8px 28px rgba(139,92,246,.4); transform: translateY(-1px); }

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
