-- Grant the `authenticated` role table-level access on public.users and
-- public.voice_swaps.
--
-- Both tables were created by raw SQL with RLS enabled and owner-only
-- policies (select/update own row), but no GRANT to `authenticated` was ever
-- issued. RLS row policies are evaluated AFTER table-level privileges, so a
-- missing GRANT means PostgREST rejects the request outright with HTTP 403
-- ("permission denied for table ...") before RLS even runs — it never returns
-- an empty/filtered result, it hard-fails.
--
-- Symptoms this fixes:
--   * users        — the browser credits fetch (dashboard + voice-lab/voice-swap
--                    sidebars) 403'd, so the UI showed "…".
--   * voice_swaps  — the dashboard "Voice Swaps" count query 403'd, so it showed "—".
--
-- RLS is unchanged: the existing "select/update own" policies still restrict
-- each user to their own rows. These grants only let the `authenticated` role
-- reach the table so RLS can do its job.
--
-- GRANT is idempotent — re-running this migration is safe and does not error.
--
-- NOTE: the users grant was already applied live (in the Supabase SQL editor);
-- this file captures it in version control. The voice_swaps grant is applied
-- separately in the SQL editor — CLI apply is intentionally not used here.

grant select, update on public.users to authenticated;
grant select on public.voice_swaps to authenticated;
