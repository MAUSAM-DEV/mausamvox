-- Allow browser-recording and alternate-WAV MIME types on audio-uploads.
--
-- ROOT CAUSE (reproduced against the live bucket, 2026-09-27): the bucket's
-- allowed_mime_types was exact-match ['audio/mpeg','audio/wav','audio/mp4',
-- 'audio/x-m4a']. Storage answered HTTP 400 {"statusCode":"415",
-- "error":"invalid_mime_type"} for:
--   * audio/webm;codecs=opus — what Chrome's MediaRecorder produces. Every
--     Choir Composer and Instruments MIC RECORDING died here, BEFORE
--     /api/choir or /api/instruments ran (hence nothing in their logs).
--   * audio/webm, audio/wave, audio/x-wav — alternate labels browsers use.
--
-- The client now strips codec parameters and folds aliases onto canonical
-- types (src/lib/audio-upload.ts → canonicalAudioMime), so after this
-- migration it only ever sends: audio/mpeg, audio/wav, audio/mp4,
-- audio/webm, audio/ogg. The aliases below are belt-and-braces for any
-- older client still cached in a browser.
--
--   audio/webm  — Chrome / Edge MediaRecorder
--   audio/ogg   — Firefox MediaRecorder
--   audio/x-wav, audio/wave, audio/vnd.wave — alternate WAV labels
--
-- Size limit is NOT changed here — see the note at the bottom.
--
-- ⚠️  Apply MANUALLY in the Supabase SQL Editor (project rmycibkzhwgxnohwzrqf).
--     Idempotent — re-running is safe (de-duplicated union).

update storage.buckets
set allowed_mime_types = (
  select array(
    select distinct e
    from unnest(
      coalesce(allowed_mime_types, array[]::text[]) ||
      array['audio/webm', 'audio/ogg', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave']
    ) as e
  )
)
where id = 'audio-uploads';

-- ── SIZE LIMIT (not applied by this migration) ──────────────────────────
-- audio-uploads.file_size_limit is 52428800 (50 MiB) and a bucket limit
-- cannot exceed the project-wide GLOBAL upload limit (50 MB on the current
-- plan — see 20260618000002). To allow 100 MB uploads:
--   1. Dashboard → Storage → Settings → "Upload file size limit" → 100 MB
--      (may require a paid plan).
--   2. THEN run:
--        update storage.buckets set file_size_limit = 104857600
--        where id = 'audio-uploads';
-- The app reads this limit live via /api/upload-stem/presign, so no code
-- change is needed. Until then, WAVs over 50 MiB are compressed to 320 kbps
-- MP3 in the browser before upload.
