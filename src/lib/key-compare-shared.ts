// Shared by the Compare keys UI and /api/key-compare (browser + server).
export const KEY_COMPARE_MAX = 3 // comparisons per song per hour (free)
export const KEY_COMPARE_SECONDS = 15 // excerpt length

// Short stable tag for a song (its upload path) — names the excerpt files the
// server counts for the per-song limit. FNV-1a, two seeds → 16 hex chars.
export function songTag(trackKey: string): string {
  const fnv = (seed: number) => {
    let h = seed >>> 0
    for (let i = 0; i < trackKey.length; i++) { h ^= trackKey.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 }
    return h.toString(16).padStart(8, '0')
  }
  return fnv(2166136261) + fnv(0x9747b28c)
}
