'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ADMIN_EMAILS } from '@/lib/admin'
import { VSidebar } from './VSidebar'
import { VTopbar } from './VTopbar'
import { UploadStep, StemResult } from './UploadStep'
import { ConfigStep, VoiceOption, DuetMode } from './ConfigStep'
import { ResultStep } from './ResultStep'
import { RightPanel, VoiceSwap } from './RightPanel'
import { ProcessingOverlay, StepStatus } from './ProcessingOverlay'
import { VToast } from './VToast'
import { trimAudioToClip } from './audioClip'
import { detectMedianF0, autoOctaveShiftSemitones, MIN_RELIABLE_VOICED_FRAMES, type MedianF0 } from './pitchDetect'
import type { TuneParams } from './ResultStep'

type Step = 1 | 2 | 3
type VoiceTab = 'My Voices' | 'Library' | 'Ghost Singers'

const STEM_CACHE_KEY = 'mvox_stem_session'
const STEM_CACHE_TTL_MS = 5 * 60 * 60 * 1000 // 5 hours (signed URLs last 6h)
// Length of the short clip the Fine-tune panel renders for previews — keeps a
// tuning render to ~12 s of vocal instead of the whole song (faster + cheaper).
const PREVIEW_CLIP_SECONDS = 12
// Client mirror of the server's GENDER_SPLIT_COST (api/gender-split). Drives the
// premium-split button's affordability state; the server remains the real gate.
const GENDER_SPLIT_COST = 250
// Final pitch sent to RVC = auto key-match + manual Pitch Shift, clamped to a
// sane semitone range (manual is ±12, auto up to ±24) and rounded to an integer.
const clampPitch = (v: number) => Math.max(-24, Math.min(24, Math.round(v)))
// Format a semitone offset for a toast, e.g. -12 → "-12 st", 0 → "0 st".
const fmtSt = (n: number) => `${n > 0 ? '+' : ''}${n} st`
type Gender = 'Male' | 'Female' | 'Neutral'
type AgeRange = 'Young' | 'Mid' | 'Mature'

const AVATAR_PALETTE = [
  'linear-gradient(135deg,#8B5CF6,#EC4899)',
  'linear-gradient(135deg,#EC4899,#06B6D4)',
  'linear-gradient(135deg,#06B6D4,#8B5CF6)',
]

// Every StemResult URL field that has a durable-path twin. Used on cache
// restore to re-sign fresh URLs for all of them in one /api/stems/refresh call.
const STEM_PATH_FIELDS: { path: keyof StemResult; url: keyof StemResult }[] = [
  { path: 'vocalsPath',        url: 'vocalsUrl' },
  { path: 'leadVocalsPath',    url: 'leadVocalsUrl' },
  { path: 'backingVocalsPath', url: 'backingVocalsUrl' },
  { path: 'maleVocalsPath',    url: 'maleVocalsUrl' },
  { path: 'femaleVocalsPath',  url: 'femaleVocalsUrl' },
  { path: 'bassPath',          url: 'bassUrl' },
  { path: 'drumsPath',         url: 'drumsUrl' },
  { path: 'otherPath',         url: 'otherUrl' },
]

// Re-sign every stem in a restored StemResult from its durable storage path.
// Cached signed URLs go stale (6h TTL, and Replicate/MVSEP source URLs die in
// ~1h) — feeding them to RVC or the full-song mix is what produced wrong-voice
// and music-missing swaps. Soft per-stem: a stem whose path is absent (legacy
// cache) or fails to sign keeps its old URL, and the whole thing never throws.
async function refreshStemUrls(result: StemResult): Promise<StemResult> {
  const wanted = STEM_PATH_FIELDS.filter(({ path }) => result[path])
  if (wanted.length === 0) return result
  try {
    const res = await fetch('/api/stems/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: wanted.map(({ path }) => result[path]) }),
    })
    if (!res.ok) {
      console.warn('[stem-cache] URL refresh failed:', res.status)
      return result
    }
    const { urls } = (await res.json()) as { urls: Record<string, string | null> }
    const refreshed = { ...result }
    let count = 0
    for (const { path, url } of wanted) {
      const fresh = urls[result[path] as string]
      if (fresh) {
        (refreshed as Record<string, string>)[url] = fresh
        count++
      }
    }
    console.log(`[stem-cache] re-signed ${count}/${wanted.length} stem URLs on restore`)
    return refreshed
  } catch (e) {
    console.warn('[stem-cache] URL refresh threw:', e)
    return result
  }
}

// ── Lead vocal quality assessment ─────────────────────────────────────────────
// After KARA_2 finishes, we compare the lead stem against the full vocal stem to
// detect dropout artifacts: sustained silence gaps (≥ 2 s) in the lead where the
// full vocal is still active. Backing harmonies being correctly removed don't
// produce 2-second silent blocks — only a bad KARA_2 split does. Returns true if
// the lead stem looks healthy; false if handleProcess should fall back to vocalsUrl.
const _ASSESS_MAX_S   = 90     // analyse at most the first 90 s (bounds memory)
const _ASSESS_FRAME_S = 0.1    // 100 ms RMS windows
const _VOCAL_FLOOR    = 10 ** (-45 / 20) // full-vocal must exceed this to count as active
const _LEAD_SILENCE   = 10 ** (-50 / 20) // lead below this = silent frame
const _MIN_GAP_S      = 2.0    // ignore gaps shorter than this (short harmonic dips)

