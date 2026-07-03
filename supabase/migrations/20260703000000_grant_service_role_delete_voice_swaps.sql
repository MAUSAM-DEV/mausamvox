-- Grant DELETE on public.voice_swaps to service_role.
--
-- The delete endpoint (/api/voice-swaps/delete) removes rows via the admin
-- client (service_role). service_role already has INSERT (20260624000002) and
-- SELECT (20260625000000), and a live probe on 2026-07-03 confirmed DELETE
-- already works in production — but no migration ever recorded it, so a fresh
-- environment built from this directory would 403 on delete.
--
-- This file captures the existing live privilege in version control
-- (recurring gotcha: every DB op on voice_swaps needs its own explicit grant —
-- the table has no RLS for service_role paths; ownership is enforced in app
-- code with an explicit user_id filter on every query).
--
-- Idempotent — safe to re-run against production.

grant delete on public.voice_swaps to service_role;
