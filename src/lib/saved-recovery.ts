// After a long request loses its connection (or hits the server's time
// limit), the work may still have finished and been saved — and charged.
// Before telling the user it failed, look in their Saved Tracks for a row of
// this kind created since the request started (2026-10-09 audit: Choir and
// Instruments said "failed" on a dropped connection while the server finished,
// inviting a second, paid attempt).
import { createClient } from '@/lib/supabase/client'

export async function findSavedSince(kind: string, sinceIso: string, waitMs = 90_000): Promise<{ id: string; song_name: string } | null> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const until = Date.now() + waitMs
  for (;;) {
    const { data } = await supabase
      .from('voice_swaps')
      .select('id, song_name, created_at')
      .eq('user_id', user.id)
      .eq('kind', kind)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(1)
    if (data?.[0]) return { id: data[0].id as string, song_name: data[0].song_name as string }
    if (Date.now() >= until) return null
    await new Promise((r) => setTimeout(r, 5000))
  }
}
