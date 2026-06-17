// Server-only — never import this in client components or pages
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

// Log clearly at startup so Vercel function logs immediately show the root cause
// if either env var is missing, instead of a confusing "permission denied" later.
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
