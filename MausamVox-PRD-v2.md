# 📄 Product Requirements Document (PRD)
## MausamVox — AI Voice & Music Creation Platform
**Version:** 2.0 | **Date:** June 2026 | **Owner:** Mausam | **Status:** Active

---

## 1. 🎯 Product Vision

> **"The most powerful, honest, and creator-friendly AI voice platform — built first for India, loved everywhere."**

MausamVox is a next-generation AI voice and music creation platform built for artists, producers, and content creators. It lets you clone voices, swap vocals, generate SATB choirs, and produce full songs — in Hindi, Bengali, Tamil, Telugu, Punjabi, Marathi, and English — with professional-grade quality, transparent controls, honest billing, and a creator-first model.

We exist to fix what Controlla Voice broke: inconsistent quality, dead support, no regional language support, and a billing system that punishes users.

---

## 2. 🧭 Problem Statement

| Problem | Current Pain (Controlla) | MausamVox Solution |
|---|---|---|
| AI ignores gender/style prompts | "Asked for male, got female" — 44% 1-star reviews | Hard controls: gender lock, accent, style sliders |
| No quality preview before paying | Pay first, regret later | Free 30-sec preview before spending credits |
| No output quality feedback | Blind downloads | Quality confidence score on every output |
| Dead customer support | Emails go unanswered | Live chat + AI bot 24/7 |
| Billing punishes upgrades | Lose old payment mid-plan | Prorated credit auto-applied |
| No regional language support | English-dominant platform | 7 Indian languages from V1 |
| Web-only, mobile recording broken | Most Indian artists record on phone | Mobile-first wizard from day one |
| No social share loop | Engagement dead-ends | One-tap share: Reels, Shorts, WhatsApp |
| Expensive for Indian creators | USD-only pricing | India tier from ₹499/mo |
| No onboarding experience spec | Cold start, no guidance | Designed first-5-minutes journey per persona |

---

## 3. 👥 Target Users

### Primary
| Persona | Description | Key Need |
|---|---|---|
| **Indian Indie Artist** | Solo musician, home studio, records on phone | Hear themselves on polished Hindi/English tracks |
| **Bedroom Producer** | Makes beats, needs vocals without hiring singers | Pro-quality vocal — affordable |
| **Content Creator** | YouTube/Instagram/Reels | Fast varied voice styles for short-form video |

### Secondary
| Persona | Description | Key Need |
|---|---|---|
| **Film/TV Composer** | Scoring indie films, ads, OTT content | Affordable SATB choir, instrument stems |
| **Ghost Singer** | Vocalist wanting passive income | License voice, earn royalties |
| **Developer** | Building music/audio tools | Clean API with singing voice + stem endpoints |

---

## 4. 🏗️ Product Scope

### V1 MVP — Weeks 1–8
1. Auth + billing (Supabase + Stripe + India INR)
2. Voice Swap — precision controls + 30-sec preview + quality score
3. Voice Lab — guided wizard + express clone + studio clone
4. Smart Stem Studio — 6 stems (BS-RoFormer + HTDemucs)
5. Basic Choir Generator
6. Voice Library (50+ royalty-free voices)
7. Hindi + English language support
8. Mobile-first recording wizard (works on phone from day one)
9. Live chat support + AI bot
10. Free trial (1 watermarked swap + 1 express clone)
11. 7-day refund system
12. Prorated upgrade billing

### V1.5 Growth — Month 3–4
- SATB choir with piano roll + sheet music export
- Voice Style Marketplace + creator earnings dashboard
- Vocal Instrument Engine (50+ instruments)
- Bengali, Tamil, Telugu, Punjabi, Marathi languages
- Social share loop (Reels, Shorts, WhatsApp, branded watermark)
- India pricing tier (₹499 Starter, ₹999 Pro, ₹2,499 Studio)
- Segment-level voice swap (different voices per song section)
- Onboarding journey — 3 persona flows (Artist, Producer, Creator)

### V2 Scale — Month 5–8
- Native mobile app (iOS + Android)
- Public developer API (self-serve)
- DAW plugin beta (VST/AU)
- Ghost singer marketplace with royalty tracking
- Streaming distribution (Spotify, Apple Music, YouTube)
- Cover song licensing tool
- Lyrics generator (Hindi/English)
- Vocal health tracker for singers
- Discord bot

