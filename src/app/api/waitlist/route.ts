import { NextRequest, NextResponse } from 'next/server'
import isEmail from 'validator/lib/isEmail'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { rateLimit } from '@/lib/rate-limit'

const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10
const MAX_EMAIL_LENGTH = 254   // RFC 5321 max address length

// Postgres unique_violation — the email is already on the list.
const UNIQUE_VIOLATION = '23505'

export async function POST(request: NextRequest) {
  // ── 1. Rate limit by IP ────────────────────────────────────────
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  const rl = rateLimit(ip, 'waitlist', { max: MAX_ATTEMPTS, windowMs: WINDOW_MS })

  if (!rl.allowed) {
    const mins = Math.ceil(rl.retryAfterSecs / 60)
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSecs) } }
    )
  }

  // ── 2. Parse + validate ────────────────────────────────────────
  let rawEmail: unknown
  try {
    ;({ email: rawEmail } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (typeof rawEmail !== 'string' || !rawEmail.trim()) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }

  const email = rawEmail.trim().toLowerCase()

  if (email.length > MAX_EMAIL_LENGTH || !isEmail(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  // ── 3. Insert (duplicates are a success, not an error) ─────────
  const { error } = await supabaseAdmin
    .from('waitlist')
    .insert({
      email,
      source: 'sign-up-page',
      user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
    })

  if (error) {
    // Already on the list → same friendly confirmation. Telling the visitor
    // "that email is already registered" would also leak list membership.
    if (error.code === UNIQUE_VIOLATION) {
      return NextResponse.json({ ok: true, alreadyOnList: true })
    }

    console.error('[waitlist] insert failed —', error.code, error.message)
    return NextResponse.json(
      { error: 'Could not save your email right now. Please try again in a moment.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, alreadyOnList: false })
}
