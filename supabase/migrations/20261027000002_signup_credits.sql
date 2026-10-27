-- ── Free-credit protection: new accounts get 300 free credits (was 500) ──
--
-- Founder 2026-10-27 (option E): 300 free credits once per new account, uploads cost 100,
-- 1 free preview per song (the last two live in src/lib/swap-prices.ts). Existing accounts
-- keep their balance — this only changes what a NEW sign-up starts with.
--
-- Both places that set a new account's credits are changed, because two older migrations
-- define the sign-up trigger differently (one relies on the column defaults, one writes 500).

alter table public.users alter column credits_remaining set default 300;
alter table public.users alter column credits_total     set default 300;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (
    id,
    email,
    plan,
    credits_remaining,
    credits_total,
    created_at
  ) values (
    new.id,
    new.email,
    'free',
    300,
    300,
    now()
  )
  on conflict (id) do nothing;   -- idempotent: safe to re-run
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user();

-- Check (should show 300 and 300, and a function body containing "300"):
--   select column_name, column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'users'
--      and column_name in ('credits_remaining', 'credits_total');
