// Which kind of harmony a song gets (no audio code here, so the page can use
// it without loading the pitch-shifting engine — see harmony.ts).

import type { KeyEstimate } from './key-detect'

export type HarmonyVoices = 2 | 4
export type HarmonyMode = 'scale' | 'octaves'

export const HARMONY_GAIN = 0.55          // each added voice vs the lead (as Choir)
// Use scale harmony only when the key finder is sure it's major: the best key
// is major, fits well (KEY_MIN_SCORE), beats the best minor key by
// MAJOR_MIN_MARGIN, and beats every other key by KEY_MIN_RUNNER_UP (a near-tie
// between e.g. C and G major would put one harmony note out of key). Checked
// 2026-10-04 on 5 songs against a second key finder (librosa CQT chroma): the
// scale-vs-octaves decision agreed on all 5; the one key the two disagreed on
// scored 0.48 here (→ octaves).
export const KEY_MIN_SCORE = 0.6
export const MAJOR_MIN_MARGIN = 0.05
export const KEY_MIN_RUNNER_UP = 0.03

export function harmonyMode(key: KeyEstimate | null): HarmonyMode {
  if (!key) return 'octaves'
  return key.mode === 'major' && key.score >= KEY_MIN_SCORE && key.margin >= MAJOR_MIN_MARGIN && key.runnerUpMargin >= KEY_MIN_RUNNER_UP ? 'scale' : 'octaves'
}
