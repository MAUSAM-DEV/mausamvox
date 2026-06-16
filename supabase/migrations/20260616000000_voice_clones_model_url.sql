-- Repairs schema drift: 20260614000000_init.sql intended to add model_url
-- and status to voice_clones, but used `create table if not exists`, which
-- no-ops because the table from 20260611000000_init.sql already existed.
-- Confirmed via the live PostgREST schema that these columns are missing.
alter table public.voice_clones
  add column if not exists model_url text,
  add column if not exists status text not null default 'pending';
