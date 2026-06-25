-- Grant SELECT on public.voice_swaps to service_role.
--
-- The swap-result proxy (/api/voice-swaps/[swapId]/[filename]) uses
-- supabaseAdmin (service_role) to look up result_path before signing a URL.
-- service_role already has INSERT (20260624000002) but was never granted SELECT,
-- so every proxy request silently failed: supabase-js returned
-- {data: null, error: {code:"42501"}} which the route treated as a missing row
-- and returned 404 — causing AudioPlayer to fire onerror on every playback
-- attempt regardless of whether the file exists in storage.
--
-- The idempotency check in /api/voice-swaps/persist also SELECTs by
-- replicate_prediction_id via service_role — that query was silently failing
-- too (unique-constraint fallback masked it).
--
-- GRANT is idempotent — re-running is safe.
--
-- ⚠️  Apply manually in Supabase SQL Editor (project rmycibkzhwgxnohwzrqf).

grant select on public.voice_swaps to service_role;
