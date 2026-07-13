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
// exact phrasing given to the LLM. Roman-script variants are offered because
// ACE-Step (Song Studio's singer) and most karaoke readers handle Latin
// script most predictably.
export const LYRICS_GEN_LANGUAGES = [
  { id: 'english', label: 'English', instruction: 'English' },
  { id: 'hindi', label: 'Hindi (Devanagari)', instruction: 'Hindi in Devanagari script' },
  { id: 'hinglish', label: 'Hinglish (Roman Hindi)', instruction: 'Hindi written in Latin/Roman script (Hinglish)' },
  { id: 'punjabi', label: 'Punjabi (Roman)', instruction: 'Punjabi written in Latin/Roman script' },
  { id: 'tamil', label: 'Tamil', instruction: 'Tamil in Tamil script' },
  { id: 'bengali', label: 'Bengali', instruction: 'Bengali in Bengali script' },
] as const

export const LYRICS_GEN_STRUCTURES = [
  { id: 'auto', label: 'Auto', instruction: 'whatever structure fits the theme best (use [verse]/[chorus], add [bridge] only if it helps)' },
  { id: 'vc', label: '2 verses + chorus', instruction: '2 verses and a repeating chorus' },
  { id: 'vcb', label: 'Verse · chorus · bridge', instruction: 'verse, chorus, second verse, chorus, bridge, final chorus' },
  { id: 'short', label: 'Short hook', instruction: 'one short verse and one catchy chorus (a short song)' },
] as const

export type LyricsGenLanguageId = (typeof LYRICS_GEN_LANGUAGES)[number]['id']
export type LyricsGenStructureId = (typeof LYRICS_GEN_STRUCTURES)[number]['id']
