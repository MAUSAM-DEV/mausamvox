import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 30

// Hosts we allow to be proxied. Replicate's delivery CDN plus this project's
// own Supabase instance (for any future stored-stem paths).
const SUPABASE_HOST = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/^https?:\/\//, '')

function isAllowedHost(hostname: string): boolean {
  if (hostname === 'replicate.delivery') return true
  if (hostname.endsWith('.replicate.delivery')) return true
  if (SUPABASE_HOST && hostname === SUPABASE_HOST) return true
  return false
}

// GET /api/stems/download?url=<encoded>&filename=<encoded>
//
// Server-side proxy that fetches a stem file and returns it with
// Content-Disposition: attachment so the browser saves it rather than
// opening a new tab with the raw CDN page.
//
// The `download` attribute on <a> tags is ignored for cross-origin URLs
// (browser security), so direct links to replicate.delivery always open
// in a new tab. Routing through this same-origin endpoint fixes that.
export async function GET(req: NextRequest) {
  // Auth gate — stems belong to the authenticated session.
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  const url = req.nextUrl.searchParams.get('url')
  const filename = req.nextUrl.searchParams.get('filename') ?? 'stem.mp3'

  if (!url) {
    return NextResponse.json({ error: 'url param required' }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  if (!isAllowedHost(parsed.hostname)) {
    return NextResponse.json({ error: 'URL host not permitted' }, { status: 400 })
  }

  let upstream: Response
  try {
    upstream = await fetch(url)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[stems/download] fetch failed:', msg)
    return NextResponse.json({ error: `Fetch failed: ${msg}` }, { status: 502 })
  }

  if (!upstream.ok) {
    console.error('[stems/download] upstream', upstream.status, url)
    return NextResponse.json({ error: `Upstream returned ${upstream.status}` }, { status: 502 })
  }

  const contentType = upstream.headers.get('content-type') ?? 'audio/mpeg'
  const body = await upstream.arrayBuffer()

  const safeFilename = filename.replace(/[^\w.\-]/g, '_')

  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Content-Length': String(body.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}
