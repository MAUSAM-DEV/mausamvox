-- Song Studio jobs — the user's title (and style label + MiniMax target)
-- stored WITH the Replicate job, server-side, at creation time.
--
-- ROOT CAUSE this fixes (2026-10-02): for the Replicate engines (minimax /
-- acestep) the song is saved by whichever GET poll first sees the job
-- succeed, and the title used to come ONLY from that poll's query string.
-- Any save not driven by the original tab lost it — e.g. the recovery link
-- saved the founder's Duet song as "Song Studio track". Now POST records the
-- job here; GET reads title/style/target from this row (query params are
-- only a fallback) and refuses to save a job that belongs to another user.
--
-- Not money: credits, refunds and their idempotency are untouched (they live
-- on voice_swaps.replicate_prediction_id as before).
--
-- GRANTS: written and read ONLY by /api/song-studio on the service-role
-- client — service_role needs explicit table grants (BYPASSRLS ≠ superuser).
-- No anon/authenticated grants; RLS on with no policies (deny-all for them).
--
-- Deploy-order safe: until this is applied, POST logs a warning and GET falls
-- back to the poll's query-string title (the pre-fix behaviour).
--
-- ⚠️  Apply MANUALLY in the Supabase SQL Editor (project rmycibkzhwgxnohwzrqf).
--     Idempotent — re-running is safe.

create table if not exists public.song_studio_jobs (
  prediction_id  text primary key,
  user_id        uuid not null,
  title          text not null,
  style          text,
  target_seconds integer,
  created_at     timestamptz not null default now()
);

create index if not exists song_studio_jobs_user_idx
  on public.song_studio_jobs (user_id, created_at desc);

alter table public.song_studio_jobs enable row level security;

--   INSERT → POST /api/song-studio (job created)
--   SELECT → GET  /api/song-studio (save the finished song with its title)
grant insert, select on public.song_studio_jobs to service_role;
