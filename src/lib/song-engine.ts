// Song Studio's generation engine pin — ACE-Step on Replicate, mirroring the
// rvc-engine.ts pattern (version pinned so behavior never changes under us).
//
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
// add_credits() if the Replicate job fails (never charged on failure).
export const SONG_STUDIO_CREDITS = 50

// Duration bounds we expose (schema allows 1-240s; below ~15s the output is
// rarely a usable "song", so the UI offers 30s-4min presets).
export const SONG_MIN_SECONDS = 10
export const SONG_MAX_SECONDS = 240
