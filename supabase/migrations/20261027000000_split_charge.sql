-- Song upload / split charged on the server (2026-10-27, step 7 blocker 1).
--
-- Until now the 50-credit split was taken by the page after it finished
-- (POST /api/credits/deduct) and /api/stem-split checked nothing — anyone could
-- upload songs without limit, each with free full-length previews. From now on the
-- split routes charge it BEFORE any machine starts, once per uploaded song (the
-- upload starts two splits in parallel — MVSEP studio split + Demucs — whichever
-- asks first pays, the other finds the charge), in the swap_charges ledger
-- (migration 20261024000000): kind 'split', track_key = the upload's storage path.
-- A failed Demucs job gives it back (refund_swap by job); a finished one settles it
-- (settle_swap by job). Free previews need a paid split of that song (split_paid).
--
-- Apply in the Supabase SQL Editor BEFORE testing the deploy that uses it:
-- until it exists, uploads of non-admin accounts are refused (fail closed).

-- ── allow kind 'split' ────────────────────────────────────────────────────────
alter table public.swap_charges drop constraint if exists swap_charges_kind_check;
alter table public.swap_charges add constraint swap_charges_kind_check
  check (kind in ('preview', 'full', 'duet', 'save', 'split'));

create index if not exists swap_charges_user_track on public.swap_charges (user_id, track_key);

-- ── charge_split: once per uploaded song ──────────────────────────────────────
-- Already charged (and not refunded) → charged = 0, same charge id. Can't afford it →
-- insufficient = true and nothing changes.
create or replace function public.charge_split(p_user uuid, p_track text, p_price integer)
returns table (
  charge_id         uuid,
  charged           integer,
  credits_remaining integer,
  insufficient      boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_id      uuid;
begin
  if coalesce(p_track, '') = '' or p_price is null or p_price < 0 then
    raise exception 'INVALID_CHARGE';
  end if;

  -- Serialize with every other charge of this user (the two parallel splits too).
  select u.credits_remaining into v_credits from public.users u where u.id = p_user for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  select c.id into v_id
    from public.swap_charges c
    where c.user_id = p_user and c.kind = 'split' and c.track_key = p_track and c.status <> 'refunded'
    order by c.created_at desc
    limit 1;
  if v_id is not null then
    charge_id := v_id; charged := 0; credits_remaining := v_credits; insufficient := false;
    return next; return;
  end if;

  if v_credits < p_price then
    charge_id := null; charged := 0; credits_remaining := v_credits; insufficient := true;
    return next; return;
  end if;

  if p_price > 0 then
    update public.users u
      set credits_remaining = u.credits_remaining - p_price
      where u.id = p_user
      returning u.credits_remaining into v_credits;
  end if;

  insert into public.swap_charges (user_id, kind, amount, track_key, status)
    values (p_user, 'split', p_price, p_track, 'charged')
    returning id into v_id;

  charge_id := v_id; charged := p_price; credits_remaining := v_credits; insufficient := false;
  return next;
end;
$$;

-- ── split_paid: does this song have a paid (not refunded) split? ──────────────
create or replace function public.split_paid(p_user uuid, p_track text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.swap_charges c
    where c.user_id = p_user and c.kind = 'split' and c.track_key = p_track and c.status <> 'refunded'
  );
$$;

-- ── function grants ───────────────────────────────────────────────────────────
revoke execute on function public.charge_split(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.split_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.charge_split(uuid, text, integer) to service_role;
grant execute on function public.split_paid(uuid, text) to service_role;
