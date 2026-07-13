// ElevenLabs Music integration for Song Studio (the 'elevenlabs' engine in
// song-engine.ts). Docs consulted 2026-07-13:
//   POST https://api.elevenlabs.io/v1/music?output_format=<fmt>
//   auth: xi-api-key header (ELEVENLABS_API_KEY — never hardcoded)
//   body: { model_id: 'music_v2', composition_plan: { chunks: [...] } }
//   response: the audio BYTES directly (no URL, no polling) — so this engine
//   completes synchronously inside the POST route.
//
// Exact user-written lyrics require a composition plan (`prompt` is free-text
// "describe a song" mode and mutually exclusive with a plan). music_v2 chunk
// text uses the SAME convention Song Studio's lyrics box already teaches:
// [Section Name] labels + newline-separated lines, plus {curly-brace}
// directions — so the mapping below is mostly a split-on-[tags] pass.

// Output format requested from ElevenLabs (query param). Standard mp3.
export const ELEVEN_MUSIC_OUTPUT_FORMAT = 'mp3_44100_192'
export const ELEVEN_MUSIC_MODEL_ID = 'music_v2'
const ELEVEN_MUSIC_URL = 'https://api.elevenlabs.io/v1/music'

// API constraints (from the compose endpoint reference, 2026-07-13):
const CHUNK_MIN_MS = 3000
const CHUNK_MAX_MS = 120000
const MAX_CHUNKS = 30
const MAX_STYLES = 50

// The whole engine call must finish inside the route's 60s lambda budget with
// headroom for the storage upload afterwards; on timeout we abort → the route
// refunds → the user retries. (ElevenLabs typically composes well under this.)
const COMPOSE_TIMEOUT_MS = 45000

export interface ComposeSongInput {
  stylePrompt: string
  lyrics: string
  durationSeconds: number
}

interface PlanChunk {
  text: string
  duration_ms: number
  positive_styles: string[]
}

// Split Song Studio's tagged lyrics ("[verse]\n…\n[chorus]\n…") into music_v2
// chunks. Duration is distributed across sections weighted by line count and
// clamped to the per-chunk API bounds; the style prompt (comma-separated)
// becomes every chunk's positive_styles. A section tagged [instrumental] with
// no lines becomes an {instrumental} direction. Lyrics with no tags at all
// are a single chunk. Exported for reuse/inspection; pure function.
export function buildCompositionPlan(input: ComposeSongInput): { chunks: PlanChunk[] } {
  const styles = input.stylePrompt
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_STYLES)
  if (styles.length === 0) styles.push(input.stylePrompt.trim() || 'song')

  // Parse "[tag]" section markers (whole line) into { tag, lines } sections.
  const sections: { tag: string; lines: string[] }[] = []
  let current: { tag: string; lines: string[] } | null = null
  for (const rawLine of input.lyrics.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const tagMatch = line.match(/^\[([^\]]{1,100})\]$/)
    if (tagMatch) {
      current = { tag: tagMatch[1], lines: [] }
      sections.push(current)
      continue
    }
    if (!current) {
      current = { tag: '', lines: [] }
      sections.push(current)
    }
    current.lines.push(line)
  }
  if (sections.length === 0) sections.push({ tag: '', lines: [] })

  // The API allows at most 30 chunks — fold any overflow into the last one.
  while (sections.length > MAX_CHUNKS) {
    const extra = sections.pop()!
    const last = sections[sections.length - 1]
    if (extra.tag) last.lines.push(`[${extra.tag}]`)
    last.lines.push(...extra.lines)
  }

  // Distribute the requested duration across sections by line count (an
  // instrumental/empty section still gets weight so it exists musically),
  // clamped to the API's per-chunk bounds.
  const totalMs = Math.round(input.durationSeconds * 1000)
  const weights = sections.map((s) => Math.max(1, s.lines.length))
  const weightSum = weights.reduce((a, b) => a + b, 0)

  const chunks: PlanChunk[] = sections.map((s, i) => {
    const isInstrumental = /^instrumental$/i.test(s.tag) && s.lines.length === 0
    const label = s.tag ? `[${s.tag}]` : ''
    const body = isInstrumental ? '{instrumental}' : s.lines.join('\n')
    const text = [label, body].filter(Boolean).join('\n') || '{instrumental}'
    return {
      text,
      duration_ms: Math.min(CHUNK_MAX_MS, Math.max(CHUNK_MIN_MS, Math.round((totalMs * weights[i]) / weightSum))),
      positive_styles: styles,
    }
  })

  return { chunks }
}

// Compose a song and return the mp3 bytes. Throws on any failure (missing
// key, HTTP error, timeout, empty audio) — the route catches, refunds the
// charge, and surfaces the message. Never charges ElevenLabs cost on our
// side beyond the one compose call.
export async function composeSongElevenLabs(input: ComposeSongInput, logTag: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not configured (or set SONG_ENGINE=acestep to use the fallback engine)')

  const plan = buildCompositionPlan(input)
  console.log(`${logTag} elevenlabs compose: ${plan.chunks.length} chunks, ` +
    `${plan.chunks.reduce((a, c) => a + c.duration_ms, 0)}ms planned, model ${ELEVEN_MUSIC_MODEL_ID}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), COMPOSE_TIMEOUT_MS)
  try {
    const res = await fetch(`${ELEVEN_MUSIC_URL}?output_format=${ELEVEN_MUSIC_OUTPUT_FORMAT}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_id: ELEVEN_MUSIC_MODEL_ID,
        composition_plan: plan,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      // 422 returns a JSON detail array; other errors may be text/HTML.
      const bodyText = (await res.text().catch(() => '')).slice(0, 500)
      throw new Error(`ElevenLabs compose failed (http ${res.status}): ${bodyText || 'no body'}`)
    }

    const audio = Buffer.from(await res.arrayBuffer())
    if (audio.length === 0) throw new Error('ElevenLabs returned empty audio')
    console.log(`${logTag} elevenlabs compose done: ${audio.length} bytes`)
    return audio
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`ElevenLabs compose timed out after ${COMPOSE_TIMEOUT_MS / 1000}s`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
