-- Atomic credit deduction for POST /api/credits/deduct.
--
-- The route previously did a read-then-write (SELECT credits_remaining, then
-- UPDATE with the computed difference). Two concurrent requests could both read
-- the same starting balance and each write back their own result, over- or
-- under-spending credits. This function replaces that with a single
-- conditional UPDATE: the balance check and the decrement happen in one
-- statement, so Postgres row locking serializes concurrent callers and the
-- balance can never go negative or lose a deduction.
--
-- Outcomes:
--   * success               → returns the new balance (integer)
--   * balance < p_amount    → raises 'INSUFFICIENT_CREDITS', row unchanged
--   * no such user          → raises 'USER_NOT_FOUND'
--   * p_amount null or <= 0 → raises 'INVALID_AMOUNT'
--
-- The route maps these exception messages to HTTP 402 / 404 / 400.
--
-- Runs as SECURITY INVOKER (the default): the caller is service_role, which
-- already holds select/update on public.users (migration 20260620000000).
-- EXECUTE is granted to service_role only — functions are executable by
-- PUBLIC by default, so that default is revoked below.
--
-- NOTE: like the other grant migrations in this repo, apply manually in the
-- Supabase SQL editor. This file captures it in version control.

create or replace function public.deduct_credits(p_user_id uuid, p_amount integer)
returns integer
language plpgsql
as $$
declare
  v_new_balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  -- Single atomic statement: only decrements when the balance covers the
  -- amount. A concurrent deduction on the same row waits on the row lock and
  -- then re-evaluates the WHERE clause against the updated balance.
  update public.users
     set credits_remaining = credits_remaining - p_amount
   where id = p_user_id
     and credits_remaining >= p_amount
  returning credits_remaining into v_new_balance;

  if not found then
    if exists (select 1 from public.users where id = p_user_id) then
      raise exception 'INSUFFICIENT_CREDITS';
    else
      raise exception 'USER_NOT_FOUND';
    end if;
  end if;

  return v_new_balance;
end;
$$;

revoke execute on function public.deduct_credits(uuid, integer) from public;
revoke execute on function public.deduct_credits(uuid, integer) from anon;
revoke execute on function public.deduct_credits(uuid, integer) from authenticated;
grant execute on function public.deduct_credits(uuid, integer) to service_role;
