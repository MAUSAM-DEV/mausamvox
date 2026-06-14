-- ── users profile table ──────────────────────────────────────────
-- One row per auth.users entry, created automatically on sign-up.
create table if not exists public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  display_name  text,
  avatar_url    text,
  plan          text not null default 'free',   -- free | starter | pro | studio
  credits       integer not null default 500,
  onboarded     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "Users can read own row"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update own row"
  on public.users for update
  using (auth.uid() = id);

-- Auto-insert a profile row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── voice_clones table ───────────────────────────────────────────
create table if not exists public.voice_clones (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  name          text not null default 'My Voice',
  clone_type    text not null default 'express',   -- express | studio
  language      text not null default 'en',
  gender        text,                               -- male | female | neutral
  score         integer,                            -- 0-100 quality score
  model_url     text,                               -- storage path to trained model
  status        text not null default 'pending',    -- pending | training | ready | failed
  used_count    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.voice_clones enable row level security;

create policy "Users can read own clones"
  on public.voice_clones for select
  using (auth.uid() = user_id);

create policy "Users can insert own clones"
  on public.voice_clones for insert
  with check (auth.uid() = user_id);

create policy "Users can update own clones"
  on public.voice_clones for update
  using (auth.uid() = user_id);

create policy "Users can delete own clones"
  on public.voice_clones for delete
  using (auth.uid() = user_id);

-- Index for fast per-user lookups
create index if not exists voice_clones_user_id_idx on public.voice_clones(user_id);
