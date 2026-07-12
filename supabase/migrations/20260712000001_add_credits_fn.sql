-- Atomic credit increment — the companion to deduct_credits (20260712000000).
--
-- gender-split's refundCredits() previously did a read-then-update increment
-- (SELECT credits_remaining, then UPDATE with the computed sum). Under
-- concurrency that can lose an update: a refund racing a deduction (or another
-- refund) could both read the same starting balance and one write clobbers the
-- other. This function makes the increment a single UPDATE statement, so row
-- locking serializes concurrent writers and no credit change is ever lost.
--
-- Written generically (not "refund_credits") so future credit top-ups —
-- purchases, plan grants, promotions — can reuse it.
--
-- Outcomes:
--   * success               → returns the new balance (integer)
--   * no such user          → raises 'USER_NOT_FOUND'
--   * p_amount null or <= 0 → raises 'INVALID_AMOUNT'
--
-- Runs as SECURITY INVOKER (the default): the caller is service_role, which
-- already holds update on public.users (migration 20260620000000). EXECUTE is
-- granted to service_role only — functions are executable by PUBLIC by
-- default, so that default is revoked below.
--
-- NOTE: like the other grant migrations in this repo, apply manually in the
-- Supabase SQL editor. This file captures it in version control.

create or replace function public.add_credits(p_user_id uuid, p_amount integer)
returns integer
language plpgsql
as $$
declare
  v_new_balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  update public.users
     set credits_remaining = credits_remaining + p_amount
   where id = p_user_id
  returning credits_remaining into v_new_balance;

  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  return v_new_balance;
end;
$$;

revoke execute on function public.add_credits(uuid, integer) from public;
revoke execute on function public.add_credits(uuid, integer) from anon;
revoke execute on function public.add_credits(uuid, integer) from authenticated;
grant execute on function public.add_credits(uuid, integer) to service_role;
