-- Run once in Supabase SQL editor (Dashboard → SQL Editor → New Query)

create table if not exists voice_swaps (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  song_name     text not null,
  voice_used    text not null default '',
  quality_score integer,
  result_url    text,
  created_at    timestamptz default now() not null
);

alter table voice_swaps enable row level security;

-- Users can read and insert only their own rows
create policy "users select own swaps"
  on voice_swaps for select
  using (auth.uid() = user_id);

create policy "users insert own swaps"
  on voice_swaps for insert
  with check (auth.uid() = user_id);
