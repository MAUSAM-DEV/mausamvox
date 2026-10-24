-- Server-side charging for voice swaps (2026-10-24, engine rollout step 1).
--
-- Until now a full swap was charged by the BROWSER after the voice came back
-- (POST /api/credits/deduct) and the server never checked the balance — anyone
-- calling /api/voice-convert directly got free swaps. From now on the server
-- charges every swap (preview, full, each voice of a duet, saving a preview)
-- BEFORE any machine starts, and refunds it only when the job fails or is
-- cancelled before it delivered. This table is the ledger that makes the refund
-- happen at most once and lets the save route check a swap was paid for.
--
-- Rows: one per charge (amount 0 for free previews — they still get a row so a
-- failed free preview gives its free use back).
--   status  charged   → job running (refundable)
--           delivered → the voice was handed to the user (never refunded)
--           refunded  → the job failed / was cancelled; credits given back
--
-- Access: server only (service_role). RLS on with no policies, so the browser
-- (anon / authenticated) can't read or write it. Like every table here,
-- service_role still needs explicit table grants (the 2026-06-20 lesson).
--
-- Apply in the Supabase SQL Editor BEFORE testing the deploy that uses it:
-- until it exists, swaps of non-admin accounts are refused (fail closed).

-- ── table ─────────────────────────────────────────────────────────────────────
create table if not exists public.swap_charges (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('preview', 'full', 'duet', 'save')),
  amount        integer not null default 0 check (amount >= 0),  -- credits actually taken
  track_key     text not null default '',                        -- upload storagePath (previews)
  job_id        text,          -- Replicate prediction id the charge started ('save': the preview's id)
  delivered_id  text,          -- prediction id of the voice that was delivered (save / discount key)
  status        text not null default 'charged' check (status in ('charged', 'delivered', 'refunded')),
  discount_from uuid references public.swap_charges(id),         -- the paid preview counted toward this charge
  discount_used boolean not null default false,                  -- preview rows: already counted toward a full swap
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);

create index if not exists swap_charges_user_job on public.swap_charges (user_id, job_id);
create index if not exists swap_charges_user_delivered on public.swap_charges (user_id, delivered_id);

alter table public.swap_charges enable row level security;

grant select, insert, update on public.swap_charges to service_role;

