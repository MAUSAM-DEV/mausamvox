-- Per-track preview allowance: the first 2 previews of a given track are free,
-- the 3rd+ costs 50 credits. State lives here so the charge can be gated
-- SERVER-SIDE (it must not be client-gameable).
--
-- A "track" is keyed by its upload storagePath (users/<id>/<ts>-<name>), which
-- the voice-swap flow already holds. Manual-extracted-stems tracks have no
-- storagePath and are always free (gated in the route, never reach this table).
--
-- IMPORTANT: like public.users, this table must grant `service_role` explicitly —
-- service_role bypasses RLS but still needs table-level privileges, and the
-- gating RPCs run SECURITY DEFINER but are invoked by service_role. Forgetting
-- the service_role grant is exactly the bug that bit us on 2026-06-20.

-- ── table ─────────────────────────────────────────────────────────────────────
create table if not exists public.preview_uses (
  user_id       uuid references auth.users(id) on delete cascade not null,
  track_key     text not null,                 -- the upload storagePath
  preview_count integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, track_key)
);

alter table public.preview_uses enable row level security;

-- Optional: let the browser read its own counts (e.g. to show "1 free preview
-- left"). Writes happen only via the SECURITY DEFINER RPCs below, never directly.
create policy "preview_uses: select own"
  on public.preview_uses for select
  using (auth.uid() = user_id);

grant select, insert, update on public.preview_uses to service_role;
grant select on public.preview_uses to authenticated;

-- ── consume_preview: atomic check + increment + (conditional) charge ──────────
-- Decides whether this preview is free (count < p_free_limit) or paid. If paid,
-- verifies the balance and deducts p_cost. Always increments the per-track count
-- (unless the user can't afford a paid preview, in which case nothing changes).
-- The whole thing runs under a row lock on the user, so concurrent previews for
-- the same user can't race past the free limit or double-spend.
create or replace function public.consume_preview(
  p_user       uuid,
  p_track      text,
  p_free_limit integer,
  p_cost       integer
)
returns table (
  was_free          boolean,
  charged           integer,
  new_count         integer,
  credits_remaining integer,
  insufficient      boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count   integer;
  v_credits integer;
begin
  -- Serialize this user's previews.
  select u.credits_remaining into v_credits from public.users u where u.id = p_user for update;
  if not found then
    raise exception 'user not found';
  end if;

  select pu.preview_count into v_count
    from public.preview_uses pu
    where pu.user_id = p_user and pu.track_key = p_track
    for update;
  if not found then
    v_count := 0;
  end if;

  if v_count < p_free_limit then
    -- Free preview.
    was_free := true;
    charged := 0;
  else
    -- Paid preview — must afford it.
    if v_credits < p_cost then
      was_free := false; charged := 0; insufficient := true;
      new_count := v_count; credits_remaining := v_credits;
      return next; return;
    end if;
    was_free := false;
    charged := p_cost;
    -- Alias the table so the bare column doesn't collide with the OUT param of
    -- the same name (credits_remaining) — Postgres 42702 otherwise.
    update public.users u
      set credits_remaining = u.credits_remaining - p_cost
      where u.id = p_user
      returning u.credits_remaining into v_credits;
  end if;

  insert into public.preview_uses (user_id, track_key, preview_count, updated_at)
    values (p_user, p_track, 1, now())
    on conflict (user_id, track_key)
    do update set preview_count = public.preview_uses.preview_count + 1, updated_at = now()
    returning preview_count into new_count;

  credits_remaining := v_credits;
  insufficient := false;
  return next;
end;
$$;

-- ── refund_preview: undo a consume whose job never started ────────────────────
-- Called only on Replicate create-failure: refunds the charge (if any) and rolls
-- back the count increment. (Late / poll-time failures are intentionally NOT
-- refunded — accepted limitation.)
create or replace function public.refund_preview(
  p_user   uuid,
  p_track  text,
  p_refund integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_refund > 0 then
    update public.users set credits_remaining = credits_remaining + p_refund where id = p_user;
  end if;
  update public.preview_uses
    set preview_count = greatest(preview_count - 1, 0), updated_at = now()
    where user_id = p_user and track_key = p_track;
end;
$$;

-- ── function grants ───────────────────────────────────────────────────────────
-- These RPCs mutate credits_remaining, so they must NOT be callable by anon /
-- authenticated directly — only the trusted server (service_role) may invoke them.
revoke execute on function public.consume_preview(uuid, text, integer, integer) from public;
revoke execute on function public.refund_preview(uuid, text, integer) from public;
grant execute on function public.consume_preview(uuid, text, integer, integer) to service_role;
grant execute on function public.refund_preview(uuid, text, integer) to service_role;
