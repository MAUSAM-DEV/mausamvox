import { supabaseAdmin } from '@/lib/supabase/admin'

// Upload-rights consent (2026-10-27): an account ticks "I own this audio or have the rights to
// use it" once, before its first song upload; users.upload_rights_accepted_at records when.
// Until migration 20261027000003 runs the column doesn't exist — then nothing is blocked (the
// page still shows the checkbox), so deploying before the migration breaks no upload.

const MISSING_COLUMN = ['42703', 'PGRST204']

// 'yes' / 'no' = what the account row says; 'unknown' = column missing or the read failed
export async function readUploadRights(userId: string): Promise<'yes' | 'no' | 'unknown'> {
  const { data, error } = await supabaseAdmin
    .from('users').select('upload_rights_accepted_at').eq('id', userId).maybeSingle()
  if (error) {
    if (!MISSING_COLUMN.includes(error.code ?? '')) console.error('[consent] read failed:', error.message)
    return 'unknown'
  }
  return (data as { upload_rights_accepted_at?: string | null } | null)?.upload_rights_accepted_at ? 'yes' : 'no'
}

// The split routes' gate: only a definite 'no' blocks (a database hiccup must not block an upload
// the page already asked about).
export async function uploadRightsBlocked(userId: string): Promise<boolean> {
  return (await readUploadRights(userId)) === 'no'
}

// true = stored (or already stored); false = not stored (column missing / write failed)
export async function acceptUploadRights(userId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('users').update({ upload_rights_accepted_at: new Date().toISOString() })
    .eq('id', userId).is('upload_rights_accepted_at', null) // keeps the first date
  if (error) {
    if (!MISSING_COLUMN.includes(error.code ?? '')) console.error('[consent] write failed:', error.message)
    return false
  }
  return true
}

export const UPLOAD_RIGHTS_REFUSED =
  'Please tick “I own this audio or have the rights to use it” before uploading.'
