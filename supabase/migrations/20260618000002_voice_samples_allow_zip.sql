-- Phase A fix — unblock dataset preparation.
--
-- /api/prepare-dataset uploads the training dataset ZIP into the voice-samples
-- bucket with content-type application/zip. The bucket was created (in
-- 20260617000000_storage_buckets.sql, then refined in the dashboard) with an
-- audio-only allowed_mime_types whitelist, so Storage rejected every zip upload
-- with HTTP 415 "mime type application/zip is not supported". Because the ~34 MB
-- body streamed for ~2 min before the rejection, the route surfaced it as a
-- generic "fetch failed".
--
-- Fix: allow application/zip alongside the audio types. (Idempotent.)
--
-- NOTE: file_size_limit stays at 50 MB because a bucket limit cannot exceed the
-- project-wide global upload limit (50 MB on the current plan). Longer Studio
-- datasets that exceed 50 MB require raising the GLOBAL limit in
-- Dashboard → Storage → Settings (may need a paid plan) — it cannot be done
-- from a bucket update or this migration.

update storage.buckets
set allowed_mime_types = (
  select array(
    select distinct e
    from unnest(allowed_mime_types || array['application/zip']) as e
  )
)
where id = 'voice-samples';
