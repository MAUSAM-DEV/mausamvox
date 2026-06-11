-- ─────────────────────────────────────────────────────────────────────────────
-- MausamVox — initial schema
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. public.users ──────────────────────────────────────────────────────────
-- Extends auth.users with profile + billing data.
-- Rows are auto-created by the handle_new_user trigger on auth signup.

create table if not exists public.users (
  id                uuid        primary key references auth.users(id) on delete cascade,
  email             text        not null,
  full_name         text,
  plan              text        not null default 'free'
                                check (plan in ('free', 'starter', 'pro', 'studio')),
  credits_remaining integer     not null default 500,
  credits_total     integer     not null default 500,
  created_at        timestamptz not null default now()
);

-- Row-level security: users can read and update only their own row.
-- Plan and credits should only be modified via server-side functions.
alter table public.users enable row level security;

create policy "users: select own"
  on public.users for select
  using (auth.uid() = id);

create policy "users: update own"
  on public.users for update
  using (auth.uid() = id);


-- ── 2. trigger: auto-create profile on auth signup ───────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ── 3. public.voice_clones ────────────────────────────────────────────────────

create table if not exists public.voice_clones (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references public.users(id) on delete cascade,
  name          text        not null,
  type          text        not null check (type in ('express', 'studio')),
  quality_score integer     check (quality_score between 0 and 100),
  language      text        not null default 'en',
  created_at    timestamptz not null default now()
);

alter table public.voice_clones enable row level security;

-- Users manage only their own voice clones
create policy "voice_clones: all own"
  on public.voice_clones for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ── 4. indexes ────────────────────────────────────────────────────────────────

create index if not exists voice_clones_user_id_idx
  on public.voice_clones (user_id);

create index if not exists voice_clones_created_at_idx
  on public.voice_clones (created_at desc);
