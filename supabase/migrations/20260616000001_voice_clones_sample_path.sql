-- Tracks where the raw recording/upload lives in the voice-samples bucket,
-- so a future training job (or this row's own detail view) can find it.
-- Without this, a saved sample would be unreachable after the initial upload.
alter table public.voice_clones
  add column if not exists sample_path text;
