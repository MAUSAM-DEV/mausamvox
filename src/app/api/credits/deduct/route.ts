import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  // Session auth — deductions may only target the signed-in caller. The route
  // previously trusted a userId from the body, letting anyone deduct anyone's
  // credits; the admin client below bypasses RLS, so this check is the gate.
  const sessionClient = await createClient()
  const { data: { user: sessionUser } } = await sessionClient.auth.getUser()
  if (!sessionUser) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  let body: { userId?: string; amount?: number; action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { amount, action } = body

  // The client still sends userId; reject a mismatch rather than silently
  // charging a different account than the caller intended.
  if (body.userId && body.userId !== sessionUser.id) {
    return NextResponse.json({ error: 'Cannot deduct credits for another user' }, { status: 403 })
  }
  const userId = sessionUser.id

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json({ error: 'A positive whole-number amount is required' }, { status: 400 })
  }

  // The balance check and decrement happen atomically inside deduct_credits()
  // (migration 20260712000000) — a separate read-then-update here would let two
  // concurrent requests both pass the check against the same stale balance.
  const { data: newBalance, error: rpcError } = await supabaseAdmin.rpc('deduct_credits', {
    p_user_id: userId,
    p_amount: amount,
  })

  if (rpcError) {
    if (rpcError.message.includes('INSUFFICIENT_CREDITS')) {
      return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 })
    }
    if (rpcError.message.includes('USER_NOT_FOUND')) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'Failed to deduct credits' }, { status: 500 })
  }

  return NextResponse.json({ success: true, creditsRemaining: newBalance, action })
}
