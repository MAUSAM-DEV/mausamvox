// Song Studio's generation engine selector + pins, mirroring the env-flippable
// rvc-engine.ts pattern.
//
//   elevenlabs — ElevenLabs Music (music_v2), synchronous compose → mp3 bytes.
//                Integration lives in song-engine-elevenlabs.ts; needs
//                ELEVENLABS_API_KEY. Set SONG_ENGINE=elevenlabs.
//   acestep    — lucataco/ace-step on Replicate (create+poll). Also the
//                FALLBACK when SONG_ENGINE is unset or unrecognised (see
//                songEngine()), since it needs no extra key.
//   minimax    — MiniMax Music 2.5 (minimax/music-2.5) on Replicate, same
//                create+poll flow and REPLICATE_API_TOKEN as acestep.
//                Integration in song-engine-minimax.ts. No duration input
//                (length follows the lyrics). Set SONG_ENGINE=minimax.

export type SongEngine = 'elevenlabs' | 'acestep' | 'minimax'
const SONG_ENGINES: readonly SongEngine[] = ['elevenlabs', 'acestep', 'minimax']

// Fallback for an unset or unrecognised SONG_ENGINE: 'acestep', because it
// runs on the REPLICATE_API_TOKEN the app already needs for everything else.
// (It used to be 'elevenlabs', which fails outright without
// ELEVENLABS_API_KEY — and that key isn't configured in Vercel.)
// Case and surrounding whitespace are tolerated ("MiniMax " → minimax).
const FALLBACK_ENGINE: SongEngine = 'acestep'
let warnedValue: string | undefined | null = null // warn once per lambda/process

export function songEngine(): SongEngine {
  const raw = process.env.SONG_ENGINE
  const v = (raw ?? '').trim().toLowerCase()
  if ((SONG_ENGINES as readonly string[]).includes(v)) return v as SongEngine
  if (warnedValue !== raw) {
    warnedValue = raw
    console.warn(
      raw === undefined || v === ''
        ? `[song-engine] SONG_ENGINE is not set — falling back to '${FALLBACK_ENGINE}'. Set it to one of: ${SONG_ENGINES.join(', ')}.`
        : `[song-engine] SONG_ENGINE=${JSON.stringify(raw)} is not recognised — falling back to '${FALLBACK_ENGINE}'. Valid values: ${SONG_ENGINES.join(', ')}.`
    )
  }
  return FALLBACK_ENGINE
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
// audio_output_count=1, 2026-10-02).
//   Break-even: Starter ($9 / 8,000 cr = $0.001125/cr) → 134 cr;
//               Pro ($24 / 30,000 cr = $0.0008/cr)     → 188 cr.
//   At 250 cr a song earns $0.281 (Starter, ~47% margin) or $0.20 (Pro,
//   ~25% margin). Free plan's 500 cr = 2 songs = $0.30 max cost per free
//   user. Studio's "Unlimited credits" is NOT covered by any per-song price.
// The UI (button label, credit pre-check, toast) reads this constant —
// change it here only. (Was 50 = $0.04–$0.056 per song, below cost.)
export const SONG_STUDIO_CREDITS = 250

// Duration bounds we expose (schema allows 1-240s; below ~15s the output is
// rarely a usable "song", so the UI offers 30s-4min presets).
export const SONG_MIN_SECONDS = 10
export const SONG_MAX_SECONDS = 240
