// Choir Composer (DSP vocal harmonizer) — single source of truth for the
// credit price and the harmony presets, shared by the /api/choir route and
// the /choir page.
//
// HONESTY NOTE: this is a pitch-shift harmonizer, not SATB generation — every
// layer is the user's own vocal shifted to a musical interval and mixed back
// in. True multi-singer SATB is parked (no viable model; ElevenLabs can't do
// it from a vocal). UI copy must say "stacked harmonies", never "4 singers".
//
// Cheap deterministic ffmpeg compute (no paid model) — priced accordingly.
export const CHOIR_CREDITS = 25

export type ChoirMode = 'major' | 'octaves'
export type ChoirVoices = 2 | 4 | 8

// Semitone offsets for the HARMONY layers (the unshifted lead is always
// layer 0 and is not listed). Every offset stays within ±12 semitones so the
// route's timing correction is a single atempo pass (atempo's valid range is
// 0.5-2.0 — exactly one octave either way).
//
// 'major' — diatonic thirds & fifths around the lead (classic pad):
//   4 adds the major 3rd, 5th and low octave; 8 adds the octave above, the
//   4th and major 3rd below, and a +0.3st detuned unison for width.
// 'octaves' — octave stack with subtle detunes for chorus thickness (no new
//   chord tones, works over any key/harmony).
export const CHOIR_PRESETS: Record<ChoirMode, Record<ChoirVoices, number[]>> = {
  major: {
    2: [4],
    4: [4, 7, -12],
    8: [4, 7, 12, -5, -8, -12, 0.3],
  },
  octaves: {
    2: [12],
    4: [12, -12, 0.35],
    8: [12, -12, 0.35, -0.35, 11.65, 12.35, -11.65],
  },
}

export const CHOIR_MODE_LABELS: Record<ChoirMode, { label: string; hint: string }> = {
  major: { label: 'Thirds & fifths', hint: 'Classic major-key harmony pad — 3rds, 5ths and octaves around your line' },
  octaves: { label: 'Octaves', hint: 'Octave stack with subtle detune — fits any melody, no wrong notes possible' },
}
