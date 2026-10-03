// Server-only — never import this in client components or pages
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Detect key format without printing the key itself
function detectKeyFormat(key: string | undefined): string {
  if (!key) return 'MISSING'
  if (key.startsWith('eyJ')) return 'legacy-JWT (eyJ...)'
  if (key.startsWith('sb_secret_')) return 'new-format sb_secret_*'
  if (key.startsWith('sb_publishable_')) return 'new-format sb_publishable_* (WRONG — must be secret)'
  return `unknown-format (first 4 chars: ${key.slice(0, 4)})`
}

const keyFormat = detectKeyFormat(serviceRoleKey)
console.log(
  '[supabaseAdmin] init —',
  'hasUrl:', !!supabaseUrl,
  '| hasKey:', !!serviceRoleKey,
  '| keyFormat:', keyFormat,
  '| adminConfigured:', !!(supabaseUrl && serviceRoleKey)
)

if (!supabaseUrl) {
  console.error('[supabaseAdmin] NEXT_PUBLIC_SUPABASE_URL is not set')
}
if (!serviceRoleKey) {
  console.error(
    '[supabaseAdmin] SUPABASE_SERVICE_ROLE_KEY is not set — all admin DB and ' +
    'storage operations will fail. Add it to Vercel → Project Settings → ' +
    'Environment Variables and redeploy.'
  )
}

// Every admin call must hit Supabase live. Next.js 14 caches fetch() made from
// route handlers by default (its Data Cache, which also survives deploys), so
// without `cache: 'no-store'` a route that reads nothing from the request
// served the SAME signed URL for over an hour after it expired — the
// voice-model proxy broke every Voice Swap with "HTTP 400" (2026-10-03).
// It would equally serve stale database rows.
const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' })

export const supabaseAdmin = createClient(
  supabaseUrl ?? '',
  serviceRoleKey ?? '',
  { global: { fetch: noStoreFetch } }
)

/** True when the admin client is properly configured with a service-role key. */
export const adminConfigured = Boolean(supabaseUrl && serviceRoleKey)
