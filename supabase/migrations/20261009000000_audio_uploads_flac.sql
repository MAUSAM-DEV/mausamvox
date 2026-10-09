-- Allow FLAC on audio-uploads: the studio-quality split (/api/hq-split, MVSEP)
-- stores its vocals + instrumental as 16-bit FLAC (lossless, about half the
-- size of WAV — files on this bucket are capped at 50 MB).
--
-- Until this runs, the app stores those FLAC files under the audio/mpeg label
-- (src/lib/stem-persist.ts falls back automatically; browsers decode by the
-- bytes, not the label), so nothing breaks — this just labels them correctly.
--
-- ⚠️  Apply MANUALLY in the Supabase SQL Editor (project rmycibkzhwgxnohwzrqf).
--     Idempotent — re-running is safe (de-duplicated union).

update storage.buckets
set allowed_mime_types = (
  select array(
    select distinct e
    from unnest(
      coalesce(allowed_mime_types, array[]::text[]) ||
      array['audio/flac', 'audio/x-flac']
    ) as e
  )
)
where id = 'audio-uploads';
