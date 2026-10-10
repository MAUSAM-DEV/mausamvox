// Shared by the Compare keys UI and /api/key-compare (browser + server).

// Off switch (2026-10-10: hidden from Configure). false = no link, panel or
// hint line on the Song Key box, and /api/key-compare refuses every request.
// Set to true to bring the feature back exactly as it was.
export const KEY_COMPARE_ENABLED = false
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
