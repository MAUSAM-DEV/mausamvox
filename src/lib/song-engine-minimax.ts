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

// ── Target length (MiniMax has no duration input) ───────────────────────────
// We can only ASK for a length: through the song's structure (instrumental
// sections) and the style prompt. Overshoot is trimmed after generation (see
// /api/song-studio GET); the audio is NEVER stretched or slowed to fake length.
//
// Natural-length estimate, fitted to two real runs (2026-10-02):
//   4 sung lines → 74.6 s,  27 sung lines → 131.1 s
//   ⇒ ≈ 65 s + 2.5 s per sung line. Rough (two points) — retune from the
//   `[song-studio] length:` log lines.
// ⚠️ Padding test (2026-10-02, prediction 66vhpja4…): 4 sung lines + added
// [Intro]/[Inst]/[Outro] + "approximately 2:00 long" → 60.1 s. Asking did
// NOT lengthen the song (the unpadded 4-line run gave 74.6 s). So a target
// reliably works only as a CEILING (overshoot is trimmed); the UI says so
// and warns when lyrics look short. Revisit if MiniMax adds a duration input.
const EST_BASE_SECONDS = 65
const EST_SECONDS_PER_LINE = 2.5
// Gap (target − estimate) thresholds for adding instrumental sections.
const GAP_FOR_INTRO_OUTRO = 10
const GAP_FOR_INST = 35
const GAP_FOR_SOLO = 60

export function estimateMiniMaxSeconds(sungLines: number): number {
  return EST_BASE_SECONDS + EST_SECONDS_PER_LINE * sungLines
}

const isTag = (l: string, name?: string) => {
  const m = l.trim().match(/^\[([^\]]+)\]$/)
  return !!m && (name === undefined || m[1].toLowerCase() === name.toLowerCase())
}

export interface MiniMaxLengthPlan {
  lyrics: string          // MiniMax-tagged lyrics, possibly with added sections
  promptSuffix: string    // e.g. "approximately 2:00 long"
  estimatedSeconds: number
  addedSections: string[]
}

// Pure function; exported for testing. `lyrics` must already be mapped by
// toMiniMaxLyrics (Title Case tags).
export function planMiniMaxLength(lyrics: string, targetSeconds: number): MiniMaxLengthPlan {
  const mm = Math.floor(targetSeconds / 60)
  const ss = String(Math.round(targetSeconds % 60)).padStart(2, '0')
  const promptSuffix = `approximately ${mm}:${ss} long`

  const lines = lyrics.split('\n')
  const sung = lines.filter((l) => l.trim() && !isTag(l)).length
  const estimatedSeconds = estimateMiniMaxSeconds(sung)
  const gap = targetSeconds - estimatedSeconds
  const added: string[] = []

  // Pure instrumental ([Inst] only): the prompt carries the length request.
  if (sung === 0 || gap <= GAP_FOR_INTRO_OUTRO) {
    return { lyrics, promptSuffix, estimatedSeconds, addedSections: added }
  }

  const out = [...lines]
  if (!isTag(out[0] ?? '', 'Intro')) { out.unshift('[Intro]'); added.push('Intro') }

  if (gap > GAP_FOR_INST) {
    // After the first chorus block (before the next section tag), else mid-song.
    const firstChorus = out.findIndex((l) => isTag(l, 'Chorus'))
    let at = -1
    if (firstChorus >= 0) {
      at = out.findIndex((l, i) => i > firstChorus && isTag(l))
      if (at < 0) at = out.length
    } else {
      at = Math.max(1, Math.floor(out.length / 2))
    }
    out.splice(at, 0, '[Inst]')
    added.push('Inst')
  }

  if (gap > GAP_FOR_SOLO) {
    // Before the last chorus, else before an existing outro, else at the end.
    let lastChorus = -1
    out.forEach((l, i) => { if (isTag(l, 'Chorus')) lastChorus = i })
    const outroAt = out.findIndex((l) => isTag(l, 'Outro'))
    const at = lastChorus > 0 ? lastChorus : outroAt >= 0 ? outroAt : out.length
    out.splice(at, 0, '[Solo]')
    added.push('Solo')
  }

  if (!out.some((l) => isTag(l, 'Outro'))) { out.push('[Outro]'); added.push('Outro') }

  const planned = out.join('\n')
  // Never exceed the API's lyrics cap just to pad length.
  if (planned.length > MINIMAX_MAX_LYRICS_CHARS) {
    return { lyrics, promptSuffix, estimatedSeconds, addedSections: [] }
  }
  return { lyrics: planned, promptSuffix, estimatedSeconds, addedSections: added }
}

export function buildMiniMaxInput(lyrics: string, prompt: string, targetSeconds?: number | null) {
  let mapped = toMiniMaxLyrics(lyrics)
  let fullPrompt = prompt
  if (targetSeconds) {
    const plan = planMiniMaxLength(mapped, targetSeconds)
    mapped = plan.lyrics
    fullPrompt = [prompt, plan.promptSuffix].filter(Boolean).join(', ')
  }
  return {
    lyrics: mapped,
    prompt: fullPrompt.slice(0, MINIMAX_MAX_PROMPT_CHARS),
    sample_rate: 44100,
    bitrate: 256000,
    audio_format: 'mp3',
  }
}
