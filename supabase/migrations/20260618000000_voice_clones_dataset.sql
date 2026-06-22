-- Phase A: dataset preparation columns on voice_clones
--
-- dataset_zip_url: signed URL of the packaged training ZIP (set by
--   /api/prepare-dataset after splitting and zipping the voice sample).
--   NULL until dataset prep has run for this clone.
--
-- sample_url: signed URL of the raw voice sample for in-app playback.
--   Referenced by /api/voice-lab/upload-sample and /api/voice-lab/create-clone
--   but was never added via a migration — adding it here.
--
-- type vs clone_type: the initial schema (20260611000000) uses `type`; the
--   second init (20260614000000) was a no-op (table already existed) so the
--   live column is `type`. The `clone_type` alias in that second migration
--   never landed. All application code correctly uses `type`.

alter table public.voice_clones
  add column if not exists dataset_zip_url text,
  add column if not exists sample_url      text;
