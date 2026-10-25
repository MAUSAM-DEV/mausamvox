-- Per-user swap guards (2026-10-25, engine rollout step 2), on top of the ledger
-- public.swap_charges (migration 20261024000000):
--   1. ONE swap at a time per account: a new preview / full swap / duet is refused
--      while another one is still running (a 'charged' row younger than
--      p_lock_minutes). The two voices of ONE duet share a pair id and may run
--      together. A swap whose page was closed never settles; its lock simply runs
--      out after p_lock_minutes.
--   2. HD Voice: at most p_hd_per_day full swaps in the last 24 hours (refunded ones
--      don't count; the two voices of one duet count once).
-- Both are checked under the same row lock as the charge itself, so two tabs
-- pressing Process at the same moment can't both get through.
--
-- Apply in the Supabase SQL Editor BEFORE testing the deploy that uses it:
-- until it exists, swaps of non-admin accounts are refused (fail closed).

-- ── columns ───────────────────────────────────────────────────────────────────
alter table public.swap_charges add column if not exists engine text not null default '';  -- 'hd' | 'standard' | ''
alter table public.swap_charges add column if not exists pair_id text;                     -- the two voices of one duet

create index if not exists swap_charges_user_created on public.swap_charges (user_id, created_at desc);

-- ── charge_swap_checked: the guards, then charge_swap ─────────────────────────
-- blocked = null    → went through to charge_swap (charged, or insufficient as before)
--         'running' → another swap is running since running_since; nothing changed
--         'hd_cap'  → hd_used HD swaps in the last 24 h; one frees up at hd_free_at
create or replace function public.charge_swap_checked(
  p_user          uuid,
  p_kind          text,
  p_price         integer,
  p_track         text,
  p_preview       text,
  p_free_previews integer,
  p_engine        text,
  p_pair          text,
  p_lock_minutes  integer,
  p_hd_per_day    integer
)
returns table (
  charge_id         uuid,
  charged           integer,
  discount          integer,
  credits_remaining integer,
  insufficient      boolean,
  blocked           text,
  running_since     timestamptz,
  hd_used           integer,
  hd_free_at        timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_running timestamptz;
  v_hd      integer;
  v_oldest  timestamptz;
  r         record;
begin
  if p_kind not in ('preview', 'full', 'duet') or p_lock_minutes is null or p_lock_minutes <= 0 or p_hd_per_day is null then
    raise exception 'INVALID_CHARGE';
  end if;

  -- Serialize with every other charge of this user (charge_swap takes the same lock).
  select u.credits_remaining into v_credits from public.users u where u.id = p_user for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  select min(c.created_at) into v_running
    from public.swap_charges c
    where c.user_id = p_user and c.status = 'charged' and c.kind in ('preview', 'full', 'duet')
      and c.created_at > now() - make_interval(mins => p_lock_minutes)
      and not (p_kind = 'duet' and coalesce(p_pair, '') <> '' and c.kind = 'duet' and c.pair_id = p_pair);
  if v_running is not null then
    charge_id := null; charged := 0; discount := 0; credits_remaining := v_credits; insufficient := false;
    blocked := 'running'; running_since := v_running; hd_used := null; hd_free_at := null;
    return next; return;
  end if;

  if p_engine = 'hd' and p_kind in ('full', 'duet') then
    select count(distinct coalesce(c.pair_id, c.id::text))::integer, min(c.created_at) into v_hd, v_oldest
      from public.swap_charges c
      where c.user_id = p_user and c.engine = 'hd' and c.kind in ('full', 'duet') and c.status <> 'refunded'
        and c.created_at > now() - interval '24 hours'
        and not (coalesce(p_pair, '') <> '' and c.pair_id = p_pair);
    if v_hd >= p_hd_per_day then
      charge_id := null; charged := 0; discount := 0; credits_remaining := v_credits; insufficient := false;
      blocked := 'hd_cap'; running_since := null; hd_used := v_hd; hd_free_at := v_oldest + interval '24 hours';
      return next; return;
    end if;
  end if;

  select * into r from public.charge_swap(p_user, p_kind, p_price, p_track, p_preview, p_free_previews);
  if r.charge_id is not null and not r.insufficient then
    update public.swap_charges
      set engine = coalesce(p_engine, ''), pair_id = nullif(p_pair, '')
      where id = r.charge_id;
  end if;

  charge_id := r.charge_id; charged := r.charged; discount := r.discount;
  credits_remaining := r.credits_remaining; insufficient := r.insufficient;
  blocked := null; running_since := null; hd_used := null; hd_free_at := null;
  return next;
end;
$$;

-- ── function grants ───────────────────────────────────────────────────────────
revoke execute on function public.charge_swap_checked(uuid, text, integer, text, text, integer, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.charge_swap_checked(uuid, text, integer, text, text, integer, text, text, integer, integer) to service_role;
