// Arm C param re-runs for the voice-swap speed work (PROJECT_STATUS §6) —
// follow-up to scripts/ab-rvc-speed.mjs after the 2:31–2:33 mispronunciation
// finding. STANDALONE — `node scripts/ab-rvc-c-variants.mjs`. Never imported by
// app code; touches no live routes. Costs two Replicate predictions.
//
//   C2: pseudoram/rvc-v2, protect 0.35 (was 0.2), all else matched to arm C
//   C3: pseudoram/rvc-v2, protect 0.35 + index_rate 0.65 (was 0.8)
//
// Same source vocal + staging as the three-arm run (hash-busted lead stem,
// re-uploaded + signed); the staged test object is DELETED on completion.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const STEM_PATH = 'stems/gpj19fd1ysrmr0cz54br8r1rr0-lead.mp3' // same lead as the A/B run
const VOICE_ID = '6ec163c9-0c1e-4845-b096-93e7c8133b22' // "MK"
const MODEL_URL = `https://mausamvox.vercel.app/api/voice-model/${VOICE_ID}/${VOICE_ID}-d4fd0ac9.zip`
const PSEUDORAM_VERSION = 'd18e2e0a6a6d3af183cc09622cebba8555ec9a9e66983261fc64c8b1572b7dce'
const OUT_DIR = path.join(process.cwd(), 'ab-listen')
const POLL_MS = 15_000
const TIMEOUT_MS = 30 * 60_000

// Matched-to-production base (see armC in ab-rvc-speed.mjs), minus the knobs
// each variant overrides.
const BASE = {
  custom_rvc_model_download_url: MODEL_URL,
  pitch_change: 0,
  filter_radius: 4,
  rms_mix_rate: 0.25,
  f0_method: 'rmvpe',
  output_format: 'wav',
}
const VARIANTS = [
  { label: 'armC2-protect035', input: { ...BASE, index_rate: 0.8, protect: 0.35 } },
  { label: 'armC3-protect035-index065', input: { ...BASE, index_rate: 0.65, protect: 0.35 } },
]

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])
)
const RT = env.REPLICATE_API_TOKEN
const SB = env.NEXT_PUBLIC_SUPABASE_URL
const SK = env.SUPABASE_SERVICE_ROLE_KEY
if (!RT || !SB || !SK) throw new Error('Missing REPLICATE_API_TOKEN / SUPABASE url / service key in .env.local')

const sbHeaders = { apikey: SK, Authorization: `Bearer ${SK}` }
const repHeaders = { Authorization: `Bearer ${RT}`, 'Content-Type': 'application/json' }

async function signStem(objectPath, expiresIn = 21_600) {
  const res = await fetch(`${SB}/storage/v1/object/sign/audio-uploads/${objectPath}`, {
    method: 'POST', headers: { ...sbHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn }),
  })
  if (!res.ok) throw new Error(`sign ${objectPath} failed: ${res.status} ${await res.text()}`)
  const { signedURL } = await res.json()
  return `${SB}/storage/v1${signedURL}`
}

function fmtSec(n) { return n == null ? 'n/a' : `${n.toFixed(1)}s` }

async function createPrediction(version, input) {
  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST', headers: repHeaders, body: JSON.stringify({ version, input }),
  })
  if (!res.ok) throw new Error(`prediction create failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function waitForPrediction(id, label) {
  const deadline = Date.now() + TIMEOUT_MS
  let last = ''
  while (Date.now() < deadline) {
    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers: repHeaders })
    if (!res.ok) throw new Error(`poll ${id} failed: ${res.status}`)
    const p = await res.json()
    if (p.status !== last) { console.log(`  [${label}] ${p.status}`); last = p.status }
    if (p.status === 'succeeded') return p
    if (p.status === 'failed' || p.status === 'canceled') {
      throw new Error(`[${label}] ${p.status}: ${p.error ?? 'no error message'}`)
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  throw new Error(`[${label}] timed out after ${TIMEOUT_MS / 60000} min`)
}

function timing(p) {
  const t = (s) => (s ? Date.parse(s) : NaN)
  const queue = (t(p.started_at) - t(p.created_at)) / 1000
  const compute = p.metrics?.predict_time ?? (t(p.completed_at) - t(p.started_at)) / 1000
  const total = (t(p.completed_at) - t(p.created_at)) / 1000
  return { queue: Number.isFinite(queue) ? queue : null, compute, total: Number.isFinite(total) ? total : null }
}

function outputUrl(output) {
  if (typeof output === 'string') return output
  if (Array.isArray(output) && typeof output[0] === 'string') return output[0]
  throw new Error(`unexpected output shape: ${JSON.stringify(output).slice(0, 200)}`)
}

async function download(url, file) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: ${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  console.log(`  saved ${file}`)
}

// ── Main ──────────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true })

console.log('1/3 Fetching + hash-busting source vocal…')
const srcUrl = await signStem(STEM_PATH)
const rawFile = path.join(OUT_DIR, 'source-raw')
await download(srcUrl, rawFile)
const fmt = execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=format_name', '-of', 'csv=p=0', rawFile])
  .toString().trim().split(',')[0]
const ext = fmt.includes('wav') ? 'wav' : 'mp3'
const freshName = `ab-fresh-${Date.now()}-lead.${ext}`
const freshFile = path.join(OUT_DIR, freshName)
execFileSync('ffmpeg', ['-v', 'quiet', '-i', rawFile, '-c', 'copy', '-metadata', `comment=ab-${Date.now()}`, freshFile])

const upRes = await fetch(`${SB}/storage/v1/object/audio-uploads/stems/${freshName}`, {
  method: 'POST', headers: { ...sbHeaders, 'Content-Type': ext === 'wav' ? 'audio/wav' : 'audio/mpeg' },
  body: readFileSync(freshFile),
})
if (!upRes.ok) throw new Error(`stem upload failed: ${upRes.status} ${await upRes.text()}`)
const vocalUrl = await signStem(`stems/${freshName}`)
console.log(`  staged as stems/${freshName}`)

let exitCode = 0
try {
  console.log('2/3 Launching variant predictions…')
  const created = await Promise.all(
    VARIANTS.map((v) => createPrediction(PSEUDORAM_VERSION, { ...v.input, input_audio: vocalUrl }))
  )
  console.log(`  ${VARIANTS.map((v, i) => `${v.label}=${created[i].id}`).join('  ')}`)

  const done = await Promise.all(created.map((p, i) => waitForPrediction(p.id, VARIANTS[i].label)))

  console.log('3/3 Results:')
  for (let i = 0; i < done.length; i++) {
    const t = timing(done[i])
    console.log(`  ${VARIANTS[i].label} TIMING queue=${fmtSec(t.queue)} compute=${fmtSec(t.compute)} total=${fmtSec(t.total)}`)
  }
  for (let i = 0; i < done.length; i++) {
    await download(outputUrl(done[i].output), path.join(OUT_DIR, `${VARIANTS[i].label}.wav`))
  }
  console.log(`\nDone. Listen in: ${OUT_DIR}`)
} catch (err) {
  exitCode = 1
  console.error(String(err))
} finally {
  // Always remove the staged test object — even on failure.
  const del = await fetch(`${SB}/storage/v1/object/audio-uploads/stems/${freshName}`, {
    method: 'DELETE', headers: sbHeaders,
  })
  console.log(del.ok ? `Cleanup: deleted stems/${freshName}` : `Cleanup FAILED for stems/${freshName}: ${del.status}`)
}
process.exit(exitCode)
