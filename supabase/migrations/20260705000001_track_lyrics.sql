-- Auto-transcribed, user-editable timed lyrics for Performance Mode
-- (PROJECT_STATUS §3 — lyrics v1, approved 2026-07-05).
--
-- One row per (user, vocal-stem) pair. source_key is the DURABLE vocal-stem
-- storage path in audio-uploads (stems/<predictionId>-vocals.mp3): it's shared
-- by every swap / fine-tune apply / regenerate born from one stem-split, so a
-- single transcription serves all of them, and it exists for Stem Studio
-- tracks that have no voice_swaps row at all. Keying on a content hash of the
-- original upload (re-upload reuse) was considered and deferred.
--
-- lines jsonb: [{ "start": 12.34, "end": 15.6, "text": "..." }] — phrase-level
-- (Whisper "chunk") timestamps; Performance Mode highlights whole lines.
--
-- Grants (the recurring gotcha — every operation needs its own explicit
-- grant): this table follows the voice_swaps pattern — NO RLS, all access via
-- the service_role admin client with ownership enforced in app code
-- (.eq('user_id', ...)). Operations used by /api/lyrics: SELECT (fetch +
-- idempotency check), INSERT (store transcription), UPDATE (user edits).
-- No authenticated grants: the browser never queries this table directly.
-- DELETE is intentionally not granted yet — no cleanup flow exists; add the
-- grant WITH the flow when it ships.

create table if not exists public.track_lyrics (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  source_key  text not null,
  language    text,
  engine      text,
  lines       jsonb not null default '[]'::jsonb,
  edited      boolean not null default false,
  created_at  timestamptz not null default now()
);

create unique index if not exists track_lyrics_user_source_uidx
  on public.track_lyrics(user_id, source_key);

grant select on public.track_lyrics to service_role;
grant insert on public.track_lyrics to service_role;
grant update on public.track_lyrics to service_role;

-- ── voice_swaps.vocal_stem_path ────────────────────────────────────────────
-- The durable Demucs vocal-stem path the swap was built from, written at
-- persist time (the client already holds it as stemResult.vocalsPath). This is
-- how /swaps/[swapId] finds/creates the track's lyrics row — the swap row
-- previously had no pointer back to its stems. Column add on voice_swaps needs
-- NO new grant (table-level grants cover new columns; per-operation gotcha).
alter table public.voice_swaps
  add column if not exists vocal_stem_path text;
