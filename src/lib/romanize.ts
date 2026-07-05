import Sanscript from '@indic-transliteration/sanscript'

// Devanagari → casual-readable Latin ("Hinglish") for the lyrics
// "Hindi (romanized)" option. Server-side only (used by /api/lyrics).
//
// Pipeline: Sanscript (devanagari → IAST) then strip the scholarly diacritics
// (ā→a, ś→s …) for casual readability. Mixed-script lines are safe: Latin
// characters pass through Sanscript untouched.
//
// A curated whole-word correction pass (HINGLISH_FIXES) then cleans up the two
// most visible artefacts for the commonest lyric words — Sanskrit inherent
// vowels ("kara"→"kar") and dropped nukta sounds ("jindagi"→"zindagi",
// "philma"→"film"). It is a dictionary, NOT a schwa/nukta algorithm: it can't
// cover every word, and the honest caveat + the per-line edit modal remain the
// real fix (see PROJECT_STATUS).
//
// Known, accepted quirks that remain for words OUTSIDE the dictionary:
// - Extra inherent vowels: Sanscript applies Sanskrit rules, not Hindi schwa
//   deletion — an uncommon "घर"-shaped word still comes out with a trailing a.
// - Nukta consonants (Urdu-origin sounds) have no Sanscript mapping — outside
//   the dictionary they fall back to the base consonant (z→j, f→ph).
// - Anusvara/candrabindu are rendered "n" (the common Hinglish spelling:
//   मैं → "main", हूँ → "hoon") — occasionally "m" would read better (तुम्हें).

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

// Whole-word Hinglish spelling corrections for the commonest lyric words.
// Keys are the LOWERCASE token our pipeline produces (after diacritic
// stripping); values are the preferred casual Hinglish spelling. Applied per
// alphabetic token, so punctuation and mixed-in English are untouched.
//
// Two classes, per the request:
//  • schwa — Sanscript keeps Sanskrit inherent vowels ("kara", "dila", "hun").
//  • nukta — z/f sounds Sanscript can't represent collapse to the base
//    consonant ("jindagi", "philma").
//
// Curated for low collision (whole-word only). A few unavoidable homograph
// trade-offs are accepted (e.g. प्यार/प्यारा both romanize to "pyara"; we
// prefer "pyaar") — the edit modal is the remedy when it matters.
const HINGLISH_FIXES: Record<string, string> = {
  // ── schwa: trailing / internal inherent-vowel drops ──
  hun: 'hoon',
  kara: 'kar',
  dila: 'dil',
  diladara: 'dildaar',
  diladar: 'dildaar',
  ghara: 'ghar',
  tuma: 'tum',
  raba: 'rab',
  darda: 'dard',
  dina: 'din',
  yara: 'yaar',
  pala: 'pal',
  dama: 'dam',
  jisma: 'jism',
  saatha: 'saath',
  satha: 'saath',
  haatha: 'haath',
  hatha: 'haath',
  pyara: 'pyaar',
  sanama: 'sanam',
  qarara: 'qaraar',
  karara: 'karaar',
  intejara: 'intezaar',
  intezara: 'intezaar',
  // ── nukta: z / f sounds Sanscript drops to the base consonant ──
  jindagi: 'zindagi',
  jindgi: 'zindagi',
  jindegi: 'zindagi',
  jara: 'zara',
  jaroor: 'zaroor',
  jarurat: 'zaroorat',
  jaruurat: 'zaroorat',
  jameen: 'zameen',
  jamina: 'zameen',
  julma: 'zulm',
  maja: 'maza',
  saja: 'saza',
  awaja: 'awaaz',
  aavaja: 'awaaz',
  philm: 'film',
  philma: 'film',
  philmi: 'filmi',
  ishka: 'ishq',
  kaphi: 'kaafi',
}

function applyHinglishFixes(text: string): string {
  return text.replace(/[a-z]+/gi, (w) => HINGLISH_FIXES[w.toLowerCase()] ?? w)
}

export function romanizeDevanagari(text: string): string {
  if (!HAS_DEVANAGARI.test(text)) return text
  const prepped = text
    .normalize('NFC')
    .replace(/[क़-य़]/g, (c) => NUKTA_FALLBACK[c] ?? c)
    .replace(/़/g, '') // stray/decomposed nukta
    .replace(/[।॥]/g, ' ') // danda ।॥ — sentence marks, not lyrics
  const iast = Sanscript.t(prepped, 'devanagari', 'iast')
  const plain = iast
    .replace(/m̐/g, 'n') // candrabindu (m̐)
    .replace(/ṃ/g, 'n') // anusvara (ṃ)
    .replace(/~/g, 'n') // Sanscript's fallback rendering of candrabindu
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // ā ī ū ś ṣ ṇ ṭ ḍ ḥ ṛ … → plain ASCII
    .replace(/\s+/g, ' ')
    .trim()
  return applyHinglishFixes(plain)
}
