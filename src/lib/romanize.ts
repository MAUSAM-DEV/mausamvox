import Sanscript from '@indic-transliteration/sanscript'

// Devanagari → casual-readable Latin ("Hinglish") for the lyrics
// "Hindi (romanized)" option. Server-side only (used by /api/lyrics).
//
// Pipeline: Sanscript (devanagari → IAST) then strip the scholarly diacritics
// (ā→a, ś→s …) for casual readability. Mixed-script lines are safe: Latin
// characters pass through Sanscript untouched.
//
// Known, accepted quirks (logged in PROJECT_STATUS; the edit modal is the
// remedy):
// - Extra inherent vowels: Sanscript applies Sanskrit rules, not Hindi schwa
//   deletion — "कर" comes out "kara" (not "kar"), "दिल" → "dila".
// - Nukta consonants (Urdu-origin sounds) have no Sanscript mapping — they
//   fall back to the base consonant: ज़िंदगी → "jindagi" (not "zindagi"),
//   फ़िल्म → "philma" (not "film").
// - Anusvara/candrabindu are rendered "n" (the common Hinglish spelling:
//   मैं → "main", हूँ → "hun") — occasionally "m" would read better (तुम्हें).

// Precomposed nukta consonants U+0958–U+095F → base consonant. The combining
// nukta (U+093C) itself is stripped separately, which handles the decomposed
// forms too.
const NUKTA_FALLBACK: Record<string, string> = {
  'क़': 'क', // क़ → क
  'ख़': 'ख', // ख़ → ख
  'ग़': 'ग', // ग़ → ग
  'ज़': 'ज', // ज़ → ज
  'ड़': 'ड', // ड़ → ड
  'ढ़': 'ढ', // ढ़ → ढ
  'फ़': 'फ', // फ़ → फ
  'य़': 'य', // य़ → य
}

const HAS_DEVANAGARI = /[ऀ-ॿ]/

export function romanizeDevanagari(text: string): string {
  if (!HAS_DEVANAGARI.test(text)) return text
  const prepped = text
    .normalize('NFC')
    .replace(/[क़-य़]/g, (c) => NUKTA_FALLBACK[c] ?? c)
    .replace(/़/g, '') // stray/decomposed nukta
    .replace(/[।॥]/g, ' ') // danda ।॥ — sentence marks, not lyrics
  const iast = Sanscript.t(prepped, 'devanagari', 'iast')
  return iast
    .replace(/m̐/g, 'n') // candrabindu (m̐)
    .replace(/ṃ/g, 'n') // anusvara (ṃ)
    .replace(/~/g, 'n') // Sanscript's fallback rendering of candrabindu
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // ā ī ū ś ṣ ṇ ṭ ḍ ḥ ṛ … → plain ASCII
    .replace(/\s+/g, ' ')
    .trim()
}
