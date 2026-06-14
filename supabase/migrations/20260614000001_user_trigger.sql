-- ── Auto-create a public.users row on every new auth sign-up ─────
--
-- Runs as SECURITY DEFINER so it can write to public.users even
-- though the calling context is the auth schema. search_path is
-- pinned to public to prevent search-path injection.

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
    500,
    500,
    now()
  )
  on conflict (id) do nothing;   -- idempotent: safe to re-run
  return new;
end;
$$;

-- Drop and recreate so this migration is re-runnable
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute procedure public.handle_new_user();
