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

export const supabaseAdmin = createClient(
  supabaseUrl ?? '',
  serviceRoleKey ?? ''
)

/** True when the admin client is properly configured with a service-role key. */
export const adminConfigured = Boolean(supabaseUrl && serviceRoleKey)
