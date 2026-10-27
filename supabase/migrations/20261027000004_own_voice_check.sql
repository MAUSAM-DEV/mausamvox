-- ── Own-voice check result (founder 2026-10-27) ──
--
-- After saving a voice in Voice Lab the user says a random 5-digit phrase; the finishing machine
-- (hd-finish speaker_match task) scores how alike it is to the voice's training recording.
--   own_voice_score       cosine similarity, about 0–1 (≥ 0.5 matches, < 0.3 doesn't; see src/lib/own-voice.ts)
--   own_voice_checked_at  when the latest check finished
-- A soft gate: nothing is blocked by a low score; it is shown to the user and kept for review.
-- The check clip itself is deleted after scoring.
--
-- voice_clones is written with the service role; added columns inherit the table's grants.
-- Safe before or after the deploy: until this runs, the check still answers but stores nothing.

alter table public.voice_clones add column if not exists own_voice_score      real;
alter table public.voice_clones add column if not exists own_voice_checked_at timestamptz;

-- Review query (lowest scores first):
--   select name, user_id, own_voice_score, own_voice_checked_at from public.voice_clones
--    where own_voice_score is not null order by own_voice_score asc;
