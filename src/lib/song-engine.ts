// Song Studio's generation engine selector + pins, mirroring the env-flippable
// rvc-engine.ts pattern.
//
//   elevenlabs — ElevenLabs Music (music_v2), synchronous compose → mp3 bytes.
//                Default. Integration lives in song-engine-elevenlabs.ts;
//                needs ELEVENLABS_API_KEY.
//   acestep    — lucataco/ace-step on Replicate (create+poll), the previous
//                engine, kept fully intact as an instant rollback: set
//                SONG_ENGINE=acestep in Vercel + redeploy.
//   minimax    — MiniMax Music 2.5 (minimax/music-2.5) on Replicate, same
//                create+poll flow and REPLICATE_API_TOKEN as acestep.
//                Integration in song-engine-minimax.ts. No duration input
//                (length follows the lyrics). Set SONG_ENGINE=minimax.

export type SongEngine = 'elevenlabs' | 'acestep' | 'minimax'

// Absent/unset env means 'elevenlabs' — no Vercel dashboard step to adopt.
export function songEngine(): SongEngine {
  const v = process.env.SONG_ENGINE
  return v === 'acestep' || v === 'minimax' ? v : 'elevenlabs'
}

// Engines whose model takes a duration. MiniMax doesn't — the UI hides the
// duration control there rather than pretend it works.
export function engineSupportsDuration(engine: SongEngine): boolean {
  return engine !== 'minimax'
}

// Vocal selector (users reported every song came out with female vocals when
// the style prompt didn't say otherwise). The phrase is PREPENDED to the
// style prompt server-side so it leads the model's description; it works for
// every engine because all three read vocals from the style text.
export const SONG_VOCALS = ['male', 'female', 'duet', 'instrumental'] as const
export type SongVocals = (typeof SONG_VOCALS)[number]
export const SONG_VOCAL_LABELS: Record<SongVocals, string> = {
  male: 'Male',
  female: 'Female',
  duet: 'Duet',
  instrumental: 'Instrumental',
}
const SONG_VOCAL_PHRASES: Record<SongVocals, string> = {
  male: 'male vocals',
  female: 'female vocals',
  duet: 'male and female duet vocals',
  instrumental: 'instrumental, no vocals',
}
export function withVocalStyle(stylePrompt: string, vocals: SongVocals | undefined): string {
  if (!vocals) return stylePrompt
  return [SONG_VOCAL_PHRASES[vocals], stylePrompt].filter(Boolean).join(', ')
}

// ── ACE-Step pin (the 'acestep' fallback engine) ─────────────────────────────
// lucataco/ace-step generates a full song (music + optional vocals) from:
//   tags     — natural-language style/genre prompt, e.g. 'lo-fi, chill, female vocals'
//   lyrics   — with [verse]/[chorus]/[bridge] section tags; [instrumental] for no vocals
//   duration — seconds, schema range 1-240 (default 60)
// Output: a single audio file URI. ~30s-2min compute, ~$0.03/run.
//
// Version pinned 2026-07-12 from the model's live latest_version
// (created 2025-05-14). Full input schema reviewed the same day: the other
// params (seed, scheduler, guidance_*, number_of_steps, granularity_scale)
// are quality knobs left at their defaults.
export const ACE_STEP_MODEL = 'lucataco/ace-step'
export const ACE_STEP_VERSION = '280fc4f9ee507577f880a167f639c02622421d8fecf492454320311217b688f1'

// Credits charged per generation — single source of truth (route + UI import
// it). Charged atomically up front via deduct_credits(); refunded via
// add_credits() if the job fails (never charged on failure).
// ⚠️ On the elevenlabs engine this must cover the ElevenLabs per-generation
// cost + margin — value pending the founder's final number; unchanged for now.
// ⚠️ On the minimax engine it must cover MiniMax's cost: $0.15 per generated
// song (Replicate bills per output file — model page + a real run's
// audio_output_count=1, 2026-10-02). At current plan prices 50 credits earn
// $0.056 (Starter $9/8,000 cr) or $0.04 (Pro $24/30,000 cr) — BELOW cost.
// Break-even ≈ 134 cr (Starter) / 188 cr (Pro). Founder's pricing call.
export const SONG_STUDIO_CREDITS = 50

// Duration bounds we expose (schema allows 1-240s; below ~15s the output is
// rarely a usable "song", so the UI offers 30s-4min presets).
export const SONG_MIN_SECONDS = 10
export const SONG_MAX_SECONDS = 240
