import { NextResponse } from 'next/server'

// GET /api/version — the version of the deployment now serving the site
// (next.config.mjs NEXT_PUBLIC_APP_VERSION). NewVersionBar compares it with
// the version its own page was built with. Public, no data, never cached.
export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { version: process.env.NEXT_PUBLIC_APP_VERSION || '' },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
