-- Voice Library — opt-in publishing of trained voices to a public, free
-- community library (share_token's opt-in pattern applied to voice_clones).
--
-- published is false until the owner explicitly publishes (private by
-- default). Publishing REQUIRES a consent checkbox in the UI ("I own this
-- voice or have the rights, and I consent to others using it in the
-- Library") — library_consent_at records when that consent was given and is
-- deliberately KEPT on unpublish (it is the audit record of the consent
-- event, not the current visibility state; `published` alone controls
-- visibility). Re-publishing refreshes both timestamps.
--
-- library_bio is an optional short description the owner writes at publish
-- time, shown on the /library card.
--
-- Public access path (no auth): GET /api/library lists published voices and
-- GET /api/library/preview?id= 307-redirects to a FRESH signed URL for the
-- voice sample on every read (sign-on-read — never a stored signed URL).
-- Both run on the service-role client. Using a published voice in a swap
-- stays behind login: /api/voice-convert accepts a clone when it is the
-- caller's own OR published=true.
--
-- NO NEW GRANTS NEEDED (per the clarified per-operation gotcha: new COLUMNS
-- ride on existing table-level grants; voice_clones is not voice_swaps and
-- already has its grants exercised in prod):
--   * publish/unpublish = service_role UPDATE on voice_clones → already
--     exercised by /api/voice-lab/train (status/model_path updates)
--   * library list / preview / convert lookup = service_role SELECT →
--     already exercised by /api/voice-lab/sample-url and /api/voice-convert
--   * owner list (Voice Lab panel) = authenticated SELECT under the existing
--     "voice_clones: all own" RLS policy → unchanged
--   * NO anon grant: unauthenticated browsing never touches PostgREST — it
--     goes through the service-role API routes above.
--
-- NOTE: like the other migrations in this repo, apply manually in the
-- Supabase SQL editor. All statements are idempotent — re-running is safe.

alter table public.voice_clones
  add column if not exists published boolean not null default false,
  add column if not exists published_at timestamptz,
  add column if not exists library_consent_at timestamptz,
  add column if not exists library_bio text;

-- The public library list filters on published — keep it an index hit.
create index if not exists voice_clones_published_idx
  on public.voice_clones (published_at desc)
  where published;
