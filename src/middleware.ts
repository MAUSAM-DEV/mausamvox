import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the session — must call getUser() (not getSession()) to avoid stale JWT
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (
    !user &&
    (pathname.startsWith('/voice-swap') || pathname.startsWith('/voice-lab') || pathname.startsWith('/stem-studio') || pathname.startsWith('/song-studio') || pathname.startsWith('/choir') || pathname.startsWith('/instruments') || pathname.startsWith('/swaps') || pathname.startsWith('/settings'))
  ) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/sign-in'
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/voice-swap/:path*', '/voice-lab/:path*', '/stem-studio/:path*', '/song-studio/:path*', '/choir/:path*', '/instruments/:path*', '/swaps/:path*', '/settings/:path*'],
}
