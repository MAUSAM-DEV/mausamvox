// Server-side charging for voice swaps (2026-10-24, engine rollout step 1) — the
// ledger in public.swap_charges (migration 20261024000000). Every swap of a
// non-admin account is charged HERE before any machine starts:
//   chargeSwap   → balance check + charge + ledger row (can't afford it → nothing changes);
//                  with `guard` also the per-account guards (step 2, 2026-10-25): one swap
//                  at a time, at most HD_SWAPS_PER_DAY HD Voice swaps in 24 h
//   attachSwapJob→ remember the Replicate prediction it started
//   settleSwap   → the voice is being handed over: never refundable again
//   refundSwap   → the job failed / was cancelled before delivery: credits back, at most once
//   swapPaid     → may this prediction be saved as a full swap?
// All calls are best-effort reads of the RPC result: a database error comes back as
// { error } / 'error' / null, and callers fail closed (no free swaps).
// Vercel logs: search "[charge]".
import { supabaseAdmin } from '@/lib/supabase/admin'
import { FREE_PREVIEWS_PER_TRACK, HD_SWAPS_PER_DAY, SWAP_LOCK_MINUTES } from '@/lib/swap-prices'

export type ChargeKind = 'preview' | 'full' | 'duet' | 'save'
export type ChargeResult =
  | { ok: true; chargeId: string; charged: number; discount: number; creditsRemaining: number }
  | { ok: false; insufficient: true; creditsRemaining: number }
  | { ok: false; insufficient?: false; blocked: 'running'; runningSince: string }
  | { ok: false; insufficient?: false; blocked: 'hd_cap'; hdUsed: number; hdFreeAt: string }
  | { ok: false; insufficient?: false; blocked?: undefined; error: string; previewNotFound?: boolean }

