import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'

const WINDOW_MS = 15 * 60 * 1000   // 15 minutes
const MAX_ATTEMPTS = 10

export async function POST(request: NextRequest) {
  // ── 1. Rate limit by IP ────────────────────────────────────────
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  const rl = rateLimit(ip, 'sign-in', { max: MAX_ATTEMPTS, windowMs: WINDOW_MS })

  if (!rl.allowed) {
    const mins = Math.ceil(rl.retryAfterSecs / 60)
    return NextResponse.json(
      { error: `Too many sign-in attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSecs) } }
    )
  }

  // ── 2. Parse body ──────────────────────────────────────────────
  let email: string, password: string
  try {
    ;({ email, password } = await request.json())
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required.' }, { status: 400 })
  }

  // ── 3. Call Supabase server-side and forward session cookies ───
  const response = NextResponse.json({ ok: true })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Return a generic message — don't leak whether email exists
    return NextResponse.json(
      { error: 'Invalid email or password.' },
      { status: 401 }
    )
  }

  return response
}
