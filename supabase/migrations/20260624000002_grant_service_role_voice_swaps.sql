-- Grant INSERT on public.voice_swaps to the service_role.
--
-- The persist endpoint (/api/voice-swaps/persist) uses supabaseAdmin
-- (SUPABASE_SERVICE_ROLE_KEY) which connects as the service_role PostgreSQL
-- role. service_role has BYPASSRLS so it skips row-level security, but it
-- still needs explicit table-level GRANT privileges — it is not a superuser.
--
-- The previous migration (20260624000000) only granted INSERT to authenticated,
-- leaving service_role without INSERT → "permission denied for table voice_swaps"
-- from every call to the persist endpoint.
--
-- GRANT is idempotent — re-running is safe.
--
-- ⚠️  Apply manually in Supabase SQL Editor (project rmycibkzhwgxnohwzrqf).

grant insert on public.voice_swaps to service_role;