// `guard` (every swap that starts a job): the per-account guards too. `engine` = the
// engine this swap is set to run on (counts toward the HD cap); `pairId` = shared by the
// two voices of one duet (they may run together and count once).
export async function chargeSwap(o: {
  userId: string; kind: ChargeKind; price: number; trackKey?: string; previewId?: string
  guard?: { engine: 'hd' | 'standard'; pairId?: string }
}): Promise<ChargeResult> {
  const common = {
    p_user: o.userId, p_kind: o.kind, p_price: o.price, p_track: o.trackKey ?? '',
    p_preview: o.previewId ?? '', p_free_previews: FREE_PREVIEWS_PER_TRACK,
  }
  const { data, error } = o.guard
    ? await supabaseAdmin.rpc('charge_swap_checked', {
        ...common, p_engine: o.guard.engine, p_pair: o.guard.pairId ?? '',
        p_lock_minutes: SWAP_LOCK_MINUTES, p_hd_per_day: HD_SWAPS_PER_DAY,
      })
    : await supabaseAdmin.rpc('charge_swap', common)
  if (error) {
    console.error(`[charge] ${o.kind} charge failed: ${error.message}`)
    return { ok: false, error: error.message, previewNotFound: error.message.includes('PREVIEW_NOT_FOUND') }
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { ok: false, error: 'no answer from charge_swap' }
  if (row.blocked === 'running') {
    console.log(`[charge] ${o.kind}: refused — another swap is running since ${row.running_since}`)
    return { ok: false, blocked: 'running', runningSince: row.running_since }
  }
  if (row.blocked === 'hd_cap') {
    console.log(`[charge] ${o.kind}: refused — HD cap (${row.hd_used} HD swaps in 24 h, next free at ${row.hd_free_at})`)
    return { ok: false, blocked: 'hd_cap', hdUsed: row.hd_used, hdFreeAt: row.hd_free_at }
  }
  if (row.insufficient) {
    console.log(`[charge] ${o.kind}: not enough credits (${row.credits_remaining} left, price ${o.price})`)
    return { ok: false, insufficient: true, creditsRemaining: row.credits_remaining }
  }
  console.log(`[charge] ${o.kind} charged ${row.charged} cr${row.discount ? ` (preview counted: −${row.discount})` : ''} → ${row.credits_remaining} left (charge ${row.charge_id})`)
  return { ok: true, chargeId: row.charge_id, charged: row.charged, discount: row.discount, creditsRemaining: row.credits_remaining }
}

export async function attachSwapJob(userId: string, chargeId: string, jobId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc('attach_swap_job', { p_user: userId, p_charge: chargeId, p_job: jobId })
  if (error || data !== true) {
    console.error(`[charge] attach job ${jobId} to charge ${chargeId} failed: ${error?.message ?? 'charge not running'}`)
    return false
  }
  return true
}

// New balance when something was refunded, null when nothing was (already delivered /
// refunded, no charge, or a database error — logged).
export async function refundSwap(userId: string, by: { chargeId?: string; jobId?: string }, why: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin.rpc('refund_swap', { p_user: userId, p_charge: by.chargeId ?? null, p_job: by.chargeId ? null : by.jobId ?? null })
  if (error) {
    console.error(`[charge] REFUND FAILED (${why}) ${by.chargeId ?? by.jobId}: ${error.message}`)
    return null
  }
  if (typeof data === 'number') console.log(`[charge] refunded (${why}) ${by.chargeId ?? by.jobId} → ${data} left`)
  return typeof data === 'number' ? data : null
}

export async function settleSwap(userId: string, by: { chargeId?: string; jobId?: string }, deliveredId: string): Promise<'delivered' | 'refunded' | 'none' | 'error'> {
  const { data, error } = await supabaseAdmin.rpc('settle_swap', { p_user: userId, p_charge: by.chargeId ?? null, p_job: by.chargeId ? null : by.jobId ?? null, p_delivered: deliveredId })
  if (error) {
    console.error(`[charge] settle ${by.chargeId ?? by.jobId} failed: ${error.message}`)
    return 'error'
  }
  return data === 'delivered' || data === 'refunded' ? data : 'none'
}

// HD Voice fell back to Standard: the HD charge is refunded and the Standard price taken
// instead, as one new charge (so the swap costs FULL_SWAP_CREDITS, at most once). Returns the
// new charge id to carry on with, or null when it couldn't (the voice is then delivered
// uncharged — logged; a refund that failed leaves the HD charge in place, also logged).
export async function downgradeToStandard(userId: string, chargeId: string, price: number, previewId?: string): Promise<string | null> {
  const back = await refundSwap(userId, { chargeId }, 'HD fell back to Standard')
  if (back === null) return chargeId  // nothing refunded (already settled/refunded, or an error) → keep the old charge
  const again = await chargeSwap({ userId, kind: 'full', price, previewId })
  if (!again.ok) {
    console.error(`[charge] HD fell back to Standard: re-charge at ${price} cr failed — delivered without charge`)
    return null
  }
  return again.chargeId
}

// Mark a charge's engine (a preview that fell back from HD saves at the Standard price).
export async function setChargeEngine(chargeId: string, engine: 'hd' | 'standard'): Promise<void> {
  const { error } = await supabaseAdmin.from('swap_charges').update({ engine }).eq('id', chargeId)
  if (error) console.error(`[charge] engine update for ${chargeId} failed: ${error.message}`)
}

// The engine a charge was taken for ('hd' / 'standard' / '' — older rows), null if not found.
export async function chargeEngineFor(userId: string, deliveredId: string, kind: ChargeKind): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('swap_charges').select('engine').eq('user_id', userId).eq('kind', kind).eq('delivered_id', deliveredId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) { console.error(`[charge] engine lookup for ${deliveredId} failed: ${error.message}`); return null }
  return data ? String(data.engine ?? '') : null
}

// true / false, or null when it couldn't be checked.
export async function swapPaid(userId: string, predictionId: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin.rpc('swap_paid', { p_user: userId, p_prediction: predictionId })
  if (error) {
    console.error(`[charge] paid check for ${predictionId} failed: ${error.message}`)
    return null
  }
  return data === true
}
