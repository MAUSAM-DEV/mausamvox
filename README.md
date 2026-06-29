# MausamVox

AI voice & music creation platform — clone voices, swap vocals on a track, and split stems, with hard controls, free previews, and Indian-language support. Built first for India.

> Product spec: [MausamVox-PRD-v2.md](MausamVox-PRD-v2.md) · Engineering status & open bugs: [PROJECT_STATUS.md](PROJECT_STATUS.md)

---

## Stack

- **Next.js 14** (App Router) · React 18 · TypeScript · Tailwind CSS
- **Supabase** — Postgres, Auth, Storage (`@supabase/ssr`)
- **AI inference** — [Replicate](https://replicate.com) RVC for voice conversion **and** RVC model training (`replicate/train-rvc-model`); [MVSEP](https://mvsep.com) for stem / gender splitting
- **Hosting** — Vercel

---

## Quick start

```bash
npm install
cp .env.local.example .env.local   # then fill in the values below
npm run dev                        # http://localhost:3000
```

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Next.js lint |
| `node scripts/migrate.mjs` | Apply Supabase SQL migrations |

### Environment variables

`.env.local.example` only lists the two public keys. The full set the app needs:

| Var | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin client (bypasses RLS) |
| `REPLICATE_API_TOKEN` | RVC voice conversion + model training |
| MVSEP credentials | Gender / stem splitting |

`RUNPOD_*` vars are referenced in `src/lib/runpod.ts` but the live training path uses Replicate — see the note in [PROJECT_STATUS.md](PROJECT_STATUS.md).

---

## How it works

```
Browser ─▶ Next.js middleware (Supabase session refresh)
        ─▶ App Router pages (/voice-swap, /voice-lab, /dashboard …)
        ─▶ API routes (src/app/api/*)
              ├─ Replicate  → RVC convert + RVC train
              ├─ MVSEP      → stem / gender / karaoke split
              └─ Supabase   → Postgres + Storage (signed-on-read proxies)
```

Three Supabase clients live in `src/lib/supabase/`: `client` (browser), `server` (anon, RSC/routes), and `admin` (service-role, server-only). Storage objects are **signed on read** through proxy routes (`/api/voice-model/...`, `/api/voice-swaps/...`) so swaps and models never break on expired URLs.

### Core flows

- **Voice Swap** (`/voice-swap`) — upload a track (≤75 MB) → MVSEP stem/gender split → RVC vocal conversion → free 30 s preview → MP3 result with A/B. Persisted durably to the `voice-swaps` bucket.
- **Voice Lab** (`/voice-lab`) — record or upload samples → dataset prep → RVC model training on Replicate → test. Trained model stored in the private `voice-models` bucket.
- **Stem Studio** — karaoke (lead/backing) and gender (male/female) separation via MVSEP.

---

## Project layout

```
src/
  app/
    api/          # route handlers (auth, credits, voice-convert, voice-lab,
                  #   voice-swaps, *-split, upload-stem, stems)
    auth/         # sign-in / sign-up / password reset pages
    voice-swap/   voice-lab/   dashboard/   onboarding/   page.tsx (landing)
  components/     # landing, auth, dashboard, onboarding, voice-swap, voice-lab, ui
  lib/            # supabase clients, admin allowlist, rate-limit, runpod
  middleware.ts   # Supabase session refresh
supabase/migrations/   # SQL migrations (run via scripts/migrate.mjs)
```

---

## Conventions & gotchas

- **`voice_swaps` has no RLS.** Access is service-role + app-code ownership checks. **Every new DB operation on it needs its own explicit `GRANT` to `service_role`** (see migrations `20260624*` / `20260625*`) — a recurring trip-up.
- **Founder/admin bypass** — emails in `src/lib/admin.ts` (`ADMIN_EMAILS`) skip all credit deductions. Keep the list short; never commit real user emails.
- **Replicate FileOutput** — outputs are wrapped objects, not strings; `JSON.stringify` shows `{}`. Use the `toUrlString()` helper (call `.url()`).
- **Model proxy filenames** — Replicate's RVC container derives a local filename from the URL's last path segment without stripping the query string, so signed Supabase URLs (300+ char tokens) hit Errno 36. The `/api/voice-model/<id>/model.zip` proxy 307-redirects to keep the segment clean.

---

## Status

Pre-launch, active development. Voice Swap and Voice Lab pipelines work end-to-end; billing (Stripe/INR), the choir generator, marketplace, and public API are not yet built. Current open issues — including a known weak-RVC-conversion bug on cloned voices — are tracked in [PROJECT_STATUS.md](PROJECT_STATUS.md).
