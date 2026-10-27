-- ── Consent records (private beta / Paddle review, founder 2026-10-27) ──
--
-- users.upload_rights_accepted_at — when the account ticked "I own this audio or have the
--   rights to use it" (asked once, before its first song upload). The split routes refuse a
--   non-admin upload while this is empty.
-- voice_clones.own_voice_consent_at — when the user ticked "This is my own voice" for that
--   voice. /api/voice-lab/create-clone refuses to save a voice without it.
--
-- Both tables are written with the service role (no new RLS policy needed); added columns
-- inherit the tables' existing grants. Existing rows stay empty: older voices were made by
-- the founder before the checkbox existed.

alter table public.users        add column if not exists upload_rights_accepted_at timestamptz;
alter table public.voice_clones add column if not exists own_voice_consent_at      timestamptz;

-- Check (should list both columns):
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public'
--      and column_name in ('upload_rights_accepted_at', 'own_voice_consent_at');