---

## 5. 🧩 Feature Specifications (Key Features)

---

### F1 — Precision Voice Swap Engine

**Purpose:** Replace vocals in any uploaded song with a chosen AI voice, with full user control.

**Controls:**
- Gender Lock: Male / Female / Neutral
- Age Range: Young (15–25) / Mid (26–40) / Mature (41+)
- Accent: Neutral / North Indian / South Indian / Bengali / British / American / International
- Style Intensity: slider 1–10 (Subtle → Dramatic)
- Pitch Shift: –12 to +12 semitones
- Language: Hindi / Bengali / Tamil / Telugu / Punjabi / Marathi / English

**Quality System:**
- 30-second preview = 10% of full-track credit cost
- Quality Confidence Score (0–100) shown before download
- Score < 60 → free regeneration within 10-minute window
- A/B comparison player: Original vs Swapped

**Acceptance Criteria:**
- [ ] All 6 controls functional and respected by model
- [ ] 30-sec preview renders in < 15 seconds
- [ ] Quality score visible before every download
- [ ] Free regeneration within window
- [ ] A/B player

---

### F2 — Voice Lab (Voice Clone)

**Purpose:** Train a personal AI singing voice model.

**Guided Recording Wizard:**
- 30 Hindi + 30 English sentence prompts (covers phoneme range)
- Real-time mic quality feedback: noise level, clipping, silence, room echo
- Input Quality Score (0–100) with specific fix suggestions before training starts
- Estimated training time shown before starting

**Clone Tiers:**
- Express Clone: 3 min audio → ready in 5 min, lower fidelity, for testing
- Studio Clone: 10+ min audio → high fidelity, for production use

**Post-Training:**
- "Test Your Clone" — 10-second sing-along before saving
- Voice evolution: retrain with new audio to improve over time
- Sharable with team with consent-gated permissions

**Acceptance Criteria:**
- [ ] 60 sentence prompts (Hindi + English)
- [ ] Real-time quality feedback during recording
- [ ] Input quality score with fix suggestions
- [ ] Express clone ≤ 5 min turnaround
- [ ] Free tier: 1 express; Starter: 1 studio/mo; Pro: 3 studio/mo

---

### F3 — Smart Stem Studio

**AI Models:**
- Vocals: BS-RoFormer (2026 SDX champion, 95% clean vocal isolation)
- Drums / Bass / Piano / Guitar / FX: HTDemucs FT
- Ensemble mode: BS-RoFormer + MDX-Net on complex mixes

**Output per stem:**
- Auto-detected BPM, key, time signature
- Smart file naming: `SongName_Vocals_120BPM_Aminor.wav`
- In-browser per-stem controls: gain, fade, trim
- Waveform before/after visualiser

**Acceptance Criteria:**
- [ ] 6 stems minimum (vocals, drums, bass, piano, guitar, FX)
- [ ] BPM + key shown per stem
- [ ] Smart auto-naming
- [ ] In-browser gain/trim
- [ ] BS-RoFormer for vocal stem (not Demucs — measurably better)

---

### F4 — Choir Composer Pro

**Differentiator:** True SATB (Soprano, Alto, Tenor, Bass) polyphonic output — 4 separate downloadable stems.

**Input options:**
- Lyrics: full song, no character limit, section tags [verse][chorus][bridge]
- Melody: draw on piano roll OR hum/sing into mic → auto-detected melody
- Style: community presets OR upload 15-sec reference audio

**Controls:**
- Key, BPM, dynamics (pp to ff)
- Spatial placement per voice (stereo field)
- Live low-res preview (< 5 sec latency) as you type

**Output:**
- Full mixed choir (WAV/MP3)
- 4 separate SATB stems
- Sheet music PDF + MusicXML export

**Acceptance Criteria:**
- [ ] Full lyric input (no char limit)
- [ ] Piano roll melody input
- [ ] Hum-to-melody input
- [ ] 4 SATB stems on output
- [ ] Sheet music PDF export
- [ ] Live low-res preview

---

### F5 — Mobile-First Recording Wizard

**Why this is V1 not V2:** Most Indian indie artists record on mobile. If mobile recording is broken, the clone quality will be broken, and the whole platform fails for the primary audience.

