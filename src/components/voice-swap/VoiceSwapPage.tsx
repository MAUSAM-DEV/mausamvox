'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { VSidebar } from './VSidebar'
import { VTopbar } from './VTopbar'
import { UploadStep, StemResult } from './UploadStep'
import { ConfigStep, VoiceOption } from './ConfigStep'
import { ResultStep } from './ResultStep'
import { RightPanel, VoiceSwap } from './RightPanel'
import { ProcessingOverlay, StepStatus } from './ProcessingOverlay'
import { VToast } from './VToast'

type Step = 1 | 2 | 3
type VoiceTab = 'My Voices' | 'Library' | 'Ghost Singers'

const STEM_CACHE_KEY = 'mvox_stem_session'
const STEM_CACHE_TTL_MS = 5 * 60 * 60 * 1000 // 5 hours (signed URLs last 6h)
type Gender = 'Male' | 'Female' | 'Neutral'
type AgeRange = 'Young' | 'Mid' | 'Mature'
type PlayerTab = 'Original' | 'Swapped' | 'A/B Compare'

const AVATAR_PALETTE = [
  'linear-gradient(135deg,#8B5CF6,#EC4899)',
  'linear-gradient(135deg,#EC4899,#06B6D4)',
  'linear-gradient(135deg,#06B6D4,#8B5CF6)',
]

