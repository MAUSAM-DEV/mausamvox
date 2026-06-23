'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { VSidebar } from './VSidebar'
import { VTopbar } from './VTopbar'
import { UploadStep, StemResult } from './UploadStep'
import { ConfigStep, VoiceOption, DuetMode } from './ConfigStep'
import { ResultStep } from './ResultStep'
import { RightPanel, VoiceSwap } from './RightPanel'
import { ProcessingOverlay, StepStatus } from './ProcessingOverlay'
import { VToast } from './VToast'

type Step = 1 | 2 | 3
type VoiceTab = 'My Voices' | 'Library' | 'Ghost Singers'

const STEM_CACHE_KEY = 'mvox_stem_session'
const STEM_CACHE_TTL_MS = 5 * 60 * 60 * 1000 // 5 hours (signed URLs last 6h)
// Client mirror of the server's GENDER_SPLIT_COST (api/gender-split). Drives the
// premium-split button's affordability state; the server remains the real gate.
const GENDER_SPLIT_COST = 250
type Gender = 'Male' | 'Female' | 'Neutral'
type AgeRange = 'Young' | 'Mid' | 'Mature'

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
  // Second converted vocal — set only for Mode 2/3 (both singers swapped).
  const [convertedVocalsUrl2, setConvertedVocalsUrl2] = useState<string | null>(null)
  // True while a premium gender (duet) split is in flight, so the trigger button
  // can show a disabled "Splitting duet…" state and block double-starts.
  const [genderSplitting, setGenderSplitting] = useState(false)

  // Voice picker
  const [voiceTab, setVoiceTab] = useState<VoiceTab>('My Voices')
  const [voices, setVoices] = useState<VoiceOption[]>([])
  const [voicesLoading, setVoicesLoading] = useState(true)
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null)

  // Credits
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null)
  const [creditsTotal, setCreditsTotal] = useState<number | null>(null)
  // Plan tier (free | starter | pro | studio) — gates premium features client-side
  // for UX. The server is still the real gate; this only drives button states.
  const [plan, setPlan] = useState<string | null>(null)

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

      // Credits + plan (plan gates premium features client-side for UX only).
      supabase
        .from('users')
        .select('plan, credits_remaining, credits_total')
        .eq('id', uid)
        .single()
        .then(({ data: u, error }) => {
          if (u) { setPlan(u.plan); setCreditsRemaining(u.credits_remaining); setCreditsTotal(u.credits_total) }
          else if (error) console.error('credits fetch failed', error)
        })

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
          const mapped: VoiceOption[] = clones.map((c) => ({
            id: c.id,
            name: c.name,
            sub: c.type === 'studio' ? 'Studio Clone' : 'Express Clone',
            icon: c.type === 'studio' ? '⭐' : '🎙️',
            avatarBg: c.type === 'studio'
              ? 'linear-gradient(135deg,#8B5CF6,#EC4899)'
              : 'linear-gradient(135deg,#06B6D4,#3B82F6)',
            modelUrl: c.model_url ?? undefined,
          }))
          setVoices(mapped)
          if (mapped.length > 0 && !selectedVoiceId) setSelectedVoiceId(mapped[0].id)
        }
        setVoicesLoading(false)
      })
  }, [step, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Duet mode — only active when stemResult has both maleVocalsUrl + femaleVocalsUrl
  const [duetMode, setDuetMode] = useState<DuetMode>('one')
  const [duetSinger, setDuetSinger] = useState<'male' | 'female'>('male')
  const [selectedVoiceId2, setSelectedVoiceId2] = useState<string | null>(null)

  // Swap controls
  const [gender, setGender] = useState<Gender>('Female')
  const [ageRange, setAgeRange] = useState<AgeRange>('Young')
  const [accent, setAccent] = useState('Neutral')
  const [language, setLanguage] = useState('Same as Source')
  const [styleIntensity, setStyleIntensity] = useState(6)
  const [pitchShift, setPitchShift] = useState(0)

  // Processing overlay
  const [processing, setProcessing] = useState(false)
  const [processingType, setProcessingType] = useState<'preview' | 'full'>('full')
  const [ovSteps, setOvSteps] = useState<StepStatus[]>(['pending', 'pending', 'pending', 'pending'])

  // Toast
  const [toast, setToast] = useState({ visible: false, message: '' })
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>()
  // Token for the in-flight background karaoke (lead/backing) split. Each new
  // upload / New Swap bumps it so a stale poll can't apply to the wrong stems.
  const karaokeJobRef = useRef(0)
  // Same token-guard for the premium male/female (gender) split. Independent of
  // karaoke's — they can be in flight at once and must not invalidate each other.
  const genderSplitJobRef = useRef(0)

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

  const showToast = useCallback((message: string, duration = 3000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast({ visible: true, message })
    toastTimerRef.current = setTimeout(() => setToast({ visible: false, message: '' }), duration)
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
      quality_score: null,
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

  // Fires automatically after a server-side stem split to split the isolated
  // vocal into lead vs backing in the background. Lives here (page level) — not
  // in UploadStep — so it survives the user advancing to step 2/3 and UploadStep
  // unmounting. Never blocks the user: on any failure/timeout we leave
  // leadVocalsUrl/backingVocalsUrl empty and the swap falls back to the full
  // vocal (StemResult fallbacks added in step 2).
  async function runKaraokeSplit(result: StemResult) {
    // Token guard: only the most recent upload's job may apply its result.
    const jobId = ++karaokeJobRef.current
    const POLL_INTERVAL_MS = 2000
    const MAX_ATTEMPTS = 120 // ~4 minutes

    try {
      const startRes = await fetch('/api/karaoke-split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocalsUrl: result.vocalsUrl }),
      })
      if (!startRes.ok) return
      const predictionId = (await startRes.json()).predictionId as string | undefined
      if (!predictionId) return

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        if (karaokeJobRef.current !== jobId) return // superseded by a newer upload / reset

        const pollRes = await fetch(`/api/karaoke-split?id=${predictionId}`)
        if (!pollRes.ok) return
        const pollData = await pollRes.json()

        if (pollData.status === 'succeeded') {
          const leadVocalsUrl = pollData.leadVocalsUrl as string
          const backingVocalsUrl = (pollData.backingVocalsUrl as string) ?? ''
          if (!leadVocalsUrl || karaokeJobRef.current !== jobId) return

          // Merge the two new fields into the live result, only if it's still
          // the same upload — preserving everything else in StemResult.
          setStemResult((prev) =>
            prev && prev.storagePath === result.storagePath
              ? { ...prev, leadVocalsUrl, backingVocalsUrl }
              : prev
          )
          // Keep the cached session in sync so a later restore retains the split.
          try {
            const merged: StemResult = { ...result, leadVocalsUrl, backingVocalsUrl }
            localStorage.setItem(STEM_CACHE_KEY, JSON.stringify({ result: merged, savedAt: Date.now() }))
          } catch { /* ignore */ }
          console.log('[karaoke-split] lead/backing ready for', result.fileName)
          return
        }
        if (pollData.status === 'failed' || pollData.status === 'canceled') return
        // otherwise keep polling
      }
      // timed out — leave fields empty (graceful fallback)
    } catch {
      // network/other error — leave fields empty (graceful fallback)
    }
  }

  // Premium counterpart to runKaraokeSplit: splits the FULL vocal stem into
  // separate male/female vocals via /api/gender-split (MVSEP). Lives at page
  // level so it survives step changes. Additive + optional: on any failure we
  // leave male/femaleVocalsUrl empty and nothing downstream breaks (nothing
  // reads them yet — UI lands in a later step).
  //
  // Two deliberate differences from runKaraokeSplit:
  //  1. Input is result.vocalsUrl — the FULL both-singers stem. NOT leadVocalsUrl
  //     (that's the lead/backing axis and would drop the backing singer before
  //     the male/female split even runs).
  //  2. NO client-side deductCredits here. /api/gender-split deducts 250 credits
  //     server-side (and refunds a job that never starts), so charging here too
  //     would double-bill. The 402/403 branches below just surface the gate.
  async function runGenderSplit(result: StemResult) {
    // Token guard: only the most recent upload's job may apply its result.
    const jobId = ++genderSplitJobRef.current
    const POLL_INTERVAL_MS = 2000
    const MAX_ATTEMPTS = 150 // ~5 min — the GET does 2 MVSEP hops + 2 Supabase copies, so it's heavier than karaoke's status check

    try {
      const startRes = await fetch('/api/gender-split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocalsUrl: result.vocalsUrl }),
      })
      // Gated responses are NOT processing failures — surface them distinctly.
      if (startRes.status === 403) {
        showToast('Gender split is a premium feature — upgrade to use it.')
        return
      }
      if (startRes.status === 402) {
        showToast('Not enough credits for gender split (250 needed).')
        return
      }
      if (!startRes.ok) return // real start failure — silent, graceful fallback
      const hash = (await startRes.json()).hash as string | undefined
      if (!hash) return

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        if (genderSplitJobRef.current !== jobId) return // superseded by a newer upload / reset

        const pollRes = await fetch(`/api/gender-split?hash=${hash}`)
        if (!pollRes.ok) return
        const pollData = await pollRes.json()

        if (pollData.status === 'succeeded') {
          const maleVocalsUrl = (pollData.maleVocalsUrl as string) ?? ''
          const femaleVocalsUrl = (pollData.femaleVocalsUrl as string) ?? ''
          // Route guarantees at least one stem on success; bail if neither or superseded.
          if ((!maleVocalsUrl && !femaleVocalsUrl) || genderSplitJobRef.current !== jobId) return

          // Merge the two new fields into the live result, only if it's still
          // the same upload — preserving everything else in StemResult.
          setStemResult((prev) =>
            prev && prev.storagePath === result.storagePath
              ? { ...prev, maleVocalsUrl, femaleVocalsUrl }
              : prev
          )
          // Keep the cached session in sync so a later restore retains the split.
          try {
            const merged: StemResult = { ...result, maleVocalsUrl, femaleVocalsUrl }
            localStorage.setItem(STEM_CACHE_KEY, JSON.stringify({ result: merged, savedAt: Date.now() }))
          } catch { /* ignore */ }
          console.log('[gender-split] male/female ready for', result.fileName)
          return
        }
        if (pollData.status === 'failed') return
        // otherwise keep polling
      }
      // timed out — leave fields empty (graceful fallback)
    } catch {
      // network/other error — leave fields empty (graceful fallback)
    }
  }

  // Re-reads plan + balance from the DB. Used after a gender split: the
  // /api/gender-split route deducts 250 server-side but (unlike voice-convert)
  // doesn't return the new balance, so we refetch to keep the display honest.
  async function refreshCredits() {
    if (!userId) return
    const supabase = createClient()
    const { data: u } = await supabase
      .from('users')
      .select('plan, credits_remaining, credits_total')
      .eq('id', userId)
      .single()
    if (u) { setPlan(u.plan); setCreditsRemaining(u.credits_remaining); setCreditsTotal(u.credits_total) }
  }

  // Trigger for the premium duet split. Free users are routed to an upsell (not a
  // dead click); the server still re-checks plan + balance and deducts, so the
  // runner's 402/403 toasts catch any client/server disagreement. We don't deduct
  // here (the route does) — only refresh the balance once a split lands.
  async function handleSplitDuet() {
    if (!stemResult) return
    if (plan === 'free') {
      showToast('Duet split is a Premium feature — upgrade to split male/female vocals.')
      return
    }
    if (creditsRemaining !== null && creditsRemaining < GENDER_SPLIT_COST) {
      showToast(`Not enough credits for duet split (${GENDER_SPLIT_COST} needed).`)
      return
    }
    if (genderSplitting) return // already running — block double-starts
    setGenderSplitting(true)
    try {
      await runGenderSplit(stemResult)
      // Always refetch the true balance afterwards: success charged 250, a 402/403
      // race charged nothing, a mid-job failure was refunded — a read is correct
      // in every case and keeps the displayed credits honest.
      await refreshCredits()
    } finally {
      setGenderSplitting(false)
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
    // Server-driven stem splits (not manual extracted stems) cost credits and
    // get the automatic background lead/backing split.
    if (result.storagePath) {
      deductCredits(50, 'stem_split')
      void runKaraokeSplit(result)
    }
  }

  function handleStemContinue() {
    setStep(2)
  }

  // `charge` lets a free regeneration re-run the exact same swap without
  // deducting credits. Defaults to true so the normal Preview/Full buttons
  // bill as before.
  async function handleProcess(type: 'preview' | 'full', opts: { charge?: boolean } = {}) {
    const { charge = true } = opts
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
      showToast(`"${voice.name}" is sample-only — full model training needed for voice swap. Train it in Voice Lab.`)
      return
    }

    setProcessingType(type)
    setProcessing(true)
    // Vocals are already isolated during upload, so step 1 starts done.
    setOvSteps(['done', 'active', 'pending', 'pending'])

    try {
      const hasDuetStems = !!(stemResult.maleVocalsUrl && stemResult.femaleVocalsUrl)

      // Shared poll helper: resolves with the convertedVocalsUrl on success,
      // throws on failure / timeout. Used by both single-job and dual-job paths.
      const pollJob = async (predictionId: string): Promise<string> => {
        const POLL_INTERVAL_MS = 2000
        const MAX_ATTEMPTS = 240 // ~8 minutes — RVC on a full song can take 5–7 min on shared GPU
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
          const res = await fetch(`/api/voice-convert?id=${predictionId}`)
          const data = await res.json()
          if (!res.ok) {
            console.error('[voice-swap] poll HTTP error:', res.status, data)
            throw new Error(data.error ?? 'Voice conversion failed')
          }
          if (data.status === 'succeeded') return data.convertedVocalsUrl as string
          if (data.status === 'failed' || data.status === 'canceled') {
            console.error('[voice-swap] RVC job failed:', { predictionId, status: data.status, error: data.error })
            throw new Error(data.error ?? 'Voice conversion failed')
          }
        }
        throw new Error('Voice conversion timed out')
      }

      // ── Mode 2/3: both singers converted in parallel ──────────────────────
      if (hasDuetStems && (duetMode === 'both-split' || duetMode === 'both-same')) {
        // Preview not supported for dual-job mode — the server-side preview gate
        // would run independently per POST and could double-count preview uses.
        if (type === 'preview') {
          setProcessing(false)
          showToast('Preview not available in Both Voices mode — use Full Track.')
          return
        }

        const voice2 = duetMode === 'both-split'
          ? voices.find((v) => v.id === selectedVoiceId2)
          : voice  // both-same: same voice for both singers
        if (!voice2) {
          setProcessing(false)
          showToast('Select a second voice for the female singer first.')
          return
        }
        if (!voice2.modelUrl) {
          setProcessing(false)
          showToast(`"${voice2.name}" is sample-only — full model training needed. Train it in Voice Lab.`)
          return
        }

        // Fire both jobs in parallel, then poll both in parallel.
        // deductCredits(400) is only reached if Promise.all resolves — if either
        // job fails, the catch block runs and no credits are charged.
        const [dataA, dataB] = await Promise.all([
          fetch('/api/voice-convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              vocalsUrl: stemResult.maleVocalsUrl,
              voiceId: voice.id,
              pitchShift,
              styleIntensity,
              isPreview: false,
              trackKey: stemResult.storagePath || '',
            }),
          }).then(async (r) => ({ ok: r.ok, data: await r.json() })),
          fetch('/api/voice-convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              vocalsUrl: stemResult.femaleVocalsUrl,
              voiceId: voice2.id,
              pitchShift,
              styleIntensity,
              isPreview: false,
              trackKey: stemResult.storagePath || '',
            }),
          }).then(async (r) => ({ ok: r.ok, data: await r.json() })),
        ])

        if (!dataA.ok) throw new Error(dataA.data.error ?? 'Male vocal job failed to start')
        if (!dataB.ok) throw new Error(dataB.data.error ?? 'Female vocal job failed to start')

        const [urlA, urlB] = await Promise.all([
          pollJob(dataA.data.predictionId as string),
          pollJob(dataB.data.predictionId as string),
        ])

        setOvSteps(['done', 'done', 'active', 'pending'])
        await new Promise((r) => setTimeout(r, 350))
        setOvSteps(['done', 'done', 'done', 'active'])
        await new Promise((r) => setTimeout(r, 350))
        setOvSteps(['done', 'done', 'done', 'done'])

        setConvertedVocalsUrl(urlA)
        setConvertedVocalsUrl2(urlB)
        setProcessing(false)
        setStep(3)
        showToast('Both voices swapped!')

        if (charge) deductCredits(400, 'voice_swap_duet_full')
        recordSwap(
          stemResult.fileName?.replace(/\.[^.]+$/, '') ?? 'Unknown Track',
          `${voice.name} + ${voice2.name}`,
          urlA,
        ).catch(() => { /* ignore — swap is still complete */ })
        return
      }

      // ── Mode 1 / standard: single job ────────────────────────────────────
      // Clear any stale second URL from a previous Mode 2/3 run.
      setConvertedVocalsUrl2(null)

      let vocalsToConvert = stemResult.leadVocalsUrl || stemResult.vocalsUrl
      if (hasDuetStems && duetMode === 'one') {
        const singerUrl = duetSinger === 'male' ? stemResult.maleVocalsUrl : stemResult.femaleVocalsUrl
        if (singerUrl) vocalsToConvert = singerUrl
      }

      console.log('[voice-swap] starting swap:', {
        type,
        voiceId: voice.id,
        vocalsToConvert,
        usedLeadVocals: !!stemResult.leadVocalsUrl,
        storagePath: stemResult.storagePath,
      })

      const startRes = await fetch('/api/voice-convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocalsUrl: vocalsToConvert,
          voiceModelUrl: voice.modelUrl,
          voiceId: voice.id,
          pitchShift,
          styleIntensity,
          // Previews are gated + charged server-side (first 2 per track free,
          // 3rd+ costs 50). trackKey is the upload storagePath; empty for
          // manual-extracted stems, which are always free.
          isPreview: type === 'preview',
          trackKey: stemResult.storagePath || '',
        }),
      })

      const startData = await startRes.json()
      console.log('[voice-swap] POST /api/voice-convert →', startRes.status, startData)
      if (!startRes.ok) throw new Error(startData.error ?? 'Voice conversion failed to start')

      // Server may have charged a paid (3rd+) preview — reflect the new balance.
      if (typeof startData.creditsRemaining === 'number') {
        setCreditsRemaining(startData.creditsRemaining)
      }

      const convertedUrl = await pollJob(startData.predictionId as string)

      setOvSteps(['done', 'done', 'active', 'pending'])
      await new Promise((r) => setTimeout(r, 350))
      setOvSteps(['done', 'done', 'done', 'active'])
      await new Promise((r) => setTimeout(r, 350))
      setOvSteps(['done', 'done', 'done', 'done'])

      setConvertedVocalsUrl(convertedUrl)
      setProcessing(false)
      setStep(3)
      showToast(type === 'preview' ? 'Preview ready!' : 'Swap complete!')

      // Deduct credits and record swap (non-blocking). A free regen passes
      // charge=false so no credits are taken, but the result is still recorded.
      if (type === 'full') {
        if (charge) deductCredits(200, 'voice_swap_full')
        recordSwap(
          stemResult?.fileName?.replace(/\.[^.]+$/, '') ?? 'Unknown Track',
          voice?.name ?? 'Unknown Voice',
          convertedUrl,
        ).catch(() => { /* ignore — swap is still complete */ })
      }
      // Previews are no longer charged here — the server-side gate in
      // /api/voice-convert handles the "first 2 free, then 50" pricing at job
      // start (see isPreview/trackKey above).
    } catch (err) {
      console.error('[voice-swap] handleProcess threw:', err)
      setProcessing(false)
      // 8-second toast for errors — long enough to read even if the user's
      // eyes were on the fading overlay when the message appeared.
      showToast(err instanceof Error ? err.message : 'Voice conversion failed', 8000)
    }
  }

  function handleNewSwap() {
    // Invalidate any in-flight background karaoke + gender split so neither can
    // apply to the cleared/next stems.
    karaokeJobRef.current++
    genderSplitJobRef.current++
    setStep(1)
    setStemResult(null)
    setConvertedVocalsUrl(null)
    setConvertedVocalsUrl2(null)
    setDuetMode('one')
    setDuetSinger('male')
    setSelectedVoiceId2(null)
    try { localStorage.removeItem(STEM_CACHE_KEY) } catch { /* ignore */ }
  }

  // Re-runs the current swap with the same inputs. Free while the result's
  // regen window is open; once it closes, it bills like a full swap (200 cr)
  // and is blocked up-front if the user can't afford it.
  async function handleRegenerate(isFree: boolean) {
    const isDualMode = !!(stemResult?.maleVocalsUrl && stemResult?.femaleVocalsUrl) && (duetMode === "both-split" || duetMode === "both-same")
    const regenCost = isDualMode ? 400 : 200
    if (!isFree && creditsRemaining !== null && creditsRemaining < regenCost) {
      showToast(`Free regen window ended — regenerating costs ${regenCost} credits, and you don't have enough. Top up to continue.`)
      return
    }
    await handleProcess('full', { charge: isFree ? false : true })
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(toastTimerRef.current)
    }
  }, [])

  return (
    <>
      <div className="vs-shell">
        <VSidebar onToast={showToast} creditsRemaining={creditsRemaining} creditsTotal={creditsTotal} />

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
                plan={plan}
                creditsRemaining={creditsRemaining}
                genderSplitting={genderSplitting}
                onSplitDuet={handleSplitDuet}
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
                hasDuet={!!(stemResult?.maleVocalsUrl && stemResult?.femaleVocalsUrl)}
                duetMode={duetMode}
                setDuetMode={setDuetMode}
                duetSinger={duetSinger}
                setDuetSinger={setDuetSinger}
                selectedVoiceId2={selectedVoiceId2}
                setSelectedVoiceId2={setSelectedVoiceId2}
              />
            )}
            {step === 3 && (
              <ResultStep
                onNewSwap={handleNewSwap}
                onRegenerate={handleRegenerate}
                onToast={showToast}
                convertedVocalsUrl={convertedVocalsUrl}
                convertedVocalsUrl2={convertedVocalsUrl2}
                stemResult={stemResult}
                duetUntouchedVocalsUrl={
                  stemResult?.maleVocalsUrl && stemResult?.femaleVocalsUrl && duetMode === 'one'
                    ? (duetSinger === 'male' ? stemResult.femaleVocalsUrl : stemResult.maleVocalsUrl)
                    : null
                }
              />
            )}
          </div>

          {/* Action bar — steps 1 & 2 only */}
          {step !== 3 && (() => {
            const isDualMode = !!(stemResult?.maleVocalsUrl && stemResult?.femaleVocalsUrl)
              && (duetMode === 'both-split' || duetMode === 'both-same')
            return (
            <div className="vs-action-bar">
              <span className="vs-credit-hint">
                {isDualMode
                  ? 'Full swap ~400 cr (2 voices)'
                  : 'Preview ~50 cr · Full swap ~200 cr'}
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
                    if (isDualMode) {
                      showToast('Preview not available in Both Voices mode — use Full Track.')
                      return
                    }
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
          )
          })()}
        </div>

        <RightPanel onToast={showToast} onNewSwap={handleNewSwap} swaps={swaps} swapsLoading={swapsLoading} />
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
