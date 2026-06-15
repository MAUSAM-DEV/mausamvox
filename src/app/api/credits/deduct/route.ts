import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(req: NextRequest) {
  let body: { userId?: string; amount?: number; action?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { userId, amount, action } = body

  if (!userId || typeof amount !== 'number' || amount <= 0) {
    return NextResponse.json({ error: 'userId and a positive amount are required' }, { status: 400 })
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
