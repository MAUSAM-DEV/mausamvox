# MausamVox — Project Status

_Last updated: 2026-06-29 · Branch: `main` · Status: Active development (pre-launch)_

> **Vision:** "The most powerful, honest, and creator-friendly AI voice platform — built first for India, loved everywhere." (see [MausamVox-PRD-v2.md](MausamVox-PRD-v2.md))

MausamVox is an AI voice & music creation platform: clone voices, swap vocals on a track, split stems, and (planned) generate SATB choirs — with hard controls, free previews, honest billing, and Indian-language support.

---

## 1. Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14.2 (App Router) + React 18 + TypeScript |
| Styling | Tailwind CSS 3.4 |
| Auth & DB | Supabase (Postgres + Auth + Storage), `@supabase/ssr` |
| AI inference | **Replicate** (RVC voice conversion), **RunPod** serverless (GPT-SoVITS train/infer), **MVSEP** (gender/stem split) |
| Audio | `@breezystack/lamejs` (MP3 encode), `jszip` (dataset packaging) |
| Hosting | Vercel (deployed) |
| Testing | Playwright (present in deps; limited use) |

---

## 2. Architecture Overview

Next.js App Router monolith. `src/middleware.ts` refreshes Supabase sessions on every request. Three Supabase clients in `src/lib/supabase/`: `client` (browser), `server` (RSC/route, anon), `admin` (service-role, server-only, bypasses RLS).

**Surfaces (pages):**
- `/` — landing (`src/components/landing/*`)
- `/auth/*` — sign-in, sign-up, forgot/update password
- `/onboarding` — persona-driven first-run journey
- `/dashboard` — hub
- `/voice-swap` — upload track → split → swap vocals → preview → result
- `/voice-lab` — guided voice cloning wizard (express + studio/pro record)

**API routes** (`src/app/api/`): auth, credits, voice-convert (RVC), voice-lab (clone CRUD + train + sample/presign), voice-swaps (persist/delete + signed proxy), stem-split / karaoke-split / gender-split, prepare-dataset, upload-stem (+presign/sign), stems/download. Proxy routes (`voice-model/[voiceId]/[filename]`, `voice-swaps/[swapId]/[filename]`) sign storage objects on-read to avoid stale-URL failures.

---

## 3. Feature Status

| Feature | Status | Notes |
|---|---|---|
| Auth (sign-up/in, password reset, callback) | ✅ Working | Supabase Auth + auto profile row via DB trigger |
| Credits & billing | 🟡 Partial | Credit deduction + preview pricing live; Stripe/INR **not yet integrated** |
| Founder/admin bypass | ✅ Working | `ADMIN_EMAILS` in `src/lib/admin.ts` skips all deductions |
| Voice Swap (full pipeline) | 🟡 Mostly working | Upload (75 MB) → stem/gender split → RVC swap → 30s preview → MP3 result + A/B; persists to durable storage |
| Fine-tune panel (RVC params) | ✅ Working | Adjustable protect / index_rate / filter_radius / rms_mix_rate w/ 12s preview; **start-point picker** (m:ss, bounded by song duration) to preview any window / skip music-only intros; "Reset to defaults" button restores all sliders in one click |
| Auto pitch-shift (cross-range) | 🟡 Guarded | Recently guarded against unreliable stem detection (commit `8e53e45`) |
| Voice Lab (express + studio clone) | 🟡 Partial | Record/upload → dataset prep → RunPod training → test; durable model persistence fixed |
| Stem Studio (karaoke/gender split) | 🟡 Partial | MVSEP-based; lead/backing + male/female routing |
| Duet split confirm | ✅ Working | Declared-duet uploads no longer auto-run the 250cr gender-split; the amber "Run Duet Split before continuing" gate shows and the user must click "Split duet · 250 cr · Premium" to proceed |
| Onboarding journey | ✅ Working | Persona → magic moment → action → finale screens |
| Landing page | ✅ Working | Full marketing site |
| Choir generator / marketplace / API | ⬜ Not started | PRD V1.5–V2 scope |

Legend: ✅ working · 🟡 partial/in-progress · ⬜ not started

---

## 4. Recent Work (last ~15 commits)