async function assessLeadVocalQuality(leadUrl: string, fullUrl: string): Promise<boolean> {
  try {
    const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()

    const decode = async (url: string): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(url)
        if (!res.ok) return null
        return await ctx.decodeAudioData(await res.arrayBuffer())
      } catch { return null }
    }

    const [leadBuf, fullBuf] = await Promise.all([decode(leadUrl), decode(fullUrl)])
    try { await ctx.close() } catch { /* ignore */ }
    if (!leadBuf || !fullBuf) return true // can't assess — assume healthy

    const sr        = leadBuf.sampleRate
    const frameSize = Math.round(_ASSESS_FRAME_S * sr)
    const limit     = Math.min(leadBuf.length, fullBuf.length, Math.round(_ASSESS_MAX_S * sr))
    const leadCh    = leadBuf.getChannelData(0)
    const fullCh    = fullBuf.getChannelData(0)
    const minGapFrames = Math.ceil(_MIN_GAP_S / _ASSESS_FRAME_S)

    let gapFrames = 0
    for (let off = 0; off + frameSize <= limit; off += frameSize) {
      let sumL = 0, sumF = 0
      for (let i = off; i < off + frameSize; i++) {
        sumL += leadCh[i] * leadCh[i]
        sumF += fullCh[i] * fullCh[i]
      }
      const rmsL = Math.sqrt(sumL / frameSize)
      const rmsF = Math.sqrt(sumF / frameSize)

      if (rmsF > _VOCAL_FLOOR && rmsL < _LEAD_SILENCE) {
        if (++gapFrames >= minGapFrames) return false // dropout confirmed
      } else {
        gapFrames = 0
      }
    }

    return true
  } catch {
    return true // analysis threw — don't break the normal flow
  }
}
// ──────────────────────────────────────────────────────────────────────────────

