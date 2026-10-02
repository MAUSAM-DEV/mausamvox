// Song Studio style helpers: tap-to-add style chips, tempo/key pickers, the
// "Reuse style" parser, and cover-tile gradients. Client-safe (no server
// imports).
//
// Chips are deliberately MUSICAL only (genre, mood, instruments). No mix /
// production chips ("punchy", "crisp", "wide stereo"): listening tests on
// 2026-10-02 showed those words make the engine squash and smear the mix.
import type { SongAge, SongVocals } from './song-engine'

export const STYLE_CHIPS: { group: string; chips: string[] }[] = [
  {
    group: 'Genre',
    chips: ['Pop', 'Bollywood', 'Hip-hop', 'R&B', 'Rock', 'Lo-fi', 'EDM', 'Folk', 'Devotional', 'Jazz', 'K-pop', 'Latin', 'Indie', 'Classical', 'Afrobeats', 'Country'],
  },
  {
    group: 'Mood',
    chips: ['Happy', 'Sad', 'Romantic', 'Energetic', 'Chill', 'Epic', 'Dreamy', 'Nostalgic', 'Dark', 'Uplifting'],
  },
  {
    group: 'Instruments',
    chips: ['Piano', 'Acoustic guitar', 'Electric guitar', 'Strings', 'Tabla', 'Sitar', 'Flute', 'Synth', '808s', 'Drums', 'Harmonium', 'Violin', 'Saxophone', 'Dhol'],
  },
]

export const TEMPO_OPTIONS = [0, 70, 80, 90, 100, 110, 120, 128, 140, 160] // 0 = Auto
export const KEY_OPTIONS = [
  '', 'C major', 'G major', 'D major', 'A major', 'E major', 'F major', 'B♭ major', 'E♭ major',
  'A minor', 'E minor', 'B minor', 'D minor', 'G minor', 'C minor', 'F♯ minor',
] // '' = Auto

const norm = (s: string) => s.trim().toLowerCase()
function splitStyle(style: string): string[] {
  return style.split(',').map((p) => p.trim()).filter(Boolean)
}

export function styleHasChip(style: string, chip: string): boolean {
  return splitStyle(style).some((p) => norm(p) === norm(chip))
}

// Tap a chip: add it to the comma-separated style, or remove it if present.
// Free typing is untouched — only exact comma-separated matches toggle.
export function toggleChip(style: string, chip: string): string {
  const parts = splitStyle(style)
  const i = parts.findIndex((p) => norm(p) === norm(chip))
  if (i >= 0) parts.splice(i, 1)
  else parts.push(chip)
  return parts.join(', ')
}

// Style text actually sent: the user's style + optional tempo/key + language
// note (Simple mode), all as plain words the engine reads.
export function composeStyle(style: string, opts: { tempo?: number; key?: string; language?: string } = {}): string {
  const parts = splitStyle(style)
  if (opts.tempo) parts.push(`${opts.tempo} BPM`)
  if (opts.key) parts.push(`in ${opts.key}`)
  if (opts.language) parts.push(`sung in ${opts.language}`)
  return parts.join(', ')
}

// ── "Reuse style" ───────────────────────────────────────────────────────────
// A saved song's voice_used is "AI generated · <final style>", where the final
// style starts with the voice phrase withVocalStyle() wrote ("young male
// vocals, …", "male and female duet vocals, …", "instrumental, no vocals, …").
// Invert that so the create panel gets the style, vocals and age back.
// Anything unrecognised just becomes the style text (vocals/age untouched).
const VOICE_PREFIXES: { re: RegExp; vocals: SongVocals }[] = [
  { re: /^(?:(young|mature)\s+)?male and female duet vocals(?:,\s*|$)/i, vocals: 'duet' },
  { re: /^(?:(young|mature)\s+)?female vocals(?:,\s*|$)/i, vocals: 'female' },
  { re: /^(?:(young|mature)\s+)?male vocals(?:,\s*|$)/i, vocals: 'male' },
  { re: /^()instrumental, no vocals(?:,\s*|$)/i, vocals: 'instrumental' },
]
export function parseSavedStyle(voiceUsed: string | null | undefined): { style: string; vocals?: SongVocals; age?: SongAge } {
  let text = (voiceUsed ?? '').replace(/^AI generated\s*·?\s*/i, '').trim()
  // Test-only suffixes like " · mastered (warm & full)" aren't part of a style.
  text = text.replace(/\s*·\s*(?:mastered|lossless source).*$/i, '').trim()
  for (const { re, vocals } of VOICE_PREFIXES) {
    const m = text.match(re)
    if (m) {
      const age = (m[1]?.toLowerCase() as SongAge | undefined) || 'auto'
      return { style: text.slice(m[0].length).trim(), vocals, age }
    }
  }
  return { style: text }
}

// ── Cover tiles ─────────────────────────────────────────────────────────────
// A two-colour gradient derived from the title (stable per title, no image
// model). Hues are spread so neighbouring songs look different.
export function coverGradient(seed: string): string {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) }
  const a = Math.abs(h) % 360
  const b = (a + 40 + (Math.abs(h >> 8) % 80)) % 360
  const angle = 120 + (Math.abs(h >> 16) % 120)
  return `linear-gradient(${angle}deg, hsl(${a} 78% 58%), hsl(${b} 82% 46%))`
}