**Mobile-specific features:**
- One-tap microphone access with permission explanation
- Real-time noise floor reading with visual indicator
- "Move to quieter room" prompt if noise level > threshold
- Auto-pause if loud background event detected (traffic, fan)
- Hindi + English UI for recording wizard
- Haptic feedback on mobile for recording milestones

**Acceptance Criteria:**
- [ ] Full wizard works on Chrome Mobile + Safari iOS
- [ ] Noise level visual indicator in real time
- [ ] Auto-pause on noise spike
- [ ] Recording wizard UI in Hindi + English

---

### F6 — Social Share Loop

**Purpose:** Turn every great result into organic marketing.

**Flow:**
1. Voice swap / choir completes
2. "Share Your Track" prompt appears
3. User picks: Instagram Reels, YouTube Shorts, WhatsApp, Twitter/X, or Copy Link
4. Free tier: MausamVox watermark on audio waveform visual
5. Paid tier: clean share, no watermark

**Visual format:**
- Auto-generated waveform card with track name + voice style
- Square (1:1) + Vertical (9:16) formats auto-generated
- "Made with MausamVox" tag clickable → install page

**Acceptance Criteria:**
- [ ] Share to Reels, Shorts, WhatsApp in 2 taps
- [ ] Auto-generated waveform visual (1:1 + 9:16)
- [ ] Watermark on free tier, clean on paid
- [ ] Clickable attribution link

---

### F7 — Onboarding Journey (3 Persona Flows)

**Why this needs its own spec:** The first 5 minutes = everything. Bad first clone = bad review = bad word of mouth.

**Artist Flow:**
1. "I'm a singer" → Voice Lab wizard → Express clone in 3 min → Swap a pre-loaded demo song → Hear their voice on it → "Now swap your own song"

**Producer Flow:**
1. "I'm a producer" → Upload a beat → Choose a voice from library → Swap → "Now clone your artist's voice" → Studio clone

**Creator Flow:**
1. "I make videos" → Upload a clip or pick a demo → Quick voice style selector → Instant swap → Share to Reels

**Acceptance Criteria:**
- [ ] 3 distinct onboarding flows based on self-selection
- [ ] Each flow ends with a shareable result
- [ ] < 5 minutes to first satisfying output in every flow
- [ ] Hindi + English copy throughout

---

### F8 — India Pricing Tier

| Plan | USD | INR | Credits | Studio Clones |
|---|---|---|---|---|
| Free | $0 | ₹0 | 500 | 0 |
| Starter | $9/mo | ₹499/mo | 8,000 | 1 |
| Pro | $24/mo | ₹999/mo | 30,000 | 3 |
| Studio | $59/mo | ₹2,499/mo | Unlimited | 10 |

**Payment methods (India):**
- UPI (GPay, PhonePe, Paytm)
- Netbanking
- Credit/Debit card
- International cards (USD)

**Acceptance Criteria:**
- [ ] INR pricing shown to Indian IP addresses automatically
- [ ] UPI payment working via Razorpay
- [ ] GST invoice generation on purchase

---

## 6. 🤖 AI Model Stack

| Feature | Model | Source | Why |
|---|---|---|---|
| Voice Clone | GPT-SoVITS v2 | Open source, self-hosted | 1-min training, multilingual, 0.028 RTF on 4060Ti |
| Voice Swap | GPT-SoVITS inference | Same GPU | Best quality+control pipeline |
| Vocal Stem Split | BS-RoFormer | Replicate API | 2026 SDX leaderboard champion for vocals |
| Full Stem Split | HTDemucs FT | Replicate API | Best clean 6-stem general separation |
| Choir Generation | ElevenLabs API + harmony layer | API | Fastest path to SATB quality |
| Instrument Engine | DDSP | Replicate API | Google's model, solid voice-to-instrument |
| Audio Queue | Redis + BullMQ | Self-hosted | Handle async processing jobs |
| GPU Burst | RunPod | Pay-per-second | No upfront infra, scales as needed |

---

## 7. 🏗️ Technical Stack

### Frontend
- Framework: Next.js 14 + TypeScript
- Styling: Tailwind CSS
- Audio: Web Audio API + Wavesurfer.js
- State: Zustand
- Animations: Framer Motion

