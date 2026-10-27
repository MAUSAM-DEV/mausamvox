import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { acceptUploadRights, readUploadRights } from '@/lib/consent'

// GET  → { uploadRights: boolean }  has this account confirmed it has the rights to its uploads?
// POST → records that it has (once; later calls keep the first date).
// Before migration 20261027000003 the GET says false (the page asks every visit) and the POST
// stores nothing — uploads are never blocked by a missing column.
export async function GET() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  return NextResponse.json({ uploadRights: (await readUploadRights(user.id)) === 'yes' })
}

export async function POST() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  const stored = await acceptUploadRights(user.id)
  return NextResponse.json({ ok: true, stored })
}