-- ── charge_swap: atomic balance check + charge + ledger row ───────────────────
-- p_kind 'preview': free while the track has fewer than p_free_previews previews
--   (no track key = always free), else p_price. Counts the preview.
-- 'full' / 'duet': p_price, minus what a paid preview of the same take cost
--   (p_preview = that preview's delivered prediction id; each preview counts once).
-- 'save': saving preview p_preview as the full swap — p_price minus that preview's
--   cost; already saved = nothing more to pay. Raises PREVIEW_NOT_FOUND if the
--   preview isn't this user's delivered preview.
-- Can't afford it → insufficient = true and NOTHING changes.
create or replace function public.charge_swap(
  p_user          uuid,
  p_kind          text,
  p_price         integer,
  p_track         text,
  p_preview       text,
  p_free_previews integer
)
returns table (
  charge_id         uuid,
  charged           integer,
  discount          integer,
  credits_remaining integer,
  insufficient      boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
  v_count   integer;
  v_cost    integer;
  v_disc    integer := 0;
  v_from    uuid;
  v_id      uuid;
begin
  if p_kind not in ('preview', 'full', 'duet', 'save') or p_price is null or p_price < 0 then
    raise exception 'INVALID_CHARGE';
  end if;

  -- Serialize this user's charges.
  select u.credits_remaining into v_credits from public.users u where u.id = p_user for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  v_cost := p_price;
  if p_kind = 'preview' then
    if coalesce(p_track, '') = '' then
      v_cost := 0;
    else
      select pu.preview_count into v_count
        from public.preview_uses pu
        where pu.user_id = p_user and pu.track_key = p_track
        for update;
      if coalesce(v_count, 0) < p_free_previews then
        v_cost := 0;
      end if;
    end if;
  else
    if p_kind = 'save' then
      if not exists (
        select 1 from public.swap_charges c
        where c.user_id = p_user and c.kind = 'preview' and c.status = 'delivered' and c.delivered_id = p_preview
      ) then
        raise exception 'PREVIEW_NOT_FOUND';
      end if;
      -- Already saved (a repeat click / retry): nothing more to pay.
      select c.id into v_id
        from public.swap_charges c
        where c.user_id = p_user and c.kind = 'save' and c.job_id = p_preview and c.status = 'delivered'
        limit 1;
      if v_id is not null then
        charge_id := v_id; charged := 0; discount := 0; credits_remaining := v_credits; insufficient := false;
        return next; return;
      end if;
    end if;
    if coalesce(p_preview, '') <> '' then
      select c.id, least(c.amount, p_price) into v_from, v_disc
        from public.swap_charges c
        where c.user_id = p_user and c.kind = 'preview' and c.status = 'delivered'
          and c.delivered_id = p_preview and not c.discount_used
        order by c.created_at desc
        limit 1
        for update;
      v_disc := coalesce(v_disc, 0);
      v_cost := p_price - v_disc;
    end if;
  end if;

  if v_credits < v_cost then
    charge_id := null; charged := 0; discount := 0; credits_remaining := v_credits; insufficient := true;
    return next; return;
  end if;

  if v_cost > 0 then
    -- Alias the table so the bare column doesn't collide with the OUT param of
    -- the same name (credits_remaining) — Postgres 42702 otherwise.
    update public.users u
      set credits_remaining = u.credits_remaining - v_cost
      where u.id = p_user
      returning u.credits_remaining into v_credits;
  end if;

  if p_kind = 'preview' and coalesce(p_track, '') <> '' then
    insert into public.preview_uses (user_id, track_key, preview_count, updated_at)
      values (p_user, p_track, 1, now())
      on conflict (user_id, track_key)
      do update set preview_count = public.preview_uses.preview_count + 1, updated_at = now();
  end if;

  if v_from is not null then
    update public.swap_charges set discount_used = true where id = v_from;
  end if;

  insert into public.swap_charges (user_id, kind, amount, track_key, job_id, delivered_id, status, discount_from, settled_at)
    values (
      p_user, p_kind, v_cost, coalesce(p_track, ''),
      case when p_kind = 'save' then p_preview end,
      case when p_kind = 'save' then p_preview end,
      case when p_kind = 'save' then 'delivered' else 'charged' end,
      v_from,
      case when p_kind = 'save' then now() end
    )
    returning id into v_id;

  charge_id := v_id; charged := v_cost; discount := v_disc; credits_remaining := v_credits; insufficient := false;
  return next;
end;
$$;

-- ── attach_swap_job: remember which Replicate prediction a charge started ─────
create or replace function public.attach_swap_job(p_user uuid, p_charge uuid, p_job text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.swap_charges set job_id = p_job
    where id = p_charge and user_id = p_user and status = 'charged';
  return found;
end;
$$;

-- ── refund_swap: give a running charge back, at most once ────────────────────
-- By charge id, or (p_charge null) by the prediction it started. Only a
-- 'charged' row is refunded; a delivered or already-refunded one is left alone.
-- Also gives back the preview's free use / the preview discount it used.
-- Returns the new balance, or null when nothing was refunded.
create or replace function public.refund_swap(p_user uuid, p_charge uuid, p_job text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r         public.swap_charges%rowtype;
  v_credits integer;
begin
  select c.* into r
    from public.swap_charges c
    where c.user_id = p_user and c.status = 'charged'
      and ((p_charge is not null and c.id = p_charge) or (p_charge is null and p_job is not null and c.job_id = p_job))
    order by c.created_at desc
    limit 1
    for update;
  if not found then
    return null;
  end if;

  update public.swap_charges set status = 'refunded', settled_at = now() where id = r.id;

  if r.amount > 0 then
    update public.users u
      set credits_remaining = u.credits_remaining + r.amount
      where u.id = p_user
      returning u.credits_remaining into v_credits;
  else
    select u.credits_remaining into v_credits from public.users u where u.id = p_user;
  end if;

  if r.kind = 'preview' and r.track_key <> '' then
    update public.preview_uses
      set preview_count = greatest(preview_count - 1, 0), updated_at = now()
      where user_id = p_user and track_key = r.track_key;
  end if;

  if r.discount_from is not null then
    update public.swap_charges set discount_used = false where id = r.discount_from;
  end if;

  return v_credits;
end;
$$;

-- ── settle_swap: the voice is being handed over → never refundable again ──────
-- Returns 'delivered' (now or before), 'refunded' (cancelled — don't hand it
-- over), or 'none' (no charge: admin / not a charged job).
create or replace function public.settle_swap(p_user uuid, p_charge uuid, p_job text, p_delivered text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_status text;
begin
  select c.id, c.status into v_id, v_status
    from public.swap_charges c
    where c.user_id = p_user
      and ((p_charge is not null and c.id = p_charge) or (p_charge is null and p_job is not null and c.job_id = p_job))
    order by c.created_at desc
    limit 1
    for update;
  if not found then
    return 'none';
  end if;
  if v_status = 'charged' then
    update public.swap_charges
      set status = 'delivered', delivered_id = coalesce(p_delivered, job_id), settled_at = now()
      where id = v_id;
    return 'delivered';
  end if;
  return v_status;
end;
$$;

-- ── swap_paid: may this prediction be saved as a full swap? ───────────────────
create or replace function public.swap_paid(p_user uuid, p_prediction text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.swap_charges c
    where c.user_id = p_user and c.kind in ('full', 'duet', 'save') and c.status = 'delivered'
      and (c.delivered_id = p_prediction or c.job_id = p_prediction)
  );
$$;

-- ── function grants ───────────────────────────────────────────────────────────
-- These mutate credits_remaining: only the trusted server (service_role) may call them.
revoke execute on function public.charge_swap(uuid, text, integer, text, text, integer) from public, anon, authenticated;
revoke execute on function public.attach_swap_job(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.refund_swap(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.settle_swap(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.swap_paid(uuid, text) from public, anon, authenticated;
grant execute on function public.charge_swap(uuid, text, integer, text, text, integer) to service_role;
grant execute on function public.attach_swap_job(uuid, uuid, text) to service_role;
grant execute on function public.refund_swap(uuid, uuid, text) to service_role;
grant execute on function public.settle_swap(uuid, uuid, text, text) to service_role;
grant execute on function public.swap_paid(uuid, text) to service_role;
