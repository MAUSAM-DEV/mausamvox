import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'

const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 10

export async function POST(request: NextRequest) {
  // ── 1. Rate limit by IP ────────────────────────────────────────
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'

  const rl = rateLimit(ip, 'sign-up', { max: MAX_ATTEMPTS, windowMs: WINDOW_MS })

  if (!rl.allowed) {
    const mins = Math.ceil(rl.retryAfterSecs / 60)
    return NextResponse.json(
      { error: `Too many sign-up attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` },
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

  // ── 3. Derive callback URL from the incoming request host ──────
  // Using the server-side host prevents open-redirect attacks that
  // could occur if we trusted a client-supplied redirectTo value.
  const origin = `${request.nextUrl.protocol}//${request.nextUrl.host}`
  const emailRedirectTo = `${origin}/auth/callback?next=/onboarding`

  // ── 4. Call Supabase ───────────────────────────────────────────
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

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo },
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return response
}