Focus has been hardening the **Voice Swap / Voice Convert** pipeline:
- Auto pitch-shift for cross-range swaps, then guarded against bad stem detection
- Single source of truth for one-singer duet routing
- Fine-tune panel with real 30s preview + A/B comparison
- Durable model/stem persistence + sign-on-read to kill expiring-URL failures
- MVSEP gender-split error surfacing and "still downloading" handling
- Async create+poll for stem-split to eliminate 504s

---

## 5. Database

Supabase Postgres, migrations in `supabase/migrations/` (16 migrations, Jun 11–25).

**Core tables:** `users` (plan, credits default 500, onboarded), `voice_clones` (clone_type, status, model_url, score), `voice_swaps` (persisted swap outputs), `preview_uses` (free-preview tracking). RLS enabled on user tables. **Note:** `voice_swaps` uses no RLS — access is via admin client + app-code ownership checks, and **each new DB op on it needs its own explicit `GRANT` to `service_role`** (recurring gotcha — see migrations `20260624*`/`20260625*`).

Storage buckets for voice samples, voice models, and swap outputs (signed on-read).

---

## 6. Known Issues / Open Items

- 🐛 **OPEN: Duet swap — male voice sounds like original.** **Root-caused (2026-06-29):** RVC ran but barely transformed identity — a near-passthrough (A/B of persisted result vs male input stem: waveform corr 0.910 @ zero lag; output is 48 kHz so it *did* come from RVC, ruling out mix-routing/labels/wrong-file). Model zip is valid (real 57.5 MB `.pth` + index). Likely an undertrained model (`DEFAULT_EPOCH=50`, `voice_clones.score` never computed) or an RVC samplerate/config mismatch. Decisive next step: a controlled direct RVC call to confirm (spends a Replicate credit).
- 💳 **Billing not wired:** Stripe + India INR tiers (₹499/₹999/₹2,499) from PRD are not implemented.
- 🌐 **Languages:** Only EN/Hindi-ready in practice; Bengali/Tamil/Telugu/Punjabi/Marathi pending.
- ⏱️ Long-running AI jobs depend on Replicate/RunPod/MVSEP cold starts and poll ceilings (RVC poll raised to ~25 min).

---

## 7. Setup & Environment

```bash
npm install
npm run dev      # next dev
npm run build    # next build
```

**Required env vars** (`.env.local` — see `.env.local.example` for the public ones):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only admin client)
- `REPLICATE_API_TOKEN` (RVC voice conversion)
- `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID_INFER`, `RUNPOD_ENDPOINT_ID_TRAIN` (GPT-SoVITS train/infer)
- MVSEP credentials (gender/stem split)

DB migrations run via `node scripts/migrate.mjs`.

---

## 8. Repository Notes

- Untracked working files present: `.pull-ab.tmp.mjs`, `repro-listen/` (local repro/scratch — consider `.gitignore` or removal).
- `MausamVox-PRD-v2.md` is the source-of-truth product spec.
- `README.md`, this file, and the PRD are the primary onboarding docs.

---

## 9. Known gotchas (reference, do not re-debug)

These are settled. They cost real time to find — don't rediscover them.

- **MVSEP male/female stem labels can be unreliable** for some tracks — the "male"/"female" split occasionally mislabels or bleeds. Treat gender-split output as a hint, not ground truth.
- **Replicate filename-length bug** — Supabase signed URLs end in `?token=<300+ char JWT>`; the RVC container derives its local filename from the URL's last path segment without stripping the query string, hitting the OS 255-char limit (Errno 36). **Solved** via the `/api/voice-model/<id>/model.zip` proxy route that 307-redirects to the real signed URL.
- **Use `@breezystack/lamejs`, not `lamejs`** — the original `lamejs` package is broken/unmaintained for our MP3 encoding path.
- **Use `undici` with `allowH2: false`** for Supabase calls from Node — forcing HTTP/1.1 avoids HTTP/2 issues against Supabase.
- **Node v26 HTTP/2 flood-protection issue** — Node 26's HTTP/2 stack trips flood protection on certain request patterns; another reason the `undici` / `allowH2: false` path above is required.
- **Supabase Free 50 MB object cap** — trained RVC model zips are 116 MB+, which exceeds the Free-tier storage object limit. **Required upgrading to Supabase Pro** to store models.
