-- Grant UPDATE on public.voice_swaps to service_role.
--
-- The polish auto-re-persist (Option 2) lets the Result screen refresh a saved
-- swap's stored audio when the user adjusts Warmth/Bass/Treble/Reverb/Echo after
-- the first save. /api/voice-swaps/persist now UPDATEs voice_swaps.result_path /
-- instrumental_path (via the service_role admin client) to point at the freshly
-- re-uploaded mix — no re-conversion, no credits.
--
-- (recurring gotcha: every DB op on voice_swaps needs its own explicit grant —
-- no RLS on this table, access is admin client + app-code ownership checks.
-- INSERT/SELECT/DELETE were granted in 20260624*/20260625*/20260703*; UPDATE
-- was never used before this, so it needs its own grant or the re-save UPDATE
-- 403s with "permission denied for table voice_swaps".)

grant update on public.voice_swaps to service_role;
