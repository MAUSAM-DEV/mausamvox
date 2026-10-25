import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { newEnginesFor, newEnginesMode } from '@/lib/new-engines'

// GET /api/engine-access → { newEngines, mode } for the signed-in account (lib/new-engines.ts).
// The Voice Swap page uses it to show the Configure "Voice" control, check the song's
// language and warm the engines. Only a hint for the page: every server route checks again.
export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return NextResponse.json({ newEngines: newEnginesFor(user?.email), mode: newEnginesMode() })
}
