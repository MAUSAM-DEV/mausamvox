// MiniMax Music 2.5 integration for Song Studio (the 'minimax' engine in
// song-engine.ts). Runs on Replicate (official model `minimax/music-2.5`), so
// it reuses the route's existing create + poll flow and REPLICATE_API_TOKEN —
// no new key.
//
// Live input schema reviewed 2026-10-02 (latest_version f2100977…, created
// 2026-04-09):
//   lyrics       string, REQUIRED, 1–3500 chars. "\n" separates lines.
//                Structure tags: [Intro] [Verse] [Pre Chorus] [Chorus]
//                [Interlude] [Bridge] [Outro] [Post Chorus] [Transition]
//                [Break] [Hook] [Build Up] [Inst] [Solo]
//   prompt       string, 0–2000 chars — style, mood, scenario
//   sample_rate  enum 16000 | 24000 | 32000 | 44100   (default 44100)
//   bitrate      enum 32000 | 64000 | 128000 | 256000 (default 256000)
//   audio_format enum mp3 | wav | pcm                  (default mp3)
// Output: a single audio file URI. NO duration input — song length follows
// the lyrics, which the UI states honestly instead of showing a duration
// control that does nothing.

export const MINIMAX_MODEL = 'minimax/music-2.5'
// Pinned from the model's live latest_version on 2026-10-02.
export const MINIMAX_VERSION = 'f2100977b6ce90322ab00443b76d48f079435c1d903c4805517f89d2b8cc9c5a'

export const MINIMAX_MAX_LYRICS_CHARS = 3500
export const MINIMAX_MAX_PROMPT_CHARS = 2000

// Lyrics MiniMax receives when the user wrote none — an instrumental piece
// instead of a validation failure (lyrics are required by the API).
const INSTRUMENTAL_LYRICS = '[Inst]'

// Song Studio teaches lower-case [verse]/[chorus]/[bridge]/[instrumental];
// MiniMax documents Title Case tags and calls instrumental sections [Inst].
// Unknown tags pass through untouched (MiniMax treats them as text cues).
const TAG_MAP: Record<string, string> = {
  verse: 'Verse',
  chorus: 'Chorus',
  bridge: 'Bridge',
  instrumental: 'Inst',
  inst: 'Inst',
  intro: 'Intro',
  outro: 'Outro',
  'pre-chorus': 'Pre Chorus',
  'pre chorus': 'Pre Chorus',
  prechorus: 'Pre Chorus',
  'post-chorus': 'Post Chorus',
  'post chorus': 'Post Chorus',
  hook: 'Hook',
  interlude: 'Interlude',
  solo: 'Solo',
  break: 'Break',
  'build up': 'Build Up',
  'build-up': 'Build Up',
  transition: 'Transition',
}

// Map our section tags onto MiniMax's. Only a whole-line "[tag]" is treated
// as a section marker (lyrics that merely contain brackets are left alone).
// Empty input → an instrumental. Pure function; exported for testing.
export function toMiniMaxLyrics(lyrics: string): string {
  const mapped = lyrics
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => {
      const m = line.trim().match(/^\[([^\]]{1,40})\]$/)
      if (!m) return line.trimEnd()
      const canonical = TAG_MAP[m[1].trim().toLowerCase()]
      return canonical ? `[${canonical}]` : line.trim()
    })
    .join('\n')
    .trim()
  return mapped || INSTRUMENTAL_LYRICS
}

export function buildMiniMaxInput(lyrics: string, prompt: string) {
  return {
    lyrics: toMiniMaxLyrics(lyrics),
    prompt: prompt.slice(0, MINIMAX_MAX_PROMPT_CHARS),
    sample_rate: 44100,
    bitrate: 256000,
    audio_format: 'mp3',
  }
}
