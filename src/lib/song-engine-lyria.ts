// Google Lyria 3 Pro integration for Song Studio (the 'lyria' engine in
// song-engine.ts). Runs on Replicate (official model `google/lyria-3-pro`),
// so it reuses the route's create + poll flow and REPLICATE_API_TOKEN.
//
// Live schema reviewed 2026-10-03 (latest_version a8d2354e…, created
// 2026-06-19): ONE text input `prompt` (+ optional `images`, `seed`).
// Lyrics, style and structure all go into that prompt. The model page's own
// guidance: put section tags like [Verse] / [Chorus] / [Bridge] on the lyrics,
// "separate lyrics from musical direction for best results", and "influence
// duration by specifying it in your prompt" (no duration input; songs run up
// to ~3 min). Price: $0.08 per output file. Output: MP3 — measured on real
// runs as 44.1 kHz / 192 kbps with true peaks ABOVE 0 dBFS (+0.45 … +0.76
// dBTP), so every song gets a true-peak limiter in the route (no EQ, no
// compression). All output carries Google SynthID watermarking. Prompts can
// be blocked by Google's safety filters.

export const LYRIA_MODEL = 'google/lyria-3-pro'
// Pinned from the model's live latest_version on 2026-10-03.
export const LYRIA_VERSION = 'a8d2354eecd7e455f66655250a72d9284a961a8bedb8c035e9cd758e6d7fbab5'

// Lyria songs run up to about 3 minutes.
export const LYRIA_MAX_SECONDS = 180

// Default sound the founder chose after listening tests (2026-10-02): added
// to every Lyria prompt. The bass words are skipped when the user's own style
// already talks about bass; "clear natural vocals" is skipped for
// instrumentals. No other mix words (they made MiniMax squash the mix).
const DEFAULT_BASS = 'deep warm bass, full low end'
const DEFAULT_VOCALS = 'clear natural vocals'
const BASS_RE = /\b(bass|basses|bassline|bass line|low[- ]end|808s?|sub[- ]?bass)\b/i

// Song Studio teaches lower-case [verse]/[chorus]/[bridge]/[instrumental];
// Lyria's docs use Title Case ([Verse], [Chorus], [Bridge]). Map the common
// ones; any other whole-line [tag] is Title-Cased; lines that merely contain
// brackets are left alone.
const TAG_MAP: Record<string, string> = {
  verse: 'Verse', chorus: 'Chorus', bridge: 'Bridge', intro: 'Intro', outro: 'Outro',
  'pre-chorus': 'Pre-Chorus', 'pre chorus': 'Pre-Chorus', prechorus: 'Pre-Chorus',
  'post-chorus': 'Post-Chorus', hook: 'Hook', interlude: 'Interlude', solo: 'Solo',
  break: 'Break', instrumental: 'Instrumental', inst: 'Instrumental',
}
export function toLyriaLyrics(lyrics: string): string {
  return lyrics
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const m = line.trim().match(/^\[([^\]]{1,40})\]$/)
      if (!m) return line.trimEnd()
      const key = m[1].trim().toLowerCase()
      const mapped = TAG_MAP[key] ?? key.replace(/\b\w/g, (c) => c.toUpperCase())
      return `[${mapped}]`
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface LyriaPromptInput {
  style: string              // user style + voice phrase (from withVocalStyle)
  lyrics: string             // user lyrics (any tag casing); ignored when instrumental
  instrumental: boolean
  targetSeconds?: number | null
}

// Builds the single Lyria prompt: musical direction first (style, voice,
// default sound, optional length request), then a separate "Lyrics:" block.
// Pure function; exported for testing.
export function buildLyriaPrompt(input: LyriaPromptInput): string {
  const parts = [input.style.trim()]
  if (!BASS_RE.test(input.style)) parts.push(DEFAULT_BASS)
  if (!input.instrumental) parts.push(DEFAULT_VOCALS)
  else if (!/\bno vocals\b|\binstrumental\b/i.test(input.style)) parts.push('instrumental only, no vocals')
  let direction = parts.filter(Boolean).join(', ')
  if (input.targetSeconds) {
    const m = Math.floor(input.targetSeconds / 60)
    const s = Math.round(input.targetSeconds % 60)
    direction += `. Create a song about ${m}:${String(s).padStart(2, '0')} long`
  }
  direction = direction.replace(/\.*$/, '.')
  const lyrics = input.instrumental ? '' : toLyriaLyrics(input.lyrics)
  return lyrics ? `${direction}\n\nLyrics:\n${lyrics}` : direction
}

// Lyria's safety filter blocks some prompts. The exact error wording isn't
// documented, so match broadly; anything matching gets the friendly
// "try changing the lyrics or style" message (and the normal refund).
export function isLyriaBlocked(errorText: string): boolean {
  return /safety|blocked|filter|policy|prohibited|not allowed|sensitive|responsible ai|harm|violat|inappropriate|copyright|recitation/i.test(errorText)
}
export const LYRIA_BLOCKED_MSG = 'This song couldn’t be created — try changing the lyrics or style.'

// Rough "will these lyrics fit in ~3 minutes?" check for the UI note. Sung
// pop lines run ~4 s each; >~44 sung lines won't fit. A heuristic only — it
// shows a friendly note, never blocks.
const SECONDS_PER_SUNG_LINE = 4
export function lyriaLyricsLookTooLong(sungLines: number): boolean {
  return sungLines * SECONDS_PER_SUNG_LINE > LYRIA_MAX_SECONDS - 5
}
