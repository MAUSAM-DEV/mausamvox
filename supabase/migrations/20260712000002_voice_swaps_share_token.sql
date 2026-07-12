-- Shareable public track links: opt-in share token on voice_swaps.
--
-- share_token is NULL until the owner clicks Share (private by default).
-- The token is an app-generated random UUID — deliberately separate from the
-- row's primary id so public links cannot be derived or enumerated from swap
-- ids. Revoking a share sets it back to NULL; sharing again mints a NEW token,
-- so previously distributed links stay dead after a revoke.
--
-- Public access path (no auth): /s/<token> → /api/shared/<token>/audio, which
-- looks the row up BY TOKEN via the service-role client and re-signs
-- result_path on every read (the sign-on-read proxy pattern — no stored signed
-- URL, so links never expire while shared).
--
-- NO NEW GRANTS NEEDED (the voice_swaps per-operation gotcha, clarified
-- 2026-07-05: new COLUMNS ride on existing table-level grants):
--   * share toggle    = service_role UPDATE  → granted in 20260707000000
--   * public lookup   = service_role SELECT  → granted in 20260625000000
--   * owner page read = authenticated SELECT → granted previously (dashboard reads)
--
-- The partial unique index both enforces token uniqueness and makes the
-- public by-token lookup an index hit.
--
-- NOTE: like the other migrations in this repo, apply manually in the
-- Supabase SQL editor. All statements are idempotent — re-running is safe.

alter table public.voice_swaps
  add column if not exists share_token uuid;

create unique index if not exists voice_swaps_share_token_uidx
  on public.voice_swaps(share_token)
  where share_token is not null;
