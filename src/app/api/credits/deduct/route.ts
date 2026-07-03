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

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'A positive amount is required' }, { status: 400 })
  }

  // Fetch current balance
  const { data: user, error: fetchError } = await supabaseAdmin
    .from('users')
    .select('credits_remaining')
    .eq('id', userId)
    .single()

  if (fetchError || !user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  if (user.credits_remaining < amount) {
    return NextResponse.json({ error: 'Insufficient credits' }, { status: 402 })
  }

  const { data, error: updateError } = await supabaseAdmin
    .from('users')
    .update({ credits_remaining: user.credits_remaining - amount })
    .eq('id', userId)
    .select('credits_remaining')
    .single()

  if (updateError) {
    return NextResponse.json({ error: 'Failed to deduct credits' }, { status: 500 })
  }

  return NextResponse.json({ success: true, creditsRemaining: data.credits_remaining, action })
}
