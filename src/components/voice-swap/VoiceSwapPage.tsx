'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { VSidebar } from './VSidebar'
import { VTopbar } from './VTopbar'
import { UploadStep } from './UploadStep'
import { ConfigStep } from './ConfigStep'
import { ResultStep } from './ResultStep'
import { RightPanel } from './RightPanel'
import { ProcessingOverlay, StepStatus } from './ProcessingOverlay'
import { VToast } from './VToast'

type Step = 1 | 2 | 3
type VoiceTab = 'My Voices' | 'Library' | 'Ghost Singers'
type Gender = 'Male' | 'Female' | 'Neutral'
type AgeRange = 'Young' | 'Mid' | 'Mature'
type PlayerTab = 'Original' | 'Swapped' | 'A/B Compare'

export function VoiceSwapPage() {
  // Navigation
  const [step, setStep] = useState<Step>(2)

  // Upload
  const [uploaded, setUploaded] = useState(true)

  // Voice picker
  const [voiceTab, setVoiceTab] = useState<VoiceTab>('My Voices')
  const [selectedVoice, setSelectedVoice] = useState(0)

  // Swap controls
  const [gender, setGender] = useState<Gender>('Female')
  const [ageRange, setAgeRange] = useState<AgeRange>('Young')
  const [accent, setAccent] = useState('Neutral')
  const [language, setLanguage] = useState('Same as Source')
  const [styleIntensity, setStyleIntensity] = useState(6)
  const [pitchShift, setPitchShift] = useState(0)

  // Player
  const [playerTab, setPlayerTab] = useState<PlayerTab>('Swapped')
  const [playing, setPlaying] = useState(false)
  const [playProgress, setPlayProgress] = useState(0)
  const playerTimerRef = useRef<ReturnType<typeof setInterval>>()

  // Processing overlay
  const [processing, setProcessing] = useState(false)
  const [processingType, setProcessingType] = useState<'preview' | 'full'>('full')
  const [ovSteps, setOvSteps] = useState<StepStatus[]>(['pending', 'pending', 'pending', 'pending'])

  // Toast
  const [toast, setToast] = useState({ visible: false, message: '' })
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>()

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

  function goStep(n: Step) {
    setStep(n)
  }

  function handleUpload() {
    setUploaded((v) => {
      if (!v) {
        showToast('Track loaded — Kesariya_Original.mp3')
        setTimeout(() => setStep(2), 600)
      }
      return !v
    })
  }

  function handleProcess(type: 'preview' | 'full') {
    setProcessingType(type)
    setProcessing(true)
    setOvSteps(['pending', 'pending', 'pending', 'pending'])

    const base = type === 'preview' ? 500 : 700
    const labels: StepStatus[] = ['pending', 'pending', 'pending', 'pending']

    for (let i = 0; i < 4; i++) {
      setTimeout(() => {
        setOvSteps((prev) => prev.map((s, idx) => (idx === i ? 'active' : s)) as StepStatus[])
      }, base * i + 200)
      setTimeout(() => {
        setOvSteps((prev) => prev.map((s, idx) => (idx === i ? 'done' : s)) as StepStatus[])
      }, base * i + base - 100)
    }

    setTimeout(() => {
      setProcessing(false)
      setStep(3)
      showToast(
        type === 'preview'
          ? 'Preview ready! Quality score: 82/100'
          : 'Swap complete! Quality score: 82/100'
      )
    }, base * 4 + 400)
  }

  function handleTogglePlay() {
    if (playing) {
      clearInterval(playerTimerRef.current)
      setPlaying(false)
    } else {
      setPlaying(true)
      playerTimerRef.current = setInterval(() => {
        setPlayProgress((prev) => {
          const next = prev + 1 / 272
          if (next >= 1) {
            clearInterval(playerTimerRef.current)
            setPlaying(false)
            return 0
          }
          return next
        })
      }, 100)
    }
  }

  function handleSeek(pct: number) {
    setPlayProgress(pct)
  }

  function handleNewSwap() {
    clearInterval(playerTimerRef.current)
    setPlaying(false)
    setPlayProgress(0)
    setStep(1)
    setUploaded(false)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearInterval(playerTimerRef.current)
      clearTimeout(toastTimerRef.current)
    }
  }, [])

  return (
    <>
      <div className="vs-shell">
        <VSidebar onToast={showToast} />

        {/* Centre column */}
        <div className="vs-centre">
          <VTopbar step={step} onGoStep={goStep} />

          {/* Workspace */}
          <div className="vs-workspace">
            {step === 1 && (
              <UploadStep uploaded={uploaded} onUpload={handleUpload} />
            )}
            {step === 2 && (
              <ConfigStep
                voiceTab={voiceTab}
                setVoiceTab={setVoiceTab}
                selectedVoice={selectedVoice}
                setSelectedVoice={setSelectedVoice}
                gender={gender}
                setGender={setGender}
                ageRange={ageRange}
                setAgeRange={setAgeRange}
                accent={accent}
                setAccent={setAccent}
                language={language}
                setLanguage={setLanguage}
                styleIntensity={styleIntensity}
                setStyleIntensity={setStyleIntensity}
                pitchShift={pitchShift}
                setPitchShift={setPitchShift}
                onToast={showToast}
              />
            )}
            {step === 3 && (
              <ResultStep
                playerTab={playerTab}
                setPlayerTab={setPlayerTab}
                playing={playing}
                playProgress={playProgress}
                onTogglePlay={handleTogglePlay}
                onSeek={handleSeek}
                onNewSwap={handleNewSwap}
                onToast={showToast}
              />
            )}
          </div>

          {/* Action bar — steps 1 & 2 only */}
          {step !== 3 && (
            <div className="vs-action-bar">
              <span className="vs-credit-hint">
                Preview ~50 cr · Full swap ~200 cr
              </span>
              <div className="vs-action-btns">
                <button
                  className="vs-btn-ghost"
                  onClick={() => {
                    if (step === 1 && !uploaded) {
                      showToast('Upload a track first')
                      return
                    }
                    if (step === 1) { setStep(2); return }
                    handleProcess('preview')
                  }}
                >
                  {step === 1 ? 'Next: Configure →' : '▶ Preview 30 sec'}
                </button>
                {step === 2 && (
                  <button
                    className="vs-btn-solid"
                    onClick={() => handleProcess('full')}
                  >
                    ⚡ Process Full Track
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <RightPanel onToast={showToast} />
      </div>

      <ProcessingOverlay
        visible={processing}
        type={processingType}
        steps={ovSteps}
      />
      <VToast visible={toast.visible} message={toast.message} />

      <style suppressHydrationWarning>{`
        .vs-shell {
          display: grid;
          grid-template-columns: 216px 1fr 252px;
          height: 100vh;
          overflow: hidden;
          background: #05050F;
        }
        .vs-centre {
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          min-width: 0;
        }
        .vs-workspace {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          scrollbar-width: thin;
          scrollbar-color: #2A2A4A transparent;
        }
        .vs-workspace::-webkit-scrollbar { width: 4px; }
        .vs-workspace::-webkit-scrollbar-thumb { background: #2A2A4A; border-radius: 2px; }
        .vs-action-bar {
          flex-shrink: 0;
          border-top: 1px solid #1E1E3A;
          padding: 12px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #09091A;
          gap: 12px;
        }
        .vs-credit-hint {
          font-size: 12px;
          color: #5A5A80;
          flex-shrink: 0;
        }
        .vs-action-btns {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }
        .vs-btn-ghost {
          padding: 9px 18px;
          border-radius: 8px;
          border: 1px solid #2A2A4A;
          background: transparent;
          color: #C4C4E0;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          white-space: nowrap;
        }
        .vs-btn-ghost:hover { border-color: #8B5CF6; color: #8B5CF6; }
        .vs-btn-solid {
          padding: 9px 18px;
          border-radius: 8px;
          border: none;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.25s;
          white-space: nowrap;
        }
        .vs-btn-solid:hover {
          box-shadow: 0 8px 24px rgba(139,92,246,.4);
          transform: translateY(-1px);
        }

        @media (max-width: 900px) {
          .vs-shell {
            display: flex !important;
            flex-direction: column !important;
            height: auto !important;
            min-height: 100vh;
            overflow: visible !important;
          }
          .vs-centre {
            height: auto !important;
            overflow: visible !important;
          }
          .vs-workspace {
            overflow: visible !important;
            padding: 16px !important;
          }
          .vs-action-bar {
            flex-wrap: wrap;
            padding: 12px 14px !important;
            position: sticky;
            bottom: 0;
            z-index: 50;
          }
          .vs-credit-hint { display: none; }
          .vs-action-btns { width: 100%; justify-content: flex-end; }
        }

        @media (max-width: 420px) {
          .vs-workspace { padding: 12px !important; }
          .vs-action-bar { padding: 10px 12px !important; }
          .vs-btn-solid, .vs-btn-ghost { padding: 9px 14px; font-size: 12px; }
        }
      `}</style>
    </>
  )
}
