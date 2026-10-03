# START HERE — MausamVox quick orientation

_Refreshed 2026-10-03 (migrations + Replicate updated later the same day) from `PROJECT_STATUS.md`. If the two ever disagree, **`PROJECT_STATUS.md` wins** — it holds the full detail; this file is the one-page map._

## 1. How we work

- Founder is a non-coder and directs **one step at a time** — do the step asked, then stop.
- Claude does all file edits. No terminal commands for the founder unless asked.
- **Testing happens only on live Vercel:** commit → push → wait for Vercel "Ready" → test.
- Before every commit: `tsc --noEmit` **and** a clean build (`npm ci && npm run build`).
- **Never apply database migrations** — write the file, hand it to the founder for the Supabase SQL Editor.
- Never put secrets in chat or code.
- After each step: update `PROJECT_STATUS.md`, add a dated `CHANGELOG.md` line with the work commit's hash, commit, push (see `CLAUDE.md`).

## 2. What MausamVox is

AI voice & music platform, India-first: clone your voice, swap vocals on a song, split stems, make full songs from lyrics, stack choir harmonies, turn a hum into an instrument. Product spec: `MausamVox-PRD-v2.md`.

**Stack:** Next.js 14.2 + React 18 + TypeScript + Tailwind · Supabase (DB, auth, storage) · Replicate (all AI models) + MVSEP (duet split) · hosted on Vercel.

## 3. Current engines (what actually runs)

| Tool | Engine | Price to user | Switch / notes |
|---|---|---|---|
| **Song Studio** | **Google Lyria 3 Pro** (`google/lyria-3-pro`, version pinned in `src/lib/song-engine-lyria.ts`) | 250 cr per song (500 cr for "Make 2 versions") | Live — production logs from 2026-10-03 show Lyria jobs. Picked by the Vercel env var `SONG_ENGINE=lyria`. Fallbacks (same variable): `minimax26`, `minimax` (2.5), `acestep`, `elevenlabs`. Unset → `acestep`. Cost us $0.08/song (~60–72% margin). Songs up to ~3:00; audio only gets a true-peak limiter (no EQ). |
| Song Studio AI lyrics | gpt-4o-mini on Replicate | 5 cr | Any language (26 named + "Other"). |
| Voice Swap / AI Cover | Demucs (stems) → UVR karaoke split → bare RVC (`pseudoram/rvc-v2`) | 200 cr full swap | `RVC_ENGINE` unset = bare RVC; `cover` = old slower engine (rollback). Warm pings keep it ~1 min. |
| Duet split | MVSEP | 250 cr | Manual "Split duet" button. |
| Stem Studio | Demucs 4-stem | 50 cr | |
| Voice Lab (cloning) | Replicate RVC training | — | Optional free noise cleanup before training. |
| Choir Composer | ffmpeg only (no AI) | 25 cr | Up to 3 min input. |
| Instruments | Basic Pitch + FluidSynth (no AI vendor) | 25 cr | Hum up to 25 s, 32 instruments. |
| Lyrics in Perform Live | WhisperX | 25 cr | |
| Share as Video | ffmpeg | free | `ffmpeg-static` pinned to 5.2.0 — don't upgrade blindly. |

Users never see engine names (enforced in code).

## 4. Open items (most important first)

1. **Song Studio redesign (`9ef4b12`) is untested live.** Test: Simple flow in a non-English language, style chips/tempo/key reach the saved style, Reuse style, play while scrolling, phone layout.
2. **Lyria content flag (E005) is intermittent** — identical lyrics can pass once and fail once; the user now sees an honest "try again" message (`156b88d`). Watch how often it hits non-English lyrics — a product risk for the "any language" promise.
3. **Lyria still untested live:** target-length trim, resuming 2 pending songs after closing the tab.
4. **Pricing table still lists features that don't exist:** Pro "Style marketplace"; Studio "API access", "DAW plugin (VST/AU)", "Priority GPU queue", "Team workspace". Decide: build, remove, or mark "coming soon".
5. **Studio plan "Unlimited credits"** has no cap — uncapped AI cost per user. Needs a cap or fair-use rule before launch.
6. ✅ **Replicate topped up** — founder added $10 on 2026-10-03, so the under-$5 throttle (6 requests/min) should no longer apply. Keep the balance above $5 once real users arrive.
7. **Song lost if user never returns** — a finished song is only saved when the user comes back within ~1 h. Real fix = a Replicate webhook.
8. **Billing not wired** — no Stripe / INR plans yet.
9. **Large backlog of live acceptance tests** (Choir/Instruments live checks, recording wizard on phones, lyrics regenerate, polish re-save, Share as Video, etc.) — full numbered list in `PROJECT_STATUS.md` ("START HERE NEXT SESSION" section).
10. **Seed-VC listening test (2026-10-03) — awaiting your verdict:** "Swap – Current" vs "Swap – Seed-VC" in Saved Tracks (30 s excerpt, MKIPHONE). Seed-VC only runs on a GPU in practice (53 min for 30 s on this Mac); local files ~4.4 GB on the SSD until you say delete.
11. **Parked:** duet swap male voice sounds like the original → fix is a clean dry-mic retrain of the "Raju" voice.

### Migrations

- **All 20 migrations in `supabase/migrations/` are applied** (read-only check of the live database, 2026-10-03):
  - share links `20260712000002` → `voice_swaps.share_token` exists
  - Voice Library `20260713000000` → all 4 new `voice_clones` columns exist
  - waitlist `20260814000000` → table exists (15 sign-ups so far)
  - polish re-save grant `20260707000000` → a saved track was re-saved via UPDATE on 2026-08-13 (only possible with the grant)
  - earlier: `20260705*`, credit functions `20260712000000/1`, `kind` `20260712000003`, `20261002000000/01/02`

## 5. Launch checklist

- [ ] Run the open live tests above (Song Studio redesign first).
- [x] Waitlist migration applied (confirmed 2026-10-03).
- [ ] Fix or remove the unbuilt pricing-table features (item 4).
- [ ] Cap the Studio plan's "Unlimited credits" (item 5).
- [x] Top up Replicate — $10 added 2026-10-03.
- [ ] Decide on billing: Stripe / INR plans (item 8) — or launch free-credits-only.
- [ ] Optional: Replicate webhook so no finished song is ever lost (item 7).
- [ ] **Open sign-ups:** Vercel → Settings → Environment Variables → `NEXT_PUBLIC_SIGNUPS_OPEN` = `true` → **Redeploy** (saving the variable alone does nothing — it's baked in at build time).

## 6. Handy switches (Vercel → Settings → Environment Variables, then Redeploy)

- `SONG_ENGINE` — Song Studio engine (currently `lyria`). After a change, reload any open Song Studio tab.
- `RVC_ENGINE` — voice-swap engine (unset = fast bare RVC).
- `NEXT_PUBLIC_SIGNUPS_OPEN` — `true` opens public sign-ups; anything else = closed (waitlist).

## 7. Where things live

- `PROJECT_STATUS.md` — full current state, every open test, gotchas.
- `CHANGELOG.md` — dated history, newest first, with commit hashes.
- `CLAUDE.md` — working rules and recurring gotchas (`voice_swaps` grants, never store signed URLs, keep Supabase branching OFF).
- `supabase/migrations/` — every DB change (founder applies by hand).
- `src/lib/song-engine*.ts` — Song Studio engines; `src/lib/rvc-engine.ts` — voice-swap engine.
