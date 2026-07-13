// Song Studio's generation engine selector + pins, mirroring the env-flippable
// rvc-engine.ts pattern.
//
//   elevenlabs — ElevenLabs Music (music_v2), synchronous compose → mp3 bytes.
//                Default. Integration lives in song-engine-elevenlabs.ts;
//                needs ELEVENLABS_API_KEY.
//   acestep    — lucataco/ace-step on Replicate (create+poll), the previous
//                engine, kept fully intact as an instant rollback: set
//                SONG_ENGINE=acestep in Vercel + redeploy.

// Absent/unset env means 'elevenlabs' — no Vercel dashboard step to adopt.
export function songEngine(): 'elevenlabs' | 'acestep' {
  return process.env.SONG_ENGINE === 'acestep' ? 'acestep' : 'elevenlabs'
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
export const SONG_STUDIO_CREDITS = 50

// Duration bounds we expose (schema allows 1-240s; below ~15s the output is
// rarely a usable "song", so the UI offers 30s-4min presets).
export const SONG_MIN_SECONDS = 10
export const SONG_MAX_SECONDS = 240
