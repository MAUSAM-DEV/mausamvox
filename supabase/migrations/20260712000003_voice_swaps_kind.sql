-- Song Studio (AI full-song generation) rows live in voice_swaps.
--
-- Generated songs reuse the whole saved-track machinery — the voice-swaps
-- storage bucket, the sign-on-read proxy (/api/voice-swaps/<id>/result.mp3),
-- Recent/Saved Tracks lists, share tokens, delete, and 90-day retention —
-- so they get playback + sharing for free instead of a parallel table.
--
-- `kind` distinguishes them so the UI can label honestly:
--   NULL          — a voice swap (every pre-existing row)
--   'song_studio' — an AI-generated song (voice_used holds the style prompt)
--
-- Song Studio also inserts a kind='song_studio' row with result_path NULL as
-- an idempotent refund marker when a generation FAILS (the unique index on
-- replicate_prediction_id guarantees at most one refund per prediction).
-- Null-result_path rows are already excluded from every list/count query.
--
-- NO NEW GRANTS NEEDED: all Song Studio DB ops run as service_role, whose
-- table-level SELECT (20260625000000) / INSERT (20260624000002) /
-- UPDATE (20260707000000) grants cover the new column (per the clarified
-- voice_swaps gotcha: columns ride on table-level grants).
--
-- NOTE: apply manually in the Supabase SQL editor; idempotent — re-running
-- is safe.

alter table public.voice_swaps
  add column if not exists kind text;
