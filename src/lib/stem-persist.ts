import { supabaseAdmin } from '@/lib/supabase/admin'

// ── Durable stem copies ──────────────────────────────────────────────────────
// Replicate (Demucs, KARA_2) returns ephemeral replicate.delivery URLs (~1h).
// Stems are consumed well past that hour — localStorage cache restores, duet
// flows, the full-song mix in ResultStep — so each stem is copied into the
// private audio-uploads bucket and callers get a durable path they can re-sign
// fresh at the moment of use. Same pattern as gender-split's persistStem and
// voice-swaps/persist. NEVER store the signed URL itself (recurring gotcha).
export const STEMS_BUCKET = 'audio-uploads'
export const STEM_URL_TTL = 21600 // 6h, matches upload-stem/sign

// Copy one stem into Supabase at `path`. Returns a fresh signed URL + the
// durable storage path, or null on any failure (soft-fallback: the caller keeps
// the ephemeral source URL so the flow still works for the next ~hour).
// Idempotent: a re-poll after success reuses the existing object without a
// re-download — createSignedUrl errors on a missing object, so it doubles as
// an existence probe.
// `contentType` other than audio/mpeg falls back to the audio/mpeg label if
// the bucket doesn't allow it yet (the browser decodes by the bytes, not the
// label — the karaoke WAVs have always been stored this way).
export async function persistStemFile(
  tag: string,
  path: string,
  sourceUrl: string,
  contentType = 'audio/mpeg',
): Promise<{ url: string; path: string } | null> {
  try {
    const existing = await supabaseAdmin.storage.from(STEMS_BUCKET).createSignedUrl(path, STEM_URL_TTL)
    if (existing.data?.signedUrl) return { url: existing.data.signedUrl, path }

    const res = await fetch(sourceUrl)
    if (!res.ok) throw new Error(`download failed (http ${res.status})`)
    const buffer = Buffer.from(await res.arrayBuffer())
    let up = await supabaseAdmin.storage.from(STEMS_BUCKET).upload(path, buffer, { contentType, upsert: true })
    if (up.error && contentType !== 'audio/mpeg' && /mime/i.test(up.error.message)) {
      console.warn(`[${tag}] ${contentType} not allowed on ${STEMS_BUCKET} yet — storing ${path} under audio/mpeg`)
      up = await supabaseAdmin.storage.from(STEMS_BUCKET).upload(path, buffer, { contentType: 'audio/mpeg', upsert: true })
    }
    if (up.error) throw new Error(`upload failed: ${up.error.message}`)
    const signed = await supabaseAdmin.storage.from(STEMS_BUCKET).createSignedUrl(path, STEM_URL_TTL)
    if (signed.error || !signed.data?.signedUrl) throw new Error(`sign failed: ${signed.error?.message ?? 'unknown'}`)
    return { url: signed.data.signedUrl, path }
  } catch (err) {
    console.error(`[${tag}] stem persist failed for ${path}, using ephemeral URL:`, err instanceof Error ? err.message : String(err))
    return null
  }
}
