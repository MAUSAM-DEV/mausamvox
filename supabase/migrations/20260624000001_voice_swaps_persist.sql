-- Durable storage for voice swap results.
--
-- Swap results are returned by Replicate on the ephemeral replicate.delivery CDN
-- and stored raw in voice_swaps.result_url, which expires after 1 hour.
-- This migration adds the durable home; the persist endpoint copies the MP3 here
-- on swap completion and signs it on read for any future playback UI.
--
-- Bucket is PRIVATE with NO RLS policies — intentionally. Every access path is
-- server-side or signed-URL (both bypass RLS):
--   • upload (/api/voice-swaps/persist) runs as service role
--   • playback (/api/voice-swaps/[id]/[filename]) signs as service role and redirects
--   • the browser never reads/writes this bucket directly
--
-- Path scheme: voice-swaps/<user_id>/<swap_id>.mp3
--
-- ⚠️  APPLY BY HAND in Supabase SQL Editor (production project rmycibkzhwgxnohwzrqf).
-- This file is the declarative record; treat it as re-runnable (all statements are
-- idempotent via IF NOT EXISTS / ON CONFLICT DO NOTHING).

-- ── bucket (private, no policies) ─────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('voice-swaps', 'voice-swaps', false)
on conflict (id) do nothing;

-- ── voice_swaps.result_path ────────────────────────────────────────────────────
-- Durable path of the persisted MP3 in the voice-swaps bucket
-- (e.g. <user_id>/<swap_id>.mp3). result_url is kept for the current session's
-- immediate playback; result_path is what survives beyond the 1-hour Replicate TTL.
alter table public.voice_swaps
  add column if not exists result_path text;

-- ── voice_swaps.replicate_prediction_id ───────────────────────────────────────
-- Used for idempotency: the persist endpoint can be called at most once per
-- prediction without creating duplicate rows. The unique index allows
-- INSERT … ON CONFLICT DO NOTHING so retries are safe.
alter table public.voice_swaps
  add column if not exists replicate_prediction_id text;

create unique index if not exists voice_swaps_prediction_id_uidx
  on public.voice_swaps(replicate_prediction_id)
  where replicate_prediction_id is not null;

-- ── 90-day retention (pg_cron) ────────────────────────────────────────────────
-- Runs daily at 03:00 UTC.
-- Step 1: delete storage objects — in Supabase, rows in storage.objects are the
--   authoritative metadata; deleting them marks the physical file for GC.
-- Step 2: null out result_path on the DB rows so they can't produce broken links.
-- pg_cron jobs run as a superuser so they can reach the storage schema.
-- The schedule call is idempotent (cron.schedule replaces any job with the same name).
select cron.schedule(
  'cleanup-expired-swap-results',
  '0 3 * * *',
  $$
  delete from storage.objects
  where bucket_id = 'voice-swaps'
    and created_at < now() - interval '90 days';

  update public.voice_swaps
  set result_path = null
  where result_path is not null
    and created_at < now() - interval '90 days';
  $$
);
