-- Pre-launch waitlist — email capture while sign-ups are closed.
--
-- Powers POST /api/waitlist, which runs on the service-role client
-- (supabaseAdmin) exactly like the other write endpoints in this repo.
--
-- ⚠️  Apply MANUALLY in the Supabase SQL Editor (project rmycibkzhwgxnohwzrqf).
--     Every statement is idempotent — re-running is safe.
--
-- Design notes:
--   * email is stored lower-cased + trimmed by the API before insert, and
--     carries a UNIQUE constraint so a repeat sign-up is a no-op (the route
--     catches SQLSTATE 23505 and still shows "You're on the list!").
--   * NO anon / authenticated grants. The waitlist is written ONLY through
--     the service-role API route, never from the browser via PostgREST.
--     Granting anon INSERT here would let anyone spam the table directly.
--   * RLS is enabled with no policies: that blocks anon/authenticated
--     entirely while service_role (BYPASSRLS) still writes normally.
--     Belt-and-braces on top of withholding the grants.
--   * source/user_agent are captured for basic launch-day attribution.

create table if not exists public.waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text        not null unique,
  source     text,
  user_agent text,
  created_at timestamptz not null default now()
);

-- Launch-day export is "newest first" — keep it an index hit.
create index if not exists waitlist_created_at_idx
  on public.waitlist (created_at desc);

-- ── RLS: on, with zero policies (deny-all for anon + authenticated) ──
alter table public.waitlist enable row level security;

-- ── GRANTS ───────────────────────────────────────────────────────────
-- Per the voice_swaps lesson: service_role has BYPASSRLS but is NOT a
-- superuser — it still needs explicit table-level grants for every
-- operation the app performs.
--
--   INSERT → POST /api/waitlist (adding an email)
--   SELECT → the duplicate-email pre-check in the same route, and manual
--            export of the list at launch
grant insert, select on public.waitlist to service_role;

-- Deliberately NOT granted:
--   grant ... to anon;           -- no direct browser writes
--   grant ... to authenticated;  -- signed-in users have accounts already
