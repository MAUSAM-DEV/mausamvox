-- Store the actual final length of a saved track (Song Studio "Auto + slider"
-- length control). Measured server-side by decoding the final audio with the
-- bundled ffmpeg — AFTER any MiniMax target trim — so it is the real length
-- the user plays, not the requested one.
--
-- Nullable: older rows, voice swaps, and any save where measuring failed have
-- no value (callers treat null as "unknown"; length is never a reason to fail
-- a paid generation).
--
-- NO NEW GRANTS NEEDED: a new COLUMN rides the existing table-level grants
-- (same reasoning as 20260713000000). The only writer is the existing
-- service_role INSERT in /api/song-studio (already granted and exercised);
-- reads go through the existing authenticated/service_role SELECT grants.
--
-- Deploy-order safe: /api/song-studio retries the insert without
-- duration_seconds if this column doesn't exist yet (logs a warning), so
-- saving keeps working before this is applied — lengths just aren't stored.
--
-- ⚠️  Apply MANUALLY in the Supabase SQL Editor (project rmycibkzhwgxnohwzrqf).
--     Idempotent — re-running is safe.

alter table public.voice_swaps
  add column if not exists duration_seconds numeric(7, 2);
