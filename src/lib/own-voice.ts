// Own-voice check (2026-10-27): after saving a voice, the user says a random number sequence; the
// finishing machine's speaker_match task (models hd-finish/speaker.py, ECAPA embeddings) scores how
// alike the two voices are (cosine, about 0–1).
//
// Calibrated on the app's own recordings (10 recordings, 3 people, sung, 6 s snippets): same person
// median 0.66 (5 % below 0.44, lowest 0.29 — iPhone vs studio mic), different people median 0.30
// (5 % above 0.53, highest 0.64 — two men). The check clip is SPOKEN, which usually scores lower
// against a sung recording, so this is a soft gate: a stored score and a message, never a block.
// Re-calibrate from the stored scores (voice_clones.own_voice_score) once real checks come in.
export const OWN_VOICE_MATCH_AT = 0.5      // at or above: "matches"
export const OWN_VOICE_MISMATCH_BELOW = 0.3 // below: "doesn't sound like the recording"

export type OwnVoiceVerdict = 'match' | 'unsure' | 'mismatch'
export function ownVoiceVerdict(score: number): OwnVoiceVerdict {
  return score >= OWN_VOICE_MATCH_AT ? 'match' : score < OWN_VOICE_MISMATCH_BELOW ? 'mismatch' : 'unsure'
}

// Five random digits, e.g. "7 2 9 4 1" — random so a pre-made recording of someone else can't be used
export function randomPhrase(): string {
  return Array.from({ length: 5 }, () => Math.floor(Math.random() * 10)).join(' ')
}