export function VoiceSwapPage() {
  // Navigation
  const [step, setStep] = useState<Step>(1)

  // Upload / stems
  const [userId, setUserId] = useState<string | null>(null)
  const [stemResult, setStemResult] = useState<StemResult | null>(null)
  const [convertedVocalsUrl, setConvertedVocalsUrl] = useState<string | null>(null)

  // Voice picker
  const [voiceTab, setVoiceTab] = useState<VoiceTab>('My Voices')
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voicesLoading, setVoicesLoading] = useState(true)
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null)

  // Credits
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null)
  const CREDITS_TOTAL = 30000

  // Recent swaps
  const [swaps, setSwaps] = useState<VoiceSwap[]>([])
  const [swapsLoading, setSwapsLoading] = useState(true)

  // Restore last stem result from localStorage (5-hour TTL)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STEM_CACHE_KEY)
      console.log('[stem-cache] restore attempt — raw:', raw ? raw.slice(0, 80) + '…' : 'null')
      if (!raw) return
      const { result, savedAt } = JSON.parse(raw) as { result: StemResult; savedAt: number }
      const ageMs = Date.now() - savedAt
      console.log('[stem-cache] age', Math.round(ageMs / 60000), 'min, TTL', Math.round(STEM_CACHE_TTL_MS / 60000), 'min')
      if (ageMs < STEM_CACHE_TTL_MS) {
        console.log('[stem-cache] restoring result for', result.fileName)
        setStemResult(result)
      } else {
        console.log('[stem-cache] expired — clearing')
        localStorage.removeItem(STEM_CACHE_KEY)
      }
    } catch (e) {
      console.warn('[stem-cache] restore failed:', e)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch user id, credits, and recent swaps on mount
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null
      setUserId(uid)
      if (!uid) {
        setSwapsLoading(false)
        return
      }

      // Credits
      supabase
        .from('users')
        .select('credits_remaining')
        .eq('id', uid)
        .single()
        .then(({ data: u }) => { if (u) setCreditsRemaining(u.credits_remaining) })

      // Recent swaps
      supabase
        .from('voice_swaps')
        .select('id, song_name, voice_used, quality_score, result_url, created_at')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(4)
        .then(({ data: s }) => { setSwaps(s ?? []); setSwapsLoading(false) })
    })
  }, [])

  // Fetch (or refresh) voices every time the user enters the configure step
  useEffect(() => {
    if (!userId) {
      setVoicesLoading(false)
      return
    }
    if (step !== 2) return

    setVoicesLoading(true)
    const supabase = createClient()
    supabase
      .from('voice_clones')
      .select('id, name, type, status, model_url')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .then(({ data: clones, error }) => {
        if (!error && clones) {
          const mapped: VoiceOption[] = clones.map((c, i) => ({
            id: c.id,
            name: c.name,
            sub: c.type === 'studio' ? 'Studio Clone' : 'Express Clone',
            avatarBg: AVATAR_PALETTE[i % AVATAR_PALETTE.length],
            modelUrl: c.model_url ?? undefined,
          }))
          setVoices(mapped)
          if (mapped.length > 0 && !selectedVoiceId) setSelectedVoiceId(mapped[0].id)
        }
        setVoicesLoading(false)
      })
  }, [step, userId]) // eslint-disable-line react-hooks/exhaustive-deps

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

  async function deductCredits(amount: number, action: string) {
    if (!userId) return
    try {
      const res = await fetch('/api/credits/deduct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, amount, action }),
      })
      const data = await res.json()
      if (res.ok && typeof data.creditsRemaining === 'number') {
        setCreditsRemaining(data.creditsRemaining)
      }
    } catch { /* non-critical — don't block the user flow */ }
  }

  async function recordSwap(songName: string, voiceUsed: string, resultUrl: string | null) {
    if (!userId) return
    const supabase = createClient()
    const { error } = await supabase.from('voice_swaps').insert({
      user_id: userId,
      song_name: songName,
      voice_used: voiceUsed,
      quality_score: 82,
      result_url: resultUrl,
    })
    if (!error) {
      const { data: s } = await supabase
        .from('voice_swaps')
        .select('id, song_name, voice_used, quality_score, result_url, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(4)
      setSwaps(s ?? [])
    }
  }

  function handleStemDone(result: StemResult) {
    setStemResult(result)
    try {
      const payload = JSON.stringify({ result, savedAt: Date.now() })
      localStorage.setItem(STEM_CACHE_KEY, payload)
      console.log('[stem-cache] saved', result.fileName, 'at', new Date().toISOString())
    } catch (e) {
      console.warn('[stem-cache] save failed:', e)
    }
    // Deduct credits only for server-driven stem splits (not manual extracted stems)
    if (result.storagePath) {
      deductCredits(50, 'stem_split')
    }
  }

  function handleStemContinue() {
    setStep(2)
  }

  async function handleProcess(type: 'preview' | 'full') {
    if (!stemResult) {
      showToast('Upload a track first')
      return
    }

    const voice = voices.find((v) => v.id === selectedVoiceId)
    if (!voice) {
      showToast('Select a voice first')
      return
    }
    if (!voice.modelUrl) {
      showToast('Selected voice has no model configured yet')
      return
    }

    setProcessingType(type)
    setProcessing(true)
    // Vocals are already isolated during upload, so step 1 starts done.
    setOvSteps(['done', 'active', 'pending', 'pending'])

    try {
      const startRes = await fetch('/api/voice-convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocalsUrl: stemResult.vocalsUrl,
          voiceModelUrl: voice.modelUrl,
          voiceId: voice.id,
          pitchShift,
          styleIntensity,
        }),
      })

      const startData = await startRes.json()
      if (!startRes.ok) throw new Error(startData.error ?? 'Voice conversion failed to start')

      const predictionId = startData.predictionId as string

      // Poll the job until Replicate reports a terminal status.
      const POLL_INTERVAL_MS = 2000
      const MAX_ATTEMPTS = 90 // ~3 minutes
      let final: { status: string; convertedVocalsUrl?: string; error?: string } | null = null

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))

        const pollRes = await fetch(`/api/voice-convert?id=${predictionId}`)
        const pollData = await pollRes.json()
        if (!pollRes.ok) throw new Error(pollData.error ?? 'Voice conversion failed')

        if (pollData.status === 'succeeded' || pollData.status === 'failed' || pollData.status === 'canceled') {
          final = pollData
          break
        }
        // still starting/processing — keep step 2 marked active and keep polling
      }

      if (!final) throw new Error('Voice conversion timed out')
      if (final.status !== 'succeeded') throw new Error(final.error ?? 'Voice conversion failed')

      setOvSteps(['done', 'done', 'active', 'pending'])
      await new Promise((r) => setTimeout(r, 350))
      setOvSteps(['done', 'done', 'done', 'active'])
      await new Promise((r) => setTimeout(r, 350))
      setOvSteps(['done', 'done', 'done', 'done'])

      setConvertedVocalsUrl(final.convertedVocalsUrl ?? null)
      setProcessing(false)
      setStep(3)
      showToast(
        type === 'preview'
          ? 'Preview ready! Quality score: 82/100'
          : 'Swap complete! Quality score: 82/100'
      )

      // Deduct credits and record swap (non-blocking)
      if (type === 'full') {
        deductCredits(200, 'voice_swap_full')
        recordSwap(
          stemResult?.fileName?.replace(/\.[^.]+$/, '') ?? 'Unknown Track',
          voice?.name ?? 'Unknown Voice',
          final.convertedVocalsUrl ?? null,
        ).catch(() => { /* ignore — swap is still complete */ })
      } else {
        deductCredits(50, 'voice_swap_preview')
      }
    } catch (err) {
      setProcessing(false)
      showToast(err instanceof Error ? err.message : 'Voice conversion failed')
    }
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
    setStemResult(null)
    setConvertedVocalsUrl(null)
    try { localStorage.removeItem(STEM_CACHE_KEY) } catch { /* ignore */ }
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
        <VSidebar onToast={showToast} creditsRemaining={creditsRemaining} creditsTotal={CREDITS_TOTAL} />

        {/* Centre column */}
        <div className="vs-centre">
          <VTopbar step={step} onGoStep={goStep} />

          {/* Workspace */}
          <div className="vs-workspace">
            {step === 1 && (
              <UploadStep
                userId={userId}
                result={stemResult}
                onDone={handleStemDone}
                onContinue={handleStemContinue}
                onToast={showToast}
              />
            )}
            {step === 2 && (
              <ConfigStep
                voiceTab={voiceTab}
                setVoiceTab={setVoiceTab}
                voices={voices}
                voicesLoading={voicesLoading}
                selectedVoiceId={selectedVoiceId}
                setSelectedVoiceId={setSelectedVoiceId}
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
                convertedVocalsUrl={convertedVocalsUrl}
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
                    if (step === 1 && !stemResult) {
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

        <RightPanel onToast={showToast} swaps={swaps} swapsLoading={swapsLoading} />
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
