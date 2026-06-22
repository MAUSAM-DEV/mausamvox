-- Fix 2, Step 1 — durable storage for trained voice models.
--
-- Trained RVC model zips are returned by replicate/train-rvc-model on the
-- ephemeral replicate.delivery CDN and stored raw in voice_clones.model_url,
-- with no durable copy. This adds the durable home; later steps copy the model
-- here on training completion and sign it on read at swap time.
--
-- Bucket is PRIVATE with NO RLS policies — intentionally. Every access path to
-- voice-models is server-side or signed-URL, both of which bypass RLS:
--   • upload (api/voice-lab/train) runs as service role → bypasses RLS
--   • swap-time read (api/voice-convert) signs as service role and hands a
--     signed URL to Replicate; service role AND signed URLs both bypass RLS
--   • the browser never reads/writes this bucket directly (unlike voice-samples,
--     which needs own-folder policies for in-browser sample playback)
-- So a private bucket with zero policies is fully functional here and maximally
-- locked down (no authenticated-role access at all). If a future flow ever needs
-- direct in-browser model access, add own-folder policies via the dashboard then.
--
-- Path scheme: voice-models/<user_id>/<clone_id>.zip
--
-- ⚠️ APPLIED BY HAND on 2026-06-21 (production project rmycibkzhwgxnohwzrqf), NOT
-- by running this file as a script. Provenance of the live objects, which this
-- file accurately reflects:
--   • bucket — created via the storage admin API (createBucket, public=false)
--   • column — `alter table … add column` run in the SQL editor on production
--   • policies — NONE created (intentionally skipped, per the rationale above)
-- (An earlier round of work landed on a Supabase preview-branch DB; branching has
-- since been disabled, so production is now the single source of truth.)
-- Treat this file as the DECLARATIVE record of state, not a re-runnable script.

-- ── bucket (private, no policies) ─────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('voice-models', 'voice-models', false)
on conflict (id) do nothing;

-- ── voice_clones.model_path ─────────────────────────────────────────────────
-- Durable storage path of the persisted model in the voice-models bucket
-- (e.g. <user_id>/<clone_id>.zip). model_url is kept for now (legacy rows +
-- soft-fallback); swap-time consumption will prefer model_path and sign it.
alter table public.voice_clones
  add column if not exists model_path text;