export function VoiceSwapPage() {
  // Navigation
  const [step, setStep] = useState<Step>(1)

  // Upload / stems
  const [userId, setUserId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [stemResult, setStemResult] = useState<StemResult | null>(null)
  const [convertedVocalsUrl, setConvertedVocalsUrl] = useState<string | null>(null)
  // Number of regenerates done on the current track (0–2). Each regenerate
  // steps index_rate up (0.80 → 0.85 → 0.90) for a progressively stronger
  // voice match. Reset to 0 on a new track (handleNewSwap). Capped at 2.
  const [regenCount, setRegenCount] = useState(0)
  // Caches the trimmed+uploaded 12 s preview clip for the current source vocal so
  // repeated Fine-tune previews reuse the same segment (consistent A/B, no re-upload).
  // Keyed on sourceUrl + start + length: changing the start point (or clip length)
  // must rebuild the clip, never serve the stale cached segment.
  const tunedClipRef = useRef<{
    sourceUrl: string; startSeconds: number; lengthSeconds: number
    clipUrl: string; clipPath: string
  } | null>(null)
  // Deferred persist for full swaps: we wait until ResultStep has built + uploaded
  // the full-song mix, then persist with its path so Recent Swaps saves the FULL
  // track. The ref holds the swap context; armMixUpload tells ResultStep to upload
  // (true only for full swaps, never previews, so previews don't waste an upload).
  const persistContextRef = useRef<{ predictionId: string; songName: string; voiceUsed: string } | null>(null)
  const [armMixUpload, setArmMixUpload] = useState(false)
  // Auto key-match caches: detected median F0 + voiced-frame confidence (or null)
  // per target voiceId and per source stem URL, so repeated swaps / regenerates of
  // the same pair don't re-fetch + re-decode the same audio.
  const targetF0Ref = useRef<Record<string, MedianF0 | null>>({})
  const sourceF0Ref = useRef<Record<string, MedianF0 | null>>({})
  // Second converted vocal — set only for Mode 2/3 (both singers swapped).
  const [convertedVocalsUrl2, setConvertedVocalsUrl2] = useState<string | null>(null)
  // True while a premium gender (duet) split is in flight, so the trigger button
  // can show a disabled "Splitting duet…" state and block double-starts.
  const [genderSplitting, setGenderSplitting] = useState(false)
  const [karaokeStatus, setKaraokeStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle')
  // User-declared duet flag: checked pre-upload to route to MVSEP gender-split
  // instead of KARA_2. Lifted here (not in UploadStep) because routing lives here.
  const [isDuet, setIsDuet] = useState(false)

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

  // Restore last stem result from localStorage (5-hour TTL). The cached signed
  // URLs may be hours old — possibly expired — so before the result is used we
  // re-sign every stem that has a durable path via /api/stems/refresh, then
  // show a visible toast so a restored track never masquerades as a fresh swap
  // (stale restored URLs were the root cause of the wrong-voice / missing-music
  // bug: dead links fed RVC and silently dropped music stems from the mix).
  useEffect(() => {
    let cancelled = false
    async function restore() {
      let result: StemResult
      try {
        const raw = localStorage.getItem(STEM_CACHE_KEY)
        console.log('[stem-cache] restore attempt — raw:', raw ? raw.slice(0, 80) + '…' : 'null')
        if (!raw) return
        const parsed = JSON.parse(raw) as { result: StemResult; savedAt: number }
        result = parsed.result
        const ageMs = Date.now() - parsed.savedAt
        console.log('[stem-cache] age', Math.round(ageMs / 60000), 'min, TTL', Math.round(STEM_CACHE_TTL_MS / 60000), 'min')
        if (ageMs >= STEM_CACHE_TTL_MS) {
          console.log('[stem-cache] expired — clearing')
          localStorage.removeItem(STEM_CACHE_KEY)
          return
        }
      } catch (e) {
        console.warn('[stem-cache] restore failed:', e)
        return
      }
      const refreshed = await refreshStemUrls(result)
      if (cancelled) return
      console.log('[stem-cache] restoring result for', refreshed.fileName)
      setStemResult(refreshed)
      showToast(`Restored "${refreshed.fileName}" from your last session — use New Swap to upload a different song.`, 6000)
    }
    void restore()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch user id, credits, and recent swaps on mount
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id ?? null
      setUserId(uid)
      setIsAdmin(ADMIN_EMAILS.includes(data.user?.email ?? ''))
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

      // Recent swaps — only playable ones (durable file still present)
      supabase
        .from('voice_swaps')
        .select('id, song_name, voice_used, quality_score, result_url, result_path, created_at')
        .eq('user_id', uid)
        .not('result_path', 'is', null)
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

  // Duet mode — only active when stemResult has both maleVocalsUrl + femaleVocalsUrl.
  // `duetSinger` is the SINGLE source of truth for which singer is converted in
  // one-singer mode (see duetTarget); Gender Lock writes into it. Its default MUST
  // match the gender default below so the two controls agree before any input.
  const [duetMode, setDuetMode] = useState<DuetMode>('one')
  const [duetSinger, setDuetSinger] = useState<'male' | 'female'>('male')
  const [selectedVoiceId2, setSelectedVoiceId2] = useState<string | null>(null)

  // Swap controls. Gender Lock default is 'Male' to stay aligned with duetSinger
  // ('male') — previously 'Female', which silently converted the female stem and
  // left the original male untouched when a user picked "male" in the duet picker.
  const [gender, setGender] = useState<Gender>('Male')
  const [ageRange, setAgeRange] = useState<AgeRange>('Young')
  const [accent, setAccent] = useState('Neutral')
  const [language, setLanguage] = useState('Same as Source')
  const [styleIntensity, setStyleIntensity] = useState(8)
  const [pitchShift, setPitchShift] = useState(0)

  // Gender Lock → duetSinger. Keeps the two controls aligned when the user drives
  // Gender Lock (Male lock → male singer, Female lock → female). Neutral leaves the
  // current singer choice intact (routing always reads duetSinger; see duetTarget).
  function handleSetGender(g: Gender) {
    setGender(g)
    if (g === 'Male') setDuetSinger('male')
    else if (g === 'Female') setDuetSinger('female')
    // Neutral: leave duetSinger unchanged — "no lock", keep the picked singer
  }

  // duetSinger → Gender Lock (the reverse sync). The "Which singer?" picker calls
  // this so choosing a singer also updates Gender Lock — the two controls can never
  // show different singers, which is what let `gender` silently override the picker.
  function handleSetDuetSinger(s: 'male' | 'female') {
    setDuetSinger(s)
    setGender(s === 'male' ? 'Male' : 'Female')
  }

  // SINGLE source of truth for one-singer duet routing: which stem is converted and
  // which is left untouched. Driven only by duetSinger (the user's explicit pick),
  // never by gender — so the conversion target and the untouched partner can never
  // point at different singers. Returns null for non-duets and for both-voices
  // modes (the dual-job path handles those), so single-voice swaps are unaffected.
  function duetTarget(): { convertUrl: string; convertPath: string; untouchedUrl: string } | null {
    const male = stemResult?.maleVocalsUrl
    const female = stemResult?.femaleVocalsUrl
    if (!male || !female || duetMode !== 'one') return null
    // convertPath is the durable storage path twin of convertUrl ('' when the
    // server-side persist soft-failed) — sent to voice-convert so it can re-sign
    // a fresh URL instead of trusting a possibly-stale cached one.
    return duetSinger === 'male'
      ? { convertUrl: male, convertPath: stemResult?.maleVocalsPath ?? '', untouchedUrl: female }
      : { convertUrl: female, convertPath: stemResult?.femaleVocalsPath ?? '', untouchedUrl: male }
  }

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

  async function handleDeleteSwap(id: string) {
    const res = await fetch(`/api/voice-swaps/delete?id=${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error ?? `Delete failed (${res.status})`)
    }
    setSwaps((prev) => prev.filter((s) => s.id !== id))
  }

  // Persists the swap result server-side: downloads the Replicate MP3, uploads
  // it to durable Supabase storage, and inserts the voice_swaps row — all within
  // the 1-hour Replicate URL window. Non-blocking (callers fire-and-forget).
  async function persistSwap(predictionId: string, songName: string, voiceUsed: string, mixedPath?: string) {
    if (!userId) { console.warn('[voice-swap] persistSwap: userId null — skipping'); return }
    try {
      const res = await fetch('/api/voice-swaps/persist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ predictionId, songName, voiceUsed, mixedPath }),
      })
      if (!res.ok) {
        console.error('[voice-swap] persist failed:', res.status, await res.text().catch(() => ''))
        showToast("Swap is ready, but we couldn't save it to Recent Swaps. Download it now — it may not appear in your history.", 8000)
        return
      }
      const persisted = await res.json()
      console.log('[voice-swap] persisted swap', persisted.swapId, persisted.persisted ? `→ storage path saved` : '(result_url only, no durable copy)')
      // Refresh the Recent Swaps panel with the newly inserted row.
      const supabase = createClient()
      const { data: s } = await supabase
        .from('voice_swaps')
        .select('id, song_name, voice_used, quality_score, result_url, result_path, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(4)
      setSwaps(s ?? [])
    } catch (err) {
      console.error('[voice-swap] persist threw:', err instanceof Error ? err.message : String(err))
      showToast("Swap is ready, but we couldn't save it to Recent Swaps. Download it now — it may not appear in your history.", 8000)
    }
  }

  // Called by ResultStep once the full-song mix is built (and uploaded). A null
  // mixedPath means the mix/upload failed — we still persist, falling back to the
  // vocal-only result so the swap isn't lost from Recent Swaps. No-op when there's
  // no armed context (e.g. a preview, or already handled).
  function handleFullMixReady(mixedPath: string | null) {
    const ctx = persistContextRef.current
    if (!ctx) return
    persistContextRef.current = null
    setArmMixUpload(false)
    persistSwap(ctx.predictionId, ctx.songName, ctx.voiceUsed, mixedPath ?? undefined)
      .catch(() => { /* ignore — swap is still complete */ })
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

    setKaraokeStatus('running')
    try {
      const startRes = await fetch('/api/karaoke-split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // vocalsPath lets the route re-sign a fresh URL server-side, so a stale
        // cached vocalsUrl (Demucs output expires ~1h) can't break the split.
        body: JSON.stringify({ vocalsUrl: result.vocalsUrl, vocalsPath: result.vocalsPath }),
      })
      if (!startRes.ok) { if (karaokeJobRef.current === jobId) setKaraokeStatus('failed'); return }
      const predictionId = (await startRes.json()).predictionId as string | undefined
      if (!predictionId) { if (karaokeJobRef.current === jobId) setKaraokeStatus('failed'); return }

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        if (karaokeJobRef.current !== jobId) return // superseded — new job owns the status

        const pollRes = await fetch(`/api/karaoke-split?id=${predictionId}`)
        if (!pollRes.ok) { setKaraokeStatus('failed'); return }
        const pollData = await pollRes.json()

        if (pollData.status === 'succeeded') {
          const leadVocalsUrl = pollData.leadVocalsUrl as string
          const backingVocalsUrl = (pollData.backingVocalsUrl as string) ?? ''
          // Durable paths (may be '' if server-side persistence soft-failed).
          const leadVocalsPath = (pollData.leadVocalsPath as string) ?? ''
          const backingVocalsPath = (pollData.backingVocalsPath as string) ?? ''
          if (!leadVocalsUrl || karaokeJobRef.current !== jobId) return

          // Assess lead quality before committing: if KARA_2 dropped vocal
          // sections, discard the lead so handleProcess falls back to vocalsUrl.
          const leadHealthy = await assessLeadVocalQuality(leadVocalsUrl, result.vocalsUrl)
          // A new upload may have superseded us while the assessment was running.
          if (karaokeJobRef.current !== jobId) return
          const effectiveLead = leadHealthy ? leadVocalsUrl : ''
          const effectiveLeadPath = leadHealthy ? leadVocalsPath : ''

          const patch = {
            leadVocalsUrl: effectiveLead,
            leadVocalsPath: effectiveLeadPath,
            backingVocalsUrl,
            backingVocalsPath,
          }
          setStemResult((prev) =>
            prev && prev.storagePath === result.storagePath
              ? { ...prev, ...patch }
              : prev
          )
          setKaraokeStatus('done')
          try {
            const merged: StemResult = { ...result, ...patch }
            localStorage.setItem(STEM_CACHE_KEY, JSON.stringify({ result: merged, savedAt: Date.now() }))
          } catch { /* ignore */ }
          console.log(`[karaoke-split] ${leadHealthy ? 'lead/backing ready' : 'dropout detected — full vocals fallback'} for ${result.fileName}`)
          return
        }
        if (pollData.status === 'failed' || pollData.status === 'canceled') {
          setKaraokeStatus('failed')
          return
        }
        // otherwise keep polling
      }
      // timed out — leave fields empty (graceful fallback)
      if (karaokeJobRef.current === jobId) setKaraokeStatus('failed')
    } catch {
      // network/other error — leave fields empty (graceful fallback)
      if (karaokeJobRef.current === jobId) setKaraokeStatus('failed')
    }
  }

  // Premium counterpart to runKaraokeSplit: splits the FULL vocal stem into
  // separate male/female vocals via /api/gender-split (MVSEP). Lives at page
  // level so it survives step changes.
  //
  // On any failure: shows a descriptive toast so the user knows what broke.
  // If the user declared isDuet pre-upload (karaoke was skipped), also falls
  // back to runKaraokeSplit so the swap always has *some* vocal isolation.
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

    // isDuet=true pre-upload skips karaoke-split in handleStemDone. If this
    // gender split fails and the user therefore has no vocal isolation at all
    // (leadVocalsUrl empty), kick off karaoke-split as a fallback so the swap
    // doesn't receive a raw dual-vocalist stem.
    function triggerKaraokeFallback() {
      if (!result.leadVocalsUrl && genderSplitJobRef.current === jobId) {
        void runKaraokeSplit(result)
      }
    }

    try {
      const startRes = await fetch('/api/gender-split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // vocalsPath lets the route re-sign a fresh URL server-side — the main fix
        // for intermittent duet-split failures from a stale cached vocalsUrl.
        body: JSON.stringify({ vocalsUrl: result.vocalsUrl, vocalsPath: result.vocalsPath }),
      })
      // Gated responses are NOT processing failures — surface them distinctly.
      if (startRes.status === 403) {
        showToast(result.leadVocalsUrl
          ? 'Gender split is a premium feature — upgrade to use it.'
          : 'Duet split needs Premium — using standard vocal split instead.')
        triggerKaraokeFallback()
        return
      }
      if (startRes.status === 402) {
        showToast(result.leadVocalsUrl
          ? `Not enough credits for duet split (${GENDER_SPLIT_COST} needed).`
          : `Not enough credits for duet split — using standard vocal split instead.`)
        triggerKaraokeFallback()
        return
      }
      if (!startRes.ok) {
        let reason = `server error ${startRes.status}`
        try { const b = await startRes.json(); if (b?.error) reason = String(b.error) } catch { /* HTML body */ }
        showToast(`Duet split failed: ${reason}`, 5000)
        triggerKaraokeFallback()
        return
      }
      const hash = (await startRes.json()).hash as string | undefined
      if (!hash) {
        showToast('Duet split failed: no job ID returned', 5000)
        triggerKaraokeFallback()
        return
      }

      // Sent on each poll so the (stateless) route can bound how long it tolerates
      // MVSEP's transient "still downloading the input" responses before failing.
      const startedAt = Date.now()

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        if (genderSplitJobRef.current !== jobId) return // superseded by a newer upload / reset

        const pollRes = await fetch(`/api/gender-split?hash=${hash}&elapsedMs=${Date.now() - startedAt}`)
        if (!pollRes.ok) {
          showToast(`Duet split failed: poll error (${pollRes.status})`, 5000)
          triggerKaraokeFallback()
          return
        }
        const pollData = await pollRes.json()

        if (pollData.status === 'succeeded') {
          const maleVocalsUrl = (pollData.maleVocalsUrl as string) ?? ''
          const femaleVocalsUrl = (pollData.femaleVocalsUrl as string) ?? ''
          // Durable paths (may be '' if server-side persistence soft-failed).
          const maleVocalsPath = (pollData.maleVocalsPath as string) ?? ''
          const femaleVocalsPath = (pollData.femaleVocalsPath as string) ?? ''
          // Route guarantees at least one stem on success; bail if neither or superseded.
          if ((!maleVocalsUrl && !femaleVocalsUrl) || genderSplitJobRef.current !== jobId) return

          const patch = { maleVocalsUrl, femaleVocalsUrl, maleVocalsPath, femaleVocalsPath }
          // Merge the new fields into the live result, only if it's still
          // the same upload — preserving everything else in StemResult.
          setStemResult((prev) =>
            prev && prev.storagePath === result.storagePath
              ? { ...prev, ...patch }
              : prev
          )
          // Keep the cached session in sync so a later restore retains the split.
          try {
            const merged: StemResult = { ...result, ...patch }
            localStorage.setItem(STEM_CACHE_KEY, JSON.stringify({ result: merged, savedAt: Date.now() }))
          } catch { /* ignore */ }
          console.log('[gender-split] male/female ready for', result.fileName)
          return
        }
        if (pollData.status === 'failed') {
          const why = typeof pollData.error === 'string' ? `: ${pollData.error}` : ''
          showToast(`Duet split failed${why}`, 5000)
          triggerKaraokeFallback()
          return
        }
        // otherwise keep polling
      }
      // timed out
      if (genderSplitJobRef.current === jobId) {
        showToast('Duet split timed out — try again later', 5000)
        triggerKaraokeFallback()
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'network error'
      showToast(`Duet split failed: ${msg}`, 5000)
      triggerKaraokeFallback()
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

  // Trigger for the post-upload duet split (fallback when the user didn't declare
  // a duet pre-upload). Admin bypasses all client-side plan/credit gates — the
  // server is still the real gate and already has its own admin bypass.
  async function handleSplitDuet() {
    if (!stemResult) return
    if (!isAdmin && plan === 'free') {
      showToast('Duet split is a Premium feature — upgrade to split male/female vocals.')
      return
    }
    if (!isAdmin && creditsRemaining !== null && creditsRemaining < GENDER_SPLIT_COST) {
      showToast(`Not enough credits for duet split (${GENDER_SPLIT_COST} needed).`)
      return
    }
    if (genderSplitting) return // already running — block double-starts
    setIsDuet(true)
    setGenderSplitting(true)
    try {
      await runGenderSplit(stemResult)
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
    // get the automatic background vocal split. Non-duet tracks get the
    // background karaoke (lead/backing) split automatically.
    //
    // Duet tracks do NOT auto-run the 250-credit MVSEP gender-split. Leaving
    // genderSplitting false lets the existing "Run Duet Split before continuing"
    // gate render (UploadStep isDuetGated), so the user must click the cost-labeled
    // "Split duet · 250 cr · Premium" button (onSplitDuet → handleSplitDuet) to
    // proceed — restoring the explicit confirm before any charge.
    if (result.storagePath) {
      if (!isAdmin) deductCredits(50, 'stem_split')
      if (!isDuet) {
        void runKaraokeSplit(result)
      }
    }
  }

  function handleStemContinue() {
    setStep(2)
  }

  // `charge` controls whether credits are deducted (defaults to true so the
  // normal Preview/Full buttons bill as before). `indexRateOverride`, when set,
  // forces a specific RVC index_rate (0–1) instead of deriving it from the
  // styleIntensity slider — used by Regenerate to step voice strength up.
  // ── Auto key-match helpers ──────────────────────────────────────────────────
  // Median F0 (+ voiced-frame confidence) of the target voice, from its reference
  // sample (cached per voice). Null on any failure → no auto shift for that voice.
  async function getTargetF0(voiceId: string): Promise<MedianF0 | null> {
    if (voiceId in targetF0Ref.current) return targetF0Ref.current[voiceId]
    let f0: MedianF0 | null = null
    try {
      const res = await fetch(`/api/voice-lab/sample-url?id=${voiceId}`)
      if (res.ok) {
        const { signedUrl } = await res.json()
        if (typeof signedUrl === 'string') f0 = await detectMedianF0(signedUrl)
      }
    } catch { /* leave null */ }
    targetF0Ref.current[voiceId] = f0
    return f0
  }

  // Median F0 (+ confidence) of a source stem (cached per URL).
  async function getSourceF0(url: string): Promise<MedianF0 | null> {
    if (url in sourceF0Ref.current) return sourceF0Ref.current[url]
    const f0 = await detectMedianF0(url)
    sourceF0Ref.current[url] = f0
    return f0
  }

  // Octave shift (semitones) to bring `sourceUrl` into `voiceId`'s natural range.
  // Returns 0 (never throws) so swaps that don't clearly need a shift are unchanged.
  //
  // Two safety layers prevent the duet octave-doubling misfire that made swaps
  // robotic:
  //  1. Separated duet/gender-split stems (isDuetStem) have stripped fundamentals,
  //     so F0 detection is unreliable (reads an octave high) — never auto-shift
  //     them. The manual Pitch Shift control still applies on top.
  //  2. For everything else, only shift when BOTH the source and target detections
  //     are confident (>= MIN_RELIABLE_VOICED_FRAMES voiced frames). Weak detection
  //     → 0 rather than guessing.
  async function autoKeyShift(sourceUrl: string, voiceId: string, isDuetStem: boolean): Promise<number> {
    if (isDuetStem) {
      console.log('[voice-swap] auto key-match skipped — duet/gender-split stem (unreliable F0)', { voiceId })
      return 0
    }
    const [src, tgt] = await Promise.all([getSourceF0(sourceUrl), getTargetF0(voiceId)])
    const reliable = (r: MedianF0 | null): r is MedianF0 => r != null && r.voicedFrames >= MIN_RELIABLE_VOICED_FRAMES
    if (!reliable(src) || !reliable(tgt)) {
      console.log('[voice-swap] auto key-match skipped — low confidence', {
        voiceId,
        sourceF0: src ? Math.round(src.f0) : null, sourceFrames: src?.voicedFrames ?? 0,
        targetF0: tgt ? Math.round(tgt.f0) : null, targetFrames: tgt?.voicedFrames ?? 0,
        need: MIN_RELIABLE_VOICED_FRAMES,
      })
      return 0
    }
    const shift = autoOctaveShiftSemitones(src.f0, tgt.f0)
    console.log('[voice-swap] auto key-match', {
      voiceId,
      sourceF0: Math.round(src.f0), sourceFrames: src.voicedFrames,
      targetF0: Math.round(tgt.f0), targetFrames: tgt.voicedFrames,
      autoShift: shift,
    })
    return shift
  }

  async function handleProcess(
    type: 'preview' | 'full',
    opts: {
      charge?: boolean
      indexRateOverride?: number
      // Fine-tune overrides for the remaining RVC quality params; omitted on
      // normal swaps so the server applies its defaults.
      protectOverride?: number
      filterRadiusOverride?: number
      rmsMixRateOverride?: number
      // Only Regenerate counts toward the per-track voice-strength cap. Apply-to-full
      // from the tuning panel also sets indexRateOverride but must NOT burn a regen.
      isRegen?: boolean
    } = {},
  ) {
    const {
      charge = true,
      indexRateOverride,
      protectOverride,
      filterRadiusOverride,
      rmsMixRateOverride,
      isRegen = false,
    } = opts
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
    // Clear any prior deferred-persist arming up front so a preview never uploads
    // a mix or persists; full swaps re-arm it on success below.
    persistContextRef.current = null
    setArmMixUpload(false)
    // Vocals are already isolated during upload, so step 1 starts done.
    setOvSteps(['done', 'active', 'pending', 'pending'])

    try {
      const hasDuetStems = !!(stemResult.maleVocalsUrl && stemResult.femaleVocalsUrl)

      // Shared poll helper: resolves with the convertedVocalsUrl on success,
      // throws on failure / timeout. Used by both single-job and dual-job paths.
      const pollJob = async (predictionId: string): Promise<string> => {
        const POLL_INTERVAL_MS = 5000
        const MAX_ATTEMPTS = 300 // ~25 minutes — shared GPU queues can push RVC past 14 min
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

        // Both inputs are gender-split duet stems (isDuetStem=true) → auto key-match
        // is skipped (stripped fundamentals make F0 detection unreliable); this
        // always yields 0. Manual pitchShift still adds on top.
        const [autoShiftA, autoShiftB] = await Promise.all([
          autoKeyShift(stemResult.maleVocalsUrl!, voice.id, true),
          autoKeyShift(stemResult.femaleVocalsUrl!, voice2.id, true),
        ])
        const effPitchA = clampPitch(autoShiftA + pitchShift)
        const effPitchB = clampPitch(autoShiftB + pitchShift)
        if (autoShiftA !== 0 || autoShiftB !== 0) {
          showToast(`Auto key-match — male ${fmtSt(autoShiftA)}, female ${fmtSt(autoShiftB)}`, 4000)
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
              vocalsPath: stemResult.maleVocalsPath || undefined,
              voiceId: voice.id,
              pitchShift: effPitchA,
              styleIntensity,
              // Regenerate forces a stepped-up index_rate; omitted (undefined)
              // on normal swaps so the server derives it from styleIntensity.
              indexRate: indexRateOverride,
              protect: protectOverride,
              filterRadius: filterRadiusOverride,
              rmsMixRate: rmsMixRateOverride,
              isPreview: false,
              trackKey: stemResult.storagePath || '',
            }),
          }).then(async (r) => ({ ok: r.ok, data: await r.json() })),
          fetch('/api/voice-convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              vocalsUrl: stemResult.femaleVocalsUrl,
              vocalsPath: stemResult.femaleVocalsPath || undefined,
              voiceId: voice2.id,
              pitchShift: effPitchB,
              styleIntensity,
              indexRate: indexRateOverride,
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

        if (charge && !isAdmin) deductCredits(400, 'voice_swap_duet_full')
        // A regenerate succeeded — count it toward the per-track cap. Only on
        // success, so a failed regen doesn't burn a take. Apply-to-full (tuning)
        // also sets indexRateOverride but passes isRegen:false, so it's exempt.
        if (isRegen) setRegenCount((c) => c + 1)
        // Defer persist until ResultStep uploads the full mix (handleFullMixReady).
        persistContextRef.current = {
          predictionId: dataA.data.predictionId as string,
          songName: stemResult.fileName?.replace(/\.[^.]+$/, '') ?? 'Unknown Track',
          voiceUsed: `${voice.name} + ${voice2.name}`,
        }
        setArmMixUpload(true)
        return
      }

      // ── Mode 1 / standard: single job ────────────────────────────────────
      // Clear any stale second URL from a previous Mode 2/3 run.
      setConvertedVocalsUrl2(null)

      // One-singer duet routing: convert the singer chosen in the picker
      // (duetTarget reads duetSinger — the single source of truth). Non-duets fall
      // back to the lead/full vocal, so single-voice swaps are unchanged.
      // Every branch also carries the durable storage path matching the URL
      // ('' when the server-side persist soft-failed), so voice-convert can
      // re-sign a fresh URL at the moment of use — previously only the full
      // vocal had a path, and the lead (the DEFAULT swap input) went to RVC
      // with an unvalidated, possibly-stale cached URL.
      let vocalsToConvert = stemResult.leadVocalsUrl || stemResult.vocalsUrl
      let vocalsToConvertPath = stemResult.leadVocalsUrl
        ? stemResult.leadVocalsPath ?? ''
        : stemResult.vocalsPath ?? ''
      const target = duetTarget()
      if (target) {
        vocalsToConvert = target.convertUrl
        vocalsToConvertPath = target.convertPath
      }

      console.log('[voice-swap] starting swap:', {
        type,
        voiceId: voice.id,
        vocalsToConvert,
        vocalsToConvertPath,
        usedLeadVocals: !!stemResult.leadVocalsUrl,
        storagePath: stemResult.storagePath,
      })

      // Auto key-match: octave-snap the source into the target voice's range so
      // RVC can impose the clone identity. Skipped for duet stems (target != null)
      // and low-confidence detections; 0 otherwise leaves correct swaps unchanged.
      // Manual pitchShift adds on top.
      const autoShift = await autoKeyShift(vocalsToConvert, voice.id, !!target)
      const effectivePitch = clampPitch(autoShift + pitchShift)
      if (autoShift !== 0) showToast(`Auto key-match — ${fmtSt(autoShift)}`, 4000)

      const startRes = await fetch('/api/voice-convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocalsUrl: vocalsToConvert,
          vocalsPath: vocalsToConvertPath || undefined,
          voiceModelUrl: voice.modelUrl,
          voiceId: voice.id,
          pitchShift: effectivePitch,
          styleIntensity,
          // Regenerate forces a stepped-up index_rate; omitted (undefined) on
          // normal swaps so the server derives it from styleIntensity.
          indexRate: indexRateOverride,
          protect: protectOverride,
          filterRadius: filterRadiusOverride,
          rmsMixRate: rmsMixRateOverride,
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

      // Deduct credits and record swap (non-blocking).
      console.log(`[voice-swap] type=${type} —`, type === 'full' ? 'persisting swap' : 'skipping persist (preview)')
      if (type === 'full') {
        if (charge && !isAdmin) deductCredits(200, 'voice_swap_full')
        // A regenerate succeeded — count it toward the per-track cap. Only on
        // success, so a failed regen doesn't burn a take. Apply-to-full (tuning)
        // also sets indexRateOverride but passes isRegen:false, so it's exempt.
        if (isRegen) setRegenCount((c) => c + 1)
        // Defer persist until ResultStep uploads the full mix (handleFullMixReady).
        persistContextRef.current = {
          predictionId: startData.predictionId as string,
          songName: stemResult?.fileName?.replace(/\.[^.]+$/, '') ?? 'Unknown Track',
          voiceUsed: voice?.name ?? 'Unknown Voice',
        }
        setArmMixUpload(true)
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
    setKaraokeStatus('idle')
    setStep(1)
    setStemResult(null)
    setConvertedVocalsUrl(null)
    setConvertedVocalsUrl2(null)
    setDuetMode('one')
    setDuetSinger('male')
    setSelectedVoiceId2(null)
    setIsDuet(false)
    setRegenCount(0) // new track → reset the voice-strength ladder
    tunedClipRef.current = null // new track → drop the cached preview clip
    try { localStorage.removeItem(STEM_CACHE_KEY) } catch { /* ignore */ }
  }

  // Max regenerates allowed per track (3 total takes: 1 initial + 2 regens).
  const MAX_REGENS = 2

  // Re-runs the current swap with a stepped-up index_rate for a progressively
  // stronger voice match: regen 1 → 0.85, regen 2 → 0.90 (initial swap is 0.80).
  // Capped at MAX_REGENS per track; each regenerate charges credits normally.
  async function handleRegenerate() {
    if (regenCount >= MAX_REGENS) {
      showToast('Maximum voice strength reached for this track.')
      return
    }
    const isDualMode = !!(stemResult?.maleVocalsUrl && stemResult?.femaleVocalsUrl) && (duetMode === "both-split" || duetMode === "both-same")
    const regenCost = isDualMode ? 400 : 200
    if (creditsRemaining !== null && creditsRemaining < regenCost) {
      showToast(`Regenerating costs ${regenCost} credits, and you don't have enough. Top up to continue.`)
      return
    }
    // Initial swap = 0.80 (styleIntensity 8). Each regen steps +0.05.
    const indexRate = 0.8 + 0.05 * (regenCount + 1)
    await handleProcess('full', { charge: true, indexRateOverride: indexRate, isRegen: true })
  }

  // Resolve the single-voice vocal stem to convert — mirrors handleProcess by
  // reading the same duetTarget() source of truth, so the fine-tune preview tunes
  // the exact stem the full swap will convert. Returns null when no source/voice.
  function pickTuningVocalUrl(): string | null {
    if (!stemResult) return null
    const target = duetTarget()
    if (target) return target.convertUrl
    return (stemResult.leadVocalsUrl || stemResult.vocalsUrl) ?? null
  }

  // Fine-tune panel: render a SHORT (12 s) preview of the swap with the given RVC
  // params, without disturbing the committed full result. Trims+uploads the clip
  // once per source vocal (cached), then runs voice-convert as a preview and
  // returns the converted 12 s vocal URL. Returns null on any failure (toasted).
  async function runTunedPreview(params: TuneParams, startSeconds = 0): Promise<string | null> {
    if (!stemResult) { showToast('Upload a track first'); return null }
    const voice = voices.find((v) => v.id === selectedVoiceId)
    if (!voice) { showToast('Select a voice first'); return null }
    if (!voice.modelUrl) {
      showToast(`"${voice.name}" is sample-only — train it in Voice Lab to tune.`)
      return null
    }
    const sourceUrl = pickTuningVocalUrl()
    if (!sourceUrl) { showToast('No vocal available to preview'); return null }

    // Same auto key-match as the full swap (shared cache, and isDuetStem from the
    // same duetTarget() source of truth), so the preview's pitch matches the
    // committed render — including being skipped for duet stems.
    const autoShift = await autoKeyShift(sourceUrl, voice.id, !!duetTarget())
    const effectivePitch = clampPitch(autoShift + pitchShift)

    try {
      // 1. Reuse the cached clip for this source + segment, else trim → upload →
      //    sign once. A different start point (or clip length) is a different
      //    segment, so it must miss the cache and rebuild — never serve a stale clip.
      const startFloor = Math.max(0, startSeconds)
      let clip = tunedClipRef.current
      if (
        !clip ||
        clip.sourceUrl !== sourceUrl ||
        clip.startSeconds !== startFloor ||
        clip.lengthSeconds !== PREVIEW_CLIP_SECONDS
      ) {
        const blob = await trimAudioToClip(sourceUrl, PREVIEW_CLIP_SECONDS, startFloor)

        const presignRes = await fetch('/api/upload-stem/presign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: 'tuning-preview-12s.mp3', contentType: 'audio/mpeg' }),
        })
        const presign = await presignRes.json()
        if (!presignRes.ok) throw new Error(presign.error ?? 'Failed to get upload URL')

        const putRes = await fetch(presign.uploadUrl, {
          method: 'PUT',
          body: blob,
          headers: { 'Content-Type': 'audio/mpeg', 'x-upsert': 'false' },
        })
        if (!putRes.ok) throw new Error(`Clip upload failed (${putRes.status})`)

        const signRes = await fetch('/api/upload-stem/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: presign.path }),
        })
        const sign = await signRes.json()
        if (!signRes.ok) throw new Error(sign.error ?? 'Failed to sign clip URL')

        clip = {
          sourceUrl, startSeconds: startFloor, lengthSeconds: PREVIEW_CLIP_SECONDS,
          clipUrl: sign.url, clipPath: presign.path,
        }
        tunedClipRef.current = clip
      }

      // 2. Run voice-convert on the clip as a preview with the tuned params.
      const startRes = await fetch('/api/voice-convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocalsUrl: clip.clipUrl,
          vocalsPath: clip.clipPath, // server re-signs from audio-uploads
          voiceModelUrl: voice.modelUrl,
          voiceId: voice.id,
          pitchShift: effectivePitch,
          indexRate: params.indexRate,
          protect: params.protect,
          filterRadius: params.filterRadius,
          rmsMixRate: params.rmsMixRate,
          isPreview: true,
          trackKey: stemResult.storagePath || '',
        }),
      })
      const startData = await startRes.json()
      if (!startRes.ok) throw new Error(startData.error ?? 'Preview failed to start')
      if (typeof startData.creditsRemaining === 'number') setCreditsRemaining(startData.creditsRemaining)

      // 3. Poll to completion (clip is short, so this resolves fast).
      const POLL_INTERVAL_MS = 4000
      const MAX_ATTEMPTS = 150
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
        const res = await fetch(`/api/voice-convert?id=${startData.predictionId}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Preview failed')
        if (data.status === 'succeeded') return data.convertedVocalsUrl as string
        if (data.status === 'failed' || data.status === 'canceled') {
          throw new Error(data.error ?? 'Preview failed')
        }
      }
      throw new Error('Preview timed out')
    } catch (err) {
      console.error('[voice-swap] runTunedPreview threw:', err)
      showToast(err instanceof Error ? err.message : 'Preview failed', 8000)
      return null
    }
  }

  // Fine-tune panel: commit the chosen params to a real full-song render. Routes
  // through handleProcess('full') with the param overrides (isRegen:false, so it
  // doesn't consume the regenerate cap).
  async function handleApplyToFull(params: TuneParams) {
    await handleProcess('full', {
      charge: true,
      indexRateOverride: params.indexRate,
      protectOverride: params.protect,
      filterRadiusOverride: params.filterRadius,
      rmsMixRateOverride: params.rmsMixRate,
    })
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
        <VSidebar creditsRemaining={creditsRemaining} creditsTotal={creditsTotal} plan={plan} />

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
                karaokeStatus={karaokeStatus}
                isDuet={isDuet}
                onSetIsDuet={setIsDuet}
                isAdmin={isAdmin}
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
                setGender={handleSetGender}
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
                setDuetSinger={handleSetDuetSinger}
                selectedVoiceId2={selectedVoiceId2}
                setSelectedVoiceId2={setSelectedVoiceId2}
              />
            )}
            {step === 3 && (
              <ResultStep
                onNewSwap={handleNewSwap}
                onRegenerate={handleRegenerate}
                regenCapReached={regenCount >= MAX_REGENS}
                onToast={showToast}
                onTunedPreview={runTunedPreview}
                onApplyToFull={handleApplyToFull}
                convertedVocalsUrl={convertedVocalsUrl}
                convertedVocalsUrl2={convertedVocalsUrl2}
                stemResult={stemResult}
                duetUntouchedVocalsUrl={duetTarget()?.untouchedUrl ?? null}
                persistMix={armMixUpload}
                onFullMixReady={handleFullMixReady}
                voiceName={[
                  voices.find((v) => v.id === selectedVoiceId)?.name,
                  convertedVocalsUrl2 ? voices.find((v) => v.id === selectedVoiceId2)?.name : null,
                ].filter(Boolean).join(' + ') || null}
              />
            )}
          </div>

          {/* Action bar — steps 1 & 2 only */}
          {step !== 3 && (() => {
            const hasDuetStems = !!(stemResult?.maleVocalsUrl && stemResult?.femaleVocalsUrl)
            const isDualMode = hasDuetStems && (duetMode === 'both-split' || duetMode === 'both-same')
            const isDuetGated = isDuet && !hasDuetStems && !genderSplitting
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
                  disabled={genderSplitting}
                  title={genderSplitting ? 'Waiting for vocal split to finish…' : undefined}
                  onClick={() => {
                    if (step === 1 && !stemResult) {
                      showToast('Upload a track first')
                      return
                    }
                    if (step === 1) {
                      if (isDuetGated) {
                        showToast('Run Duet Split first — scroll down to find the split button.')
                        return
                      }
                      setStep(2)
                      return
                    }
                    if (isDualMode) {
                      showToast('Preview not available in Both Voices mode — use Full Track.')
                      return
                    }
                    handleProcess('preview')
                  }}
                >
                  {step === 1 ? 'Next: Configure →' : '▶ Preview'}
                </button>
                {step === 2 && (
                  <button
                    className="vs-btn-solid"
                    disabled={genderSplitting}
                    title={genderSplitting ? 'Waiting for vocal split to finish…' : undefined}
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

        <RightPanel onToast={showToast} onNewSwap={handleNewSwap} swaps={swaps} swapsLoading={swapsLoading} onDeleteSwap={handleDeleteSwap} />
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
        .vs-btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
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
        .vs-btn-solid:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }

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
