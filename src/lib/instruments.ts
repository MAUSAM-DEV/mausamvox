// Instruments (voice → instrument) — single source of truth for the credit
// price, input caps, and the curated General MIDI instrument set. Shared by
// the /api/instruments route and the /instruments page.
//
// Pipeline (proven by scripts/spike-voice-to-instrument.mjs, PROJECT_STATUS
// §6): monophonic vocal → @spotify/basic-pitch (audio→MIDI) → js-synthesizer
// (WASM FluidSynth) + TimGM6mb.sf2 → instrument audio. Local compute only —
// no paid model.
export const INSTRUMENTS_CREDITS = 25

// Hard input cap. Basic Pitch inference on the tfjs WASM backend measured
// ~7× realtime locally (438 ms for 3.2 s); even several× slower on a lambda,
// 25 s of audio stays well inside the route's 60 s budget. The route logs
// `[timing] stage=basicpitch` — retune this cap from real numbers after
// deploy if headroom allows.
export const INSTRUMENTS_MAX_SECONDS = 25
export const INSTRUMENTS_MAX_BYTES = 15 * 1024 * 1024 // 25s even as WAV is ~5 MB; generous

// Spurious-note filter applied after transcription: hums produce brief
// low-confidence artifacts around breaths and note transitions.
export const MIN_NOTE_SECONDS = 0.08
export const MIN_NOTE_AMPLITUDE = 0.15

export interface InstrumentDef {
  id: string // stable identifier sent by the client
  label: string
  emoji: string
  gmProgram: number // General MIDI program number (0-127)
  group: 'Keys' | 'Strings' | 'Winds' | 'Brass' | 'Plucked' | 'Other'
}

// Curated GM programs — popular, distinctive, and known to read well in
// TimGM6mb. id/gmProgram are the contract; labels are display-only.
export const INSTRUMENTS: InstrumentDef[] = [
  // Keys
  { id: 'grand-piano', label: 'Grand Piano', emoji: '🎹', gmProgram: 0, group: 'Keys' },
  { id: 'electric-piano', label: 'Electric Piano', emoji: '🎹', gmProgram: 4, group: 'Keys' },
  { id: 'harpsichord', label: 'Harpsichord', emoji: '🎹', gmProgram: 6, group: 'Keys' },
  { id: 'celesta', label: 'Celesta', emoji: '✨', gmProgram: 8, group: 'Keys' },
  { id: 'music-box', label: 'Music Box', emoji: '🎁', gmProgram: 10, group: 'Keys' },
  { id: 'marimba', label: 'Marimba', emoji: '🪘', gmProgram: 12, group: 'Keys' },
  { id: 'church-organ', label: 'Church Organ', emoji: '⛪', gmProgram: 19, group: 'Keys' },
  { id: 'accordion', label: 'Accordion', emoji: '🪗', gmProgram: 21, group: 'Keys' },
  // Strings
  { id: 'violin', label: 'Violin', emoji: '🎻', gmProgram: 40, group: 'Strings' },
  { id: 'viola', label: 'Viola', emoji: '🎻', gmProgram: 41, group: 'Strings' },
  { id: 'cello', label: 'Cello', emoji: '🎻', gmProgram: 42, group: 'Strings' },
  { id: 'string-ensemble', label: 'String Ensemble', emoji: '🎼', gmProgram: 48, group: 'Strings' },
  // Plucked
  { id: 'nylon-guitar', label: 'Nylon Guitar', emoji: '🎸', gmProgram: 24, group: 'Plucked' },
  { id: 'steel-guitar', label: 'Steel Guitar', emoji: '🎸', gmProgram: 25, group: 'Plucked' },
  { id: 'electric-guitar', label: 'Electric Guitar (clean)', emoji: '🎸', gmProgram: 27, group: 'Plucked' },
  { id: 'overdrive-guitar', label: 'Overdriven Guitar', emoji: '🎸', gmProgram: 29, group: 'Plucked' },
  { id: 'harp', label: 'Harp', emoji: '🪕', gmProgram: 46, group: 'Plucked' },
  { id: 'sitar', label: 'Sitar', emoji: '🪕', gmProgram: 104, group: 'Plucked' },
  // Winds
  { id: 'flute', label: 'Flute', emoji: '🪈', gmProgram: 73, group: 'Winds' },
  { id: 'clarinet', label: 'Clarinet', emoji: '🎶', gmProgram: 71, group: 'Winds' },
  { id: 'oboe', label: 'Oboe', emoji: '🎶', gmProgram: 68, group: 'Winds' },
  { id: 'alto-sax', label: 'Alto Sax', emoji: '🎷', gmProgram: 65, group: 'Winds' },
  { id: 'pan-flute', label: 'Pan Flute', emoji: '🪈', gmProgram: 75, group: 'Winds' },
  { id: 'shehnai', label: 'Shehnai', emoji: '🎶', gmProgram: 111, group: 'Winds' },
  // Brass
  { id: 'trumpet', label: 'Trumpet', emoji: '🎺', gmProgram: 56, group: 'Brass' },
  { id: 'trombone', label: 'Trombone', emoji: '🎺', gmProgram: 57, group: 'Brass' },
  { id: 'french-horn', label: 'French Horn', emoji: '📯', gmProgram: 60, group: 'Brass' },
  { id: 'brass-section', label: 'Brass Section', emoji: '🎺', gmProgram: 61, group: 'Brass' },
  // Other
  { id: 'synth-lead', label: 'Synth Lead', emoji: '🎛️', gmProgram: 80, group: 'Other' },
  { id: 'synth-pad', label: 'Warm Synth Pad', emoji: '🎛️', gmProgram: 89, group: 'Other' },
  { id: 'steel-drums', label: 'Steel Drums', emoji: '🥁', gmProgram: 114, group: 'Other' },
  { id: 'whistle', label: 'Whistle', emoji: '😗', gmProgram: 78, group: 'Other' },
]

export function findInstrument(id: string): InstrumentDef | undefined {
  return INSTRUMENTS.find((i) => i.id === id)
}
