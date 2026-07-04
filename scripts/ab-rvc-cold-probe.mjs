// Cold-start probe for pseudoram/rvc-v2 (speed work — cog-switch blocker).
// STANDALONE — `node scripts/ab-rvc-cold-probe.mjs`. Never imported by app
// code; touches no live routes. Costs four tiny predictions (10s clip,
// built-in voice → no custom-model download, compute is seconds).
//
// Sequence: P1 (pool state as-is) → P2 immediately (does a wake leave the
// pool warm?) → 18 min idle → P3 (does warmth survive idle?) → P4 immediately.
// One stdout line per probe; staged clip deleted at the end.

import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const PSEUDORAM_VERSION = 'd18e2e0a6a6d3af183cc09622cebba8555ec9a9e66983261fc64c8b1572b7dce'
const SRC = path.join(process.cwd(), 'ab-listen', 'source-raw') // vocal from the A/B runs
const IDLE_MIN = 18
const POLL_MS = 5_000
const TIMEOUT_MS = 15 * 60_000

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])
)
const RT = env.REPLICATE_API_TOKEN
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const SK = env.SUPABASE_SERVICE_ROLE_KEY
if (!RT || !SB || !SK) throw new Error('Missing env values')

const sbHeaders = { apikey: SK, Authorization: `Bearer ${SK}` }
const repHeaders = { Authorization: `Bearer ${RT}`, 'Content-Type': 'application/json' }

const clipName = `ab-probe-${Date.now()}.wav`
const clipFile = path.join(process.cwd(), 'ab-listen', clipName)

async function probe(label) {
  const t0 = Date.now()
  const create = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST', headers: repHeaders,
    body: JSON.stringify({
      version: PSEUDORAM_VERSION,
      input: { input_audio: clipUrl, pitch_change: 0, output_format: 'mp3' },
    }),
  })
  if (!create.ok) { console.log(`${label} FAILED create: ${create.status} ${await create.text()}`); return null }
  const { id } = await create.json()
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers: repHeaders })
    const p = await res.json()
    if (p.status === 'succeeded') {
      const t = (s) => Date.parse(s)
      const queue = (t(p.started_at) - t(p.created_at)) / 1000
      const compute = p.metrics?.predict_time ?? (t(p.completed_at) - t(p.started_at)) / 1000
      console.log(`${label} queue=${queue.toFixed(1)}s compute=${compute.toFixed(1)}s (wall=${((Date.now() - t0) / 1000).toFixed(0)}s, id=${id})`)
      return { queue, compute }
    }
    if (p.status === 'failed' || p.status === 'canceled') { console.log(`${label} FAILED: ${p.error ?? p.status}`); return null }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  console.log(`${label} TIMED OUT after ${TIMEOUT_MS / 60000} min`)
  return null
}

// Stage a 10s clip (from 2:30, a sung section) in the bucket and sign it.
execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-ss', '150', '-t', '10', '-i', SRC, '-ac', '1', '-ar', '44100', clipFile])
const up = await fetch(`${SB}/storage/v1/object/audio-uploads/stems/${clipName}`, {
  method: 'POST', headers: { ...sbHeaders, 'Content-Type': 'audio/wav' }, body: readFileSync(clipFile),
})
if (!up.ok) throw new Error(`clip upload failed: ${up.status} ${await up.text()}`)
const signRes = await fetch(`${SB}/storage/v1/object/sign/audio-uploads/stems/${clipName}`, {
  method: 'POST', headers: { ...sbHeaders, 'Content-Type': 'application/json' },
  body: JSON.stringify({ expiresIn: 7200 }),
})
const { signedURL } = await signRes.json()
const clipUrl = `${SB}/storage/v1${signedURL}`
console.log(`staged probe clip stems/${clipName}`)

let code = 0
try {
  await probe('PROBE-1 (pool as-is)')
  await probe('PROBE-2 (immediately after P1)')
  console.log(`idling ${IDLE_MIN} min before PROBE-3…`)
  await new Promise((r) => setTimeout(r, IDLE_MIN * 60_000))
  await probe(`PROBE-3 (after ${IDLE_MIN} min idle)`)
  await probe('PROBE-4 (immediately after P3)')
} catch (err) {
  code = 1
  console.log(`PROBE RUN ERROR: ${err}`)
} finally {
  const del = await fetch(`${SB}/storage/v1/object/audio-uploads/stems/${clipName}`, { method: 'DELETE', headers: sbHeaders })
  console.log(del.ok ? `cleanup: deleted stems/${clipName}` : `cleanup FAILED: ${del.status}`)
  console.log('PROBES COMPLETE')
}
process.exit(code)