### Backend
- API: Node.js (Express) + Python FastAPI (AI endpoints)
- Auth: Supabase Auth (email + Google)
- Storage: AWS S3 + CloudFront CDN
- Database: PostgreSQL (Supabase)
- Queue: Redis + BullMQ

### Payments
- International: Stripe
- India: Razorpay (UPI, Netbanking, Cards)
- GST invoicing: Razorpay built-in

---

## 8. 🎨 Brand Identity

**Name:** MausamVox

**Why:** Mausam = the founder's identity, the name owns the product. Vox = Latin for voice (universal, premium). Together = a voice platform with a human at its centre, built for a global audience.

**Tagline:** Any Voice. Any Language. Any Song.

**Positioning:** Global platform, not India-only. India is the launch market with dedicated INR pricing and regional language support, but the brand, copy, and design target creators worldwide. No competitor is ever named in public-facing materials.

**Logo Mark:** 5 vertical waveform bars forming an M-shape, violet→pink→cyan gradient. Works at 16px (favicon) to 200px (hero).

**Color Palette:**
- Void: `#05050F` (background)
- Violet: `#8B5CF6` (gradient start — primary brand)
- Hot Pink: `#EC4899` (gradient mid)
- Electric Cyan: `#06B6D4` (gradient end)
- Card: `#121225` / Border: `#1E1E3A` (surfaces)
- White: `#F0F0FF` / Pearl: `#C4C4E0` / Muted: `#5A5A80` (text)
- Signature gradient: `linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)`

**Typography:**
- Display: Space Grotesk (headlines, buttons, scores) — modern, techy
- Body: Inter (everything else) — clean, readable

**Design references (final mockups, use as the source of truth for the build):**
- `mausamvox-landing.html` — landing page
- `mausamvox-voiceswap.html` — Voice Swap tool (core feature)
- `mausamvox-voicelab.html` — Voice Lab recording wizard
- `mausamvox-onboarding.html` — 3-persona onboarding flow
- All four are mobile-responsive (tested down to 360px width); the real build must preserve this.

---

## 9. 📊 Success Metrics (3 Months Post-Launch)

| Metric | Target |
|---|---|
| Registered Users | 15,000 |
| Paid Conversions (free → paid) | 10% |
| Voice Swaps Completed | 60,000 |
| Voice Clones Trained | 6,000 |
| Avg Quality Score | > 74 / 100 |
| Support First Response Time | < 2 hours |
| Monthly Churn | < 4% |
| Trustpilot / Google Rating | > 4.4 / 5 |
| NPS | > 50 |
| India User Share | > 60% |
| Hindi/regional language swaps | > 40% of total |

---

## 10. ⏱️ Revised Timeline — 4 Months to V1.5

| Phase | Duration | What Ships |
|---|---|---|
| **V1 MVP** | Weeks 1–8 | Core: Auth, Swap, Clone, Stems, Mobile wizard, Support, Hindi/English |
| **V1.5 Growth** | Month 3–4 | SATB choir, Marketplace, 7 languages, Social share, India pricing |
| **V2 Scale** | Month 5–8 | Mobile app, API, DAW plugin, Distribution, Ghost singer |

**Why 4 months is realistic:**
- GPT-SoVITS: plug-in, no training from scratch
- BS-RoFormer + HTDemucs: Replicate API, 2 days to integrate
- Stripe + Razorpay + Supabase: billing and auth in 1 week
- No AI research needed — we're integrating world-class open models, not building new ones

---

## 11. ⚠️ Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Model quality below expectation | Medium | High | Beta test with 50 users before launch; quality score + free regen as safety net |
| Voice data privacy concern | Low | Critical | E2E encryption, SOC2 roadmap, private-by-default, India data residency |
| Copyright / IP legal issues | Medium | High | Royalty-free library only; user consent framework; DMCA process from day one |
| GPU costs exceed revenue | Medium | Medium | Credit-based throttling; Replicate pay-per-use until volume justifies dedicated GPU |
| Low mobile recording quality → bad clones | High | High | Input quality checker + guided wizard reduces this; key risk to monitor in beta |
| Razorpay UPI payment failures | Low | Medium | Fallback to card; retry logic; support bot handles payment issues instantly |

---

*PRD v2.0 — Updated June 2026 | Next Review: July 2026*
