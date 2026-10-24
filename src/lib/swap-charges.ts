// Server-side charging for voice swaps (2026-10-24, engine rollout step 1) — the
// ledger in public.swap_charges (migration 20261024000000). Every swap of a
// non-admin account is charged HERE before any machine starts:
//   chargeSwap   → balance check + charge + ledger row (can't afford it → nothing changes)
//   attachSwapJob→ remember the Replicate prediction it started
//   settleSwap   → the voice is being handed over: never refundable again
//   refundSwap   → the job failed / was cancelled before delivery: credits back, at most once
//   swapPaid     → may this prediction be saved as a full swap?
// All calls are best-effort reads of the RPC result: a database error comes back as
// { error } / 'error' / null, and callers fail closed (no free swaps).
// Vercel logs: search "[charge]".
import { supabaseAdmin } from '@/lib/supabase/admin'
import { FREE_PREVIEWS_PER_TRACK } from '@/lib/swap-prices'

export type ChargeKind = 'preview' | 'full' | 'duet' | 'save'
export type ChargeResult =
  | { ok: true; chargeId: string; charged: number; discount: number; creditsRemaining: number }
  | { ok: false; insufficient: true; creditsRemaining: number }
  | { ok: false; insufficient?: false; error: string; previewNotFound?: boolean }

export async function chargeSwap(o: { userId: string; kind: ChargeKind; price: number; trackKey?: string; previewId?: string }): Promise<ChargeResult> {
  const { data, error } = await supabaseAdmin.rpc('charge_swap', {
    p_user: o.userId, p_kind: o.kind, p_price: o.price, p_track: o.trackKey ?? '',
    p_preview: o.previewId ?? '', p_free_previews: FREE_PREVIEWS_PER_TRACK,
  })
  if (error) {
    console.error(`[charge] ${o.kind} charge failed: ${error.message}`)
    return { ok: false, error: error.message, previewNotFound: error.message.includes('PREVIEW_NOT_FOUND') }
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { ok: false, error: 'no answer from charge_swap' }
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

// true / false, or null when it couldn't be checked.
export async function swapPaid(userId: string, predictionId: string): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin.rpc('swap_paid', { p_user: userId, p_prediction: predictionId })
  if (error) {
    console.error(`[charge] paid check for ${predictionId} failed: ${error.message}`)
    return null
  }
  return data === true
}
