-- Grant INSERT on public.voice_swaps to the authenticated role.
--
-- voice_swaps was created with RLS enabled and an "insert own" policy, but only
-- SELECT was granted to authenticated (see 20260619000000_grant_authenticated_select.sql).
-- PostgREST evaluates table-level privileges before RLS, so without this grant
-- every insert returned HTTP 403 before RLS could run — silently blocking recordSwap
-- and leaving the Recent Swaps panel permanently empty.
--
-- The grant was applied live via the Supabase SQL editor on 2026-06-24.
-- This migration captures it for version control and fresh-database setups.
--
-- GRANT is idempotent — re-running is safe.

grant insert on public.voice_swaps to authenticated;
