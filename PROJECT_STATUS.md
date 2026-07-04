# MausamVox — Project Status

_Last updated: 2026-07-04 · Branch: `main` · Status: Active development (pre-launch)_

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

**API routes** (`src/app/api/`): auth, credits, voice-convert (RVC), voice-lab (clone CRUD + train + sample/presign), voice-swaps (persist/delete + signed proxy), stem-split / karaoke-split / gender-split, prepare-dataset, upload-stem (+presign/sign), stems/download, stems/refresh (batch re-sign of durable stem paths — used on cache restore). Proxy routes (`voice-model/[voiceId]/[filename]`, `voice-swaps/[swapId]/[filename]`) sign storage objects on-read to avoid stale-URL failures. Shared stem copy-to-Supabase helper lives in `src/lib/stem-persist.ts`.

---

## 3. Feature Status

| Feature | Status | Notes |
|---|---|---|
| Auth (sign-up/in, password reset, callback) | ✅ Working | Supabase Auth + auto profile row via DB trigger |
| Credits & billing | 🟡 Partial | Credit deduction + preview pricing live; Stripe/INR **not yet integrated**. `/api/credits/deduct` now session-authed (`1bbf49f`) — it previously trusted any `userId` in the body with the admin client, letting a logged-out caller drain any account; it now derives the target from the session (401 signed-out, 403 on userId mismatch). Known remaining softness: deduction is a read-then-update (not atomic; racing requests can over/under-spend — same note as gender-split's inline deduct) and swap/split charges are still client-initiated after success rather than server-gated |
| Founder/admin bypass | ✅ Working | `ADMIN_EMAILS` in `src/lib/admin.ts` skips all deductions |
| Voice Swap (full pipeline) | 🟡 Mostly working | Upload (75 MB) → stem/gender split → RVC swap → 30s preview → MP3 result + A/B; persists to durable storage. Recent Swaps now saves the **full track** (clone vocal + instrumental), not the bare vocal — client uploads the built mix; persist stores it as result_path (falls back to vocal on mix/upload failure). **RVC now outputs WAV** (`e5968d7`) to kill the second lossy vocal encode (vocal sounded duller than music); tradeoff = ~10× larger vocal fetch — watching mix/preview speed. Demucs still mp3 320 (next lever if more headroom needed). **All stems now have durable paths + re-sign** (`277cae1`): stem-split persists bass/drums/other, karaoke-split persists lead/backing, gender-split returns its male/female paths; the `mvox_stem_session` cache restore re-signs every URL via new `/api/stems/refresh` and shows a "Restored …" toast; swaps send the path of whichever stem is converted so voice-convert always re-signs; `mixStems` fails loudly (visible error, drops to Vocals-only) if any stem fetch fails instead of silently persisting a vocals-only "full song". Fixes the wrong-voice/missing-music-after-restore bug. |
| Fine-tune panel (RVC params) | ✅ Working | Adjustable protect / index_rate / filter_radius / rms_mix_rate w/ 12s preview; **start-point picker** (m:ss, bounded by song duration) to preview any window / skip music-only intros; "Reset to defaults" button restores all sliders in one click |
| Vocal polish — Warmth + Reverb + Echo | 🟢 New | Free client-side effects on the **converted vocal** only, chained `gain → [Warmth low-shelf] → [Reverb dry/wet] → [Echo delay bus] → destination`, all debounced live-preview and baked into the saved track via the same deferred one-shot persist. **Warmth**: low-shelf EQ (200Hz, 0–10 dB, bumped from 0–6 dB `f0408c1` for audibility). **Reverb** (`5c35648`): synthetic exponentially-decaying impulse response generated in code (`createReverbImpulse` in `audioClip.ts`, ~1.8s, no bundled asset/fetch) fed through one shared `ConvolverNode` (all vocal channels share it — convolution distributes over summed inputs, so this is identical to one per channel, just cheaper); reverb 0–100 maps to 0–50% wet (raised from 35% `9a5581d`), capped since 100% wet on a soloed vocal sounds washy. **Echo** (`0a9cd27`, new): shared feedback-delay bus (0.30s delay, 0.35 feedback → 2–3 repeats, 3.5kHz lowpass inside the loop darkens each repeat, tape-echo style); slider maps 0–100 to 0–50% wet (same ceiling as Reverb); wired via a lazy `getVocalSink()` — Reverb's outputs and un-reverbed vocals terminate at the echo bus when echo>0, else the destination; music bed never routes through it. All controls: **apply on both the Full-song AND Vocals-only tabs** (`f0408c1`) and are byte-identical to today's graph at their 0 default (no nodes inserted). "Polish" panel above the Fine-tune panel (`ResultStep.tsx`, `9b0100a` warmth / `5c35648` reverb / `0a9cd27` echo). **UI is now three rotary knobs** (`e8cccf5`): from-scratch 48px SVG `PolishKnob` (270° sweep, gradient value arc, rotating pointer, value readout below), vertical-drag (~200px full travel) + arrow-key a11y (`role="slider"`) + double-click-to-0, hints in title tooltips, one centered row — pure UI swap over the same 0–100 state, audio/debounce/persist untouched. Known limit: re-tweaking any knob after the initial settle updates preview but not the already-saved file (parent persists once); echo/reverb tails truncate at the end of the render (length = longest stem). |
| Auto pitch-shift (cross-range) | 🟡 Guarded | Recently guarded against unreliable stem detection (commit `8e53e45`) |
| Voice Lab (express + studio clone) | 🟡 Partial | Record/upload → dataset prep → Replicate RVC training → test; durable model persistence fixed. **Express Clone is now real** (`ec5d4b2`): same training pipeline as Studio with server-decided epochs (18 express ≈ 15 min / 50 studio ≈ 45 min; client can no longer send an epoch), express rows insert `pending` (the fake instant-'ready'-no-model path is gone), SetupStep card enabled with honest copy ("Quick clone · Ready in ~15 minutes" — no more "instant zero-shot"), per-tier training ETAs, dead "unlimited on Pro" hint and stale TestStep disclaimer removed. ⚠️ Untested on live: needs one real express train + swap listen before telling users about it. Recording UI now shows a **read-aloud script** (Quick/Pro modes) with phonetically-varied passages + a shuffle button + singing guidance (low/high, soft/loud) — `recordingScripts.ts` (`61e7ad2`); record-card clipping + duplicate-hint cleanup followed (`b7887ed`). Helps the planned dry-mic retrain of Raju produce a consistent take. |
| Stem Studio (standalone page) | ✅ Working | Real `/stem-studio` page (`041ee22`), replacing the "coming soon" placeholder: upload MP3/WAV/M4A (75 MB) → Demucs 4-stem split → play + download each stem (Vocals/Bass/Drums/Other). User-facing copy brands the tech "StemSplit Engine" (`7dce99b`), matching TechSection — "Demucs" stays internal only. Reuses existing machinery only (upload presign, `/api/stem-split`, `/api/stems/download`, shared AudioPlayer/VSidebar/VToast) — no new backend/DB. 50 credits on success (same `stem_split` price as the swap flow), free plan allowed, admin bypass. Auth-protected via middleware like voice-swap/voice-lab; live links in dashboard card + both sidebars (VSidebar gained `activeTool` prop). Deferred: instrumental/zip download, BPM/key detection (landing promises it), per-stem editing |
| Karaoke Mode v1 ("Sing over it") | 🟢 New | Shared `KaraokePanel` (`d9a1ec1`), fully client-side: Stem Studio result view ("Sing over it" — instrumental built in-browser from bass+drums+other) and `/swaps/[id]` ("Sing along" — duet over the saved clone mix). Mic capture reuses Voice Lab helpers (raw, no echo-cancel); downloads = raw take (MP3, or native format if decode unsupported) + best-effort duet mix (offset-aligned offline WebAudio sum → lamejs MP3). Honest UI: "v1 — no lyrics display yet" tag, headphones note, best-effort-mix caveat. **Deferred to v2** (logged intent): lyrics display/timed highlighting (needs licensed synced-lyrics data), latency calibration/nudge, saving takes to the account (new table + grants for both roles per gotcha), pitch feedback |
| Karaoke/gender split (within Voice Swap) | 🟡 Partial | MVSEP-based; lead/backing + male/female routing |
| Duet split confirm | ✅ Working | Declared-duet uploads no longer auto-run the 250cr gender-split; the amber "Run Duet Split before continuing" gate shows and the user must click "Split duet · 250 cr · Premium" to proceed |
| Dashboard counts | ✅ Working | Saved Tracks (ex "Voice Swaps") + Voice Clones counts refetch on window focus / tab visibility (no longer stale after create/delete elsewhere); delete refetches authoritatively instead of optimistic local −1. Swap count/list (dashboard + voice-swap history) now filter `result_path` not-null (`b3edba7`) — only playable swaps count; unplayable phantom rows (persist soft-fail or 90-day expiry) are excluded, and the 2 existing phantoms were deleted from prod. Stat relabeled "Saved Tracks" since it counts saved versions (every full swap / fine-tune apply is a row — e.g. one tuning session = 14 rows of one song), not unique songs |
| Sidebar "My Voices" badge | ✅ Working | VSidebar + VLSidebar now show a live `voice_clones` count (was hardcoded `'3'`) |
| Sidebar user row | ✅ Working | VSidebar + VLSidebar show the real name/initial (same derivation as the dashboard header: metadata name, else email prefix) and the real `users.plan` ("Free/Starter/Pro/Studio Plan") — was hardcoded "Mausam / Pro Plan" (`68d7478`) |
| Onboarding journey | ✅ Working | Persona → magic moment → action → finale screens. Magic-moment screen no longer fakes a demo player (`95956a6`): the result card is a static, explicitly-badged "Preview" (no play button/duration/score); fake "Try another style" button removed. Finale screen greets the real user (`139229a`) — same name derivation as the dashboard header (metadata name, else email prefix); plain "You're in." until loaded — was hardcoded "You're in, Mausam." for every account |
| Landing page | ✅ Working | Full marketing site |
| Choir generator / marketplace / API | ⬜ Not started | PRD V1.5–V2 scope |
| Result screen — honest summary | ✅ Working | Fake hardcoded Quality Score panel (82/100 + four invented sub-scores) removed (`98bed97`); result now shows a "Swap complete" summary with real facts only: voice model used (duet-aware `voiceName` prop), duration, full-mix vs vocals-only. No quality metric is shown because none is computed (`voice_swaps.quality_score` is always null) |
| Configure screen — honest controls | ✅ Working | Investigation (2026-07-01) confirmed **Style Intensity** (→`index_rate`) and **Pitch Shift** are the only two controls with a real backend effect. **Age Range / Accent / Output Language** are never sent to any API — now shown **disabled with a "Coming soon" badge** (`5dbac6e`) instead of implying a working capability. **Gender Lock** has a narrow real effect (routes which duet stem is converted, only in single-singer duet mode) but its old copy claimed a "hard guarantee" on the *output voice's gender*, which it never delivered (gender is fully determined by the chosen voice model) — copy reworded to describe the actual stem-routing behavior; control left enabled. |

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

Supabase Postgres, migrations in `supabase/migrations/` (17 migrations, Jun 11–Jul 3).

**Core tables:** `users` (plan, credits default 500, onboarded), `voice_clones` (clone_type, status, model_url, score), `voice_swaps` (persisted swap outputs), `preview_uses` (free-preview tracking). RLS enabled on user tables. **Note:** `voice_swaps` uses no RLS — access is via admin client + app-code ownership checks, and **each new DB op on it needs its own explicit `GRANT` to `service_role`** (recurring gotcha — see migrations `20260624*`/`20260625*`).

Storage buckets for voice samples, voice models, and swap outputs (signed on-read).

---

## 6. Known Issues / Open Items

- 🐛 **PARKED: Duet swap — male voice sounds like original.** **Root cause (confirmed 2026-06-29):** weak clone identity. Raju was trained on **stem-separated audio** (not a clean dry mic), so the clone's identity is thin and falls back toward the source singer on conversion — producing the near-passthrough.
  - **Ruled out (all confirmed 2026-06-29):** the four RVC conversion params (`index_rate`/`protect`/`filter_radius`/`rms_mix_rate` are **identical** on the single-voice and duet paths, not weaker); pitch (auto key-match is skipped on duet stems, but the male stem is already within Raju's ~235 Hz range, so pitch placement is not the cause); routing; and mix wiring.
  - **NOT the cause:** undertraining or samplerate mismatch — the "direct RVC undertraining test" is dropped as the next step.
  - **Agreed fix:** clean **dry-mic retrain** of Raju (3–5 min, no backing music, quiet room). This also fixes the glitchy/not-smooth quality on non-duet clones — same root cause.
  - **Status:** parked pending the retrain decision.
- 💳 **Billing not wired:** Stripe + India INR tiers (₹499/₹999/₹2,499) from PRD are not implemented.
- 🌐 **Languages:** Only EN/Hindi-ready in practice; Bengali/Tamil/Telugu/Punjabi/Marathi pending.
- ⏱️ Long-running AI jobs depend on Replicate/RunPod/MVSEP cold starts and poll ceilings (RVC poll raised to ~25 min). **Per-stage timing logs are now live** (`73fb83c`): in Vercel logs, search `TIMING` to see each stage's cold-start/queue vs compute breakdown — `[stem-split]`/`[karaoke-split]`/`[voice-convert] TIMING … cold-start/queue=… compute=… total=…` (from Replicate timestamps + `metrics.predict_time`), and `[gender-split] TIMING … mvsep-total(wall-clock)=…` (MVSEP gives no queue/compute split). Read after one real swap.
- 🧾 **Honesty-audit backlog (2026-07-03, prioritized; top 2 already fixed).** Remaining items from the app-wide stale-numbers/dead-buttons audit, roughly in fix order: (1) ~~footer legal links dead~~ **fixed `3027ffa`** — real `/privacy` + `/terms` static pages (founder-provided copy, shared `LegalPage` shell); Support/API Docs/Discord/Twitter removed from the footer entirely until they exist; (2) ~~dashboard "Credits Left" not refetched on focus/visibility~~ **fixed `750cf42`** — credits query moved into `refetchCounts`, refreshing with the counts; (3) ~~both sidebars hardcode "Mausam / Pro Plan" user row~~ **fixed `68d7478`** (leftover: the user row still has cursor-pointer with no click handler); (4) ~~onboarding finale greets every user "You're in, Mausam."~~ **fixed `139229a`** (leftover: "Share my first track" still only toasts); (5) ~~dead "Settings" menu items~~ **fixed `750cf42`** — both dropdowns now show Settings disabled with a "Soon" marker (kept visible per the app's dim+Soon pattern rather than removed); (6) ~~Hero "Watch Demo" button has no onClick~~ **fixed `4fff5b6`** — now a real "See How It Works" anchor to `#features` (nav's existing pattern), down-arrow icon so nothing implies a video; (7) ~~dashboard Recent Swaps "Open" goes to generic `/voice-swap`~~ **fixed `1701562`** — new read-only `/swaps/[swapId]` page (play via existing result.mp3 proxy + AudioPlayer, details incl. duration from file metadata, download via fetch→blob, delete; honest "expired" state for 90-day-cleaned rows; middleware-protected); vestigial always-null quality-score badge also removed from dashboard rows; (8) ~~landing over-claims~~ **fixed `6e4c74b`** — trust chips reduced to three true claims (also dropped "Prorated upgrades"); QualitySection rebuilt around the real preview/A/B/Fine-tune features (fake score narrative + "regenerate free" gone); Testimonials section deleted entirely (fictional people praising partly-unshipped features) — re-add only with real consented quotes; (9) ~~sidebar coming-soon items styled as live links~~ **fixed `bbc98b2`** — both sidebars' unbuilt tools + Library rows now dim + "Soon" pill (dashboard pattern), toasts and the sidebars' `onToast` prop removed; (10) ~~dashboard delete fails silently on non-ok response~~ **fixed `b41f0ca`** — VToast added to the dashboard; non-ok/network delete failures now show the API's error (or status/network message); (11) VLRightPanel "Retrain any voice" note has no retrain flow.
- ⏱️ **Voice-swap speed backlog (investigated 2026-07-03, cache-key fix `184b06f` shipped; rest open).** The ~7-min swap is dominated by compute, and the RVC step's ~3 min is mostly NOT the 120 MB model download (~10–30s, cold instances only). The pinned RVC model (zsxkib/realistic-voice-cloning = AICoverGen) runs a full song-cover pipeline per job: **three MDX-Net separation passes on our already-isolated vocal** (vocals/instrumental, main/backup, de-reverb — each doubled by denoise) before RVC even starts. Evidence: predict_times are bimodal — ~52–70s when the cog's per-song-hash cache skips the MDX passes (fine-tune re-runs) vs ~137–217s fresh. Options ranked: (1) **switch to a bare RVC-only cog** — the real lever, ~1.5–2.5 min off fresh swaps, but needs a quality A/B (we'd lose its de-reverb preprocessing); (2) related quick A/B: we never zero the cog's reverb defaults, so **every converted vocal gets ~20% wet baked-in reverb** (reverb_size 0.15/wetness 0.2) on top of our own Polish reverb — try explicit zeros and compare; (3) Replicate deployment keep-warm: only saves cold-start, ~$600–1,500/mo, skip pre-launch; (4) Demucs 2-stem mode: post-processing only in htdemucs (full 4-source compute regardless), saves ~10–20s of encoding while breaking mixStems + Stem Studio — rejected.
- 🐛 **Known, unreachable: duet Mode 2/3 ("both singers converted") female-vocal job is missing `protect`/`filterRadius`/`rmsMixRate` overrides** that the male job's fetch includes (`VoiceSwapPage.tsx` dual-job branch). Found during the 2026-07-01 Warmth investigation. **Not currently exploitable** — the only source of those overrides is the Fine-tune panel's "Apply to Full Track", and that panel is intentionally hidden whenever a second converted vocal exists (duet fine-tuning is a v2 follow-up). Leave as-is until duet fine-tuning ships; fix then by adding the three missing keys to the female fetch body.

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
- **Replicate filename-length bug** — Supabase signed URLs end in `?token=<300+ char JWT>`; the RVC container derives its local filename from the URL's last path segment without stripping the query string, hitting the OS 255-char limit (Errno 36). **Solved** via the `/api/voice-model/<id>/…` proxy route that 307-redirects to the real signed URL. ⚠️ **That last URL segment is also the container's MODEL CACHE KEY** (it extracts to a folder named after it and skips the download if the folder exists on a warm instance). The original constant `model.zip` made every voice share one cache entry — wrong-voice weights could be silently reused across back-to-back swaps. Fixed `184b06f`: voice-convert now builds `<voiceId>-<sha1(model_path)[:8]>.zip`, unique per voice and per retrain. Never revert to a constant filename.
- **Use `@breezystack/lamejs`, not `lamejs`** — the original `lamejs` package is broken/unmaintained for our MP3 encoding path.
- **Use `undici` with `allowH2: false`** for Supabase calls from Node — forcing HTTP/1.1 avoids HTTP/2 issues against Supabase.
- **Node v26 HTTP/2 flood-protection issue** — Node 26's HTTP/2 stack trips flood protection on certain request patterns; another reason the `undici` / `allowH2: false` path above is required.
- **Supabase Free 50 MB object cap** — trained RVC model zips are 116 MB+, which exceeds the Free-tier storage object limit. **Required upgrading to Supabase Pro** to store models.
- **Stem-split is `cjwbw/demucs` running 4-stem `htdemucs`** — the cog's stem-selection param is **`model_name`** (not `model`); pass it explicitly. Its output object **always has 6 fixed keys** (`bass, drums, guitar, other, piano, vocals`), but under `htdemucs` **`guitar` and `piano` come back empty** — so 6 keys in the logs does NOT mean 6-stem compute. To actually get guitar/piano you'd set `model_name: 'htdemucs_6s'` (slower, ~1.5–2×) and stop discarding them in `extractStems`. (settled `401a5fe`; don't re-debug) **Marketing copy is now aligned to 4-stem** (landing Features/TechSection/Pricing-Starter; `76a0164`) — if 6-stem ever ships, those strings need to flip back.
