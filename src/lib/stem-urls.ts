// Fresh signed links for a StemResult's stems, from their durable storage paths (our rule: never
// use stored expiring links). Used on session restore, on reopening a recent take, and by the Result
// screen right before it fetches the stems (2026-10-24).
import type { StemResult } from '@/components/voice-swap/UploadStep'

// Every StemResult URL field that has a durable-path twin. Used on cache
// restore to re-sign fresh URLs for all of them in one /api/stems/refresh call.
export const STEM_PATH_FIELDS: { path: keyof StemResult; url: keyof StemResult }[] = [
  { path: 'vocalsPath',        url: 'vocalsUrl' },
  { path: 'leadVocalsPath',    url: 'leadVocalsUrl' },
  { path: 'backingVocalsPath', url: 'backingVocalsUrl' },
  { path: 'maleVocalsPath',    url: 'maleVocalsUrl' },
  { path: 'femaleVocalsPath',  url: 'femaleVocalsUrl' },
  { path: 'bassPath',          url: 'bassUrl' },
  { path: 'drumsPath',         url: 'drumsUrl' },
  { path: 'otherPath',         url: 'otherUrl' },
  { path: 'instrumentalPath',  url: 'instrumentalUrl' },
]

// Re-sign every stem in a restored StemResult from its durable storage path.
// Cached signed URLs go stale (6h TTL, and Replicate/MVSEP source URLs die in
// ~1h) — feeding them to RVC or the full-song mix is what produced wrong-voice
// and music-missing swaps. Soft per-stem: a stem whose path is absent (legacy
// cache) or fails to sign keeps its old URL, and the whole thing never throws.
export async function refreshStemUrls(result: StemResult): Promise<StemResult> {
  const wanted = STEM_PATH_FIELDS.filter(({ path }) => result[path])
  if (wanted.length === 0) return result
  try {
    const res = await fetch('/api/stems/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: wanted.map(({ path }) => result[path]) }),
    })
    if (!res.ok) {
      console.warn('[stem-cache] URL refresh failed:', res.status)
      return result
    }
    const { urls } = (await res.json()) as { urls: Record<string, string | null> }
    const refreshed = { ...result }
    let count = 0
    for (const { path, url } of wanted) {
      const fresh = urls[result[path] as string]
      if (fresh) {
        (refreshed as unknown as Record<string, string>)[url] = fresh
        count++
      }
    }
    console.log(`[stem-cache] re-signed ${count}/${wanted.length} stem URLs on restore`)
    return refreshed
  } catch (e) {
    console.warn('[stem-cache] URL refresh threw:', e)
    return result
  }
}
