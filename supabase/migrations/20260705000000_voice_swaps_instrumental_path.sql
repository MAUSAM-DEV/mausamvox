-- voice_swaps.instrumental_path — durable storage path (voice-swaps bucket) of
-- the MUSIC-ONLY mix (bass/drums/other, no vocals, no polish) built client-side
-- at save time alongside the full mix. Used by Performance Mode's "Music only"
-- backing on /swaps/[swapId]. Null for swaps saved before this shipped and
-- whenever the instrumental render/upload soft-fails (nothing else breaks).
--
-- Grants check (the recurring voice_swaps gotcha): NO new grant is needed here.
-- Every existing grant on this table is TABLE-level (select/insert/delete to
-- authenticated / service_role — see migrations 20260619*/20260624*/20260625*/
-- 20260703*), and table-level grants automatically cover newly added columns.
-- The gotcha bites on new DB *operations*; this migration adds a column, not
-- an operation.

alter table public.voice_swaps
  add column if not exists instrumental_path text;
