// AI lyrics generator engine pin — an instruction LLM on Replicate (reuses
// REPLICATE_API_TOKEN, no new provider), mirroring the song-engine.ts pattern.
//
// openai/gpt-4o-mini chosen 2026-07-13: cheapest solid multilingual instruct
// model on Replicate (~$0.15/M input + $0.60/M output tokens → a lyrics run
// of ~300 in / ~600 out ≈ $0.0004). Verified live the same day: by-version
// prediction create works, format adherence is exact ([verse]/[chorus] tags,
// no commentary) and Hinglish output reads naturally. anthropic/claude-3.5-
// haiku was evaluated first but its Replicate backend returned 500s on every
// request (including a bare "say hello"), so it was rejected on reliability.
export const LYRICS_GEN_MODEL = 'openai/gpt-4o-mini'
export const LYRICS_GEN_VERSION = '86d7f12d34e3f9b6e149231f42154d0f41081d91484932e3f1ee608fc207f7d9'

// Credits charged per generation — single source of truth (route + UI).
// Compute is ~$0.0004/run, so 5 credits is comfortably above cost.
export const LYRICS_GEN_CREDITS = 5

// Input caps (route validates, UI enforces via maxLength).
export const LYRICS_THEME_MAX = 300
export const LYRICS_MOOD_MAX = 120

// Target languages: id is the API value, label the UI text, instruction the
// exact phrasing given to the LLM, sung = the plain language name used for
// the "sung in <language>" style note. MausamVox is for any song in any
// language: a broad list plus 'other' with a typed language name (validated
// in resolveLyricsLanguage). Existing ids are kept so older pages still work.
export const LYRICS_GEN_LANGUAGES = [
  { id: 'english', label: 'English', instruction: 'English', sung: 'English' },
  { id: 'hindi', label: 'Hindi (Devanagari)', instruction: 'Hindi in Devanagari script', sung: 'Hindi' },
  { id: 'hinglish', label: 'Hinglish (Roman Hindi)', instruction: 'Hindi written in Latin/Roman script (Hinglish)', sung: 'Hindi' },
  { id: 'spanish', label: 'Spanish', instruction: 'Spanish', sung: 'Spanish' },
  { id: 'bengali', label: 'Bengali', instruction: 'Bengali in Bengali script', sung: 'Bengali' },
  { id: 'tamil', label: 'Tamil', instruction: 'Tamil in Tamil script', sung: 'Tamil' },
  { id: 'telugu', label: 'Telugu', instruction: 'Telugu in Telugu script', sung: 'Telugu' },
  { id: 'marathi', label: 'Marathi', instruction: 'Marathi in Devanagari script', sung: 'Marathi' },
  { id: 'gujarati', label: 'Gujarati', instruction: 'Gujarati in Gujarati script', sung: 'Gujarati' },
  { id: 'kannada', label: 'Kannada', instruction: 'Kannada in Kannada script', sung: 'Kannada' },
  { id: 'malayalam', label: 'Malayalam', instruction: 'Malayalam in Malayalam script', sung: 'Malayalam' },
  { id: 'punjabi', label: 'Punjabi (Roman)', instruction: 'Punjabi written in Latin/Roman script', sung: 'Punjabi' },
  { id: 'urdu', label: 'Urdu', instruction: 'Urdu in Urdu (Perso-Arabic) script', sung: 'Urdu' },
  { id: 'nepali', label: 'Nepali', instruction: 'Nepali in Devanagari script', sung: 'Nepali' },
  { id: 'arabic', label: 'Arabic', instruction: 'Arabic in Arabic script', sung: 'Arabic' },
  { id: 'french', label: 'French', instruction: 'French', sung: 'French' },
  { id: 'portuguese', label: 'Portuguese', instruction: 'Portuguese', sung: 'Portuguese' },
  { id: 'german', label: 'German', instruction: 'German', sung: 'German' },
  { id: 'italian', label: 'Italian', instruction: 'Italian', sung: 'Italian' },
  { id: 'turkish', label: 'Turkish', instruction: 'Turkish', sung: 'Turkish' },
  { id: 'russian', label: 'Russian', instruction: 'Russian in Cyrillic script', sung: 'Russian' },
  { id: 'japanese', label: 'Japanese', instruction: 'Japanese', sung: 'Japanese' },
  { id: 'korean', label: 'Korean', instruction: 'Korean in Hangul', sung: 'Korean' },
  { id: 'mandarin', label: 'Chinese (Mandarin)', instruction: 'Mandarin Chinese in simplified characters', sung: 'Mandarin Chinese' },
  { id: 'indonesian', label: 'Indonesian', instruction: 'Indonesian', sung: 'Indonesian' },
  { id: 'swahili', label: 'Swahili', instruction: 'Swahili', sung: 'Swahili' },
  { id: 'other', label: 'Other — type it', instruction: '', sung: '' },
] as const

// 'other': the user types the language. Letters (any script), spaces,
// hyphens and parentheses only, 2–40 chars — so nothing but a language name
// can reach the LLM instruction.
export const LYRICS_CUSTOM_LANGUAGE_MAX = 40
const CUSTOM_LANGUAGE_RE = new RegExp('^[\\p{L}\\p{M}][\\p{L}\\p{M} ()-]{1,39}$', 'u') // any script
export function resolveLyricsLanguage(id: unknown, custom?: unknown): { id: string; instruction: string; sung: string } | null {
  if (id === 'other') {
    const name = typeof custom === 'string' ? custom.trim().replace(/\s+/g, ' ') : ''
    if (!CUSTOM_LANGUAGE_RE.test(name)) return null
    return { id: 'other', instruction: `${name} (in its usual script)`, sung: name }
  }
  const l = LYRICS_GEN_LANGUAGES.find((x) => x.id === id && x.id !== 'other')
  return l ? { id: l.id, instruction: l.instruction, sung: l.sung } : null
}

export const LYRICS_GEN_STRUCTURES = [
  { id: 'auto', label: 'Auto', instruction: 'whatever structure fits the theme best (use [verse]/[chorus], add [bridge] only if it helps)' },
  { id: 'vc', label: '2 verses + chorus', instruction: '2 verses and a repeating chorus' },
  { id: 'vcb', label: 'Verse · chorus · bridge', instruction: 'verse, chorus, second verse, chorus, bridge, final chorus' },
  { id: 'short', label: 'Short hook', instruction: 'one short verse and one catchy chorus (a short song)' },
] as const

export type LyricsGenLanguageId = (typeof LYRICS_GEN_LANGUAGES)[number]['id']
export type LyricsGenStructureId = (typeof LYRICS_GEN_STRUCTURES)[number]['id']
