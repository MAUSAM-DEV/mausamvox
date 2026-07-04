// Three-arm offline A/B for the voice-swap speed work (PROJECT_STATUS §6).
// STANDALONE — run with `node scripts/ab-rvc-speed.mjs`. Never imported by app
// code; touches no live routes. Costs three Replicate predictions per run.
//
//   Arm A: current cog (zsxkib/realistic-voice-cloning), exact production params
//   Arm B: same cog, reverb explicitly zeroed, all else identical to A
//   Arm C: bare-RVC cog (pseudoram/rvc-v2), matched params
//
// Input: the most recent lead-vocal stem, remuxed via ffmpeg with a unique
// metadata comment so its content hash changes — guaranteeing arm A pays the
// cog's full MDX preprocessing (it caches per song hash) — then re-uploaded to
// the audio-uploads bucket under stems/ab-fresh-* and signed like production.
// Output: ab-listen/arm{A,B,C}-*.wav + one TIMING line per arm.

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

// ── Config ────────────────────────────────────────────────────────────────
const STEM_PATH = 'stems/gpj19fd1ysrmr0cz54br8r1rr0-lead.mp3' // most recent lead (2026-07-03 swap)
const VOICE_ID = '6ec163c9-0c1e-4845-b096-93e7c8133b22' // "MK"
const MODEL_URL = `https://mausamvox.vercel.app/api/voice-model/${VOICE_ID}/${VOICE_ID}-d4fd0ac9.zip`
const ZSXKIB_VERSION = '0a9c7c558af4c0f20667c1bd1260ce32a2879944a0b9e44e1398660c077b1550'
const PSEUDORAM_VERSION = 'd18e2e0a6a6d3af183cc09622cebba8555ec9a9e66983261fc64c8b1572b7dce'
const OUT_DIR = path.join(process.cwd(), 'ab-listen')
const POLL_MS = 15_000
const TIMEOUT_MS = 30 * 60_000

// Production defaults from src/app/api/voice-convert/route.ts (styleIntensity 8
// → index_rate 0.8; protect 0.2; filter_radius 4; rms_mix_rate 0.25; rmvpe).
const PROD = { indexRate: 0.8, protect: 0.2, filterRadius: 4, rmsMixRate: 0.25 }

// ── Env (.env.local, parsed directly — no app imports) ───────────────────
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

// 1. Fetch the source vocal and bust its content hash (metadata-only remux; the
//    audio bitstream is copied untouched) so the cog can't reuse cached MDX passes.
console.log('1/4 Fetching + hash-busting source vocal…')
const srcUrl = await signStem(STEM_PATH)
const rawFile = path.join(OUT_DIR, 'source-raw')
await download(srcUrl, rawFile)
const fmt = execFileSync('ffprobe', ['-v', 'quiet', '-show_entries', 'format=format_name', '-of', 'csv=p=0', rawFile])
  .toString().trim().split(',')[0]
const ext = fmt.includes('wav') ? 'wav' : 'mp3'
const freshName = `ab-fresh-${Date.now()}-lead.${ext}`
const freshFile = path.join(OUT_DIR, freshName)
execFileSync('ffmpeg', ['-v', 'quiet', '-i', rawFile, '-c', 'copy', '-metadata', `comment=ab-${Date.now()}`, freshFile])

// 2. Stage it in the audio-uploads bucket (stems/ prefix, like production) and sign.
console.log('2/4 Uploading hash-busted vocal to storage…')
const upRes = await fetch(`${SB}/storage/v1/object/audio-uploads/stems/${freshName}`, {
  method: 'POST', headers: { ...sbHeaders, 'Content-Type': ext === 'wav' ? 'audio/wav' : 'audio/mpeg' },
  body: readFileSync(freshFile),
})
if (!upRes.ok) throw new Error(`stem upload failed: ${upRes.status} ${await upRes.text()}`)
const vocalUrl = await signStem(`stems/${freshName}`)
console.log(`  staged as stems/${freshName}`)

// 3. Launch the three arms in parallel.
console.log('3/4 Launching predictions…')
const armAInput = {
  song_input: vocalUrl,
  rvc_model: 'CUSTOM',
  custom_rvc_model_download_url: MODEL_URL,
  pitch_change: 'no-change',
  pitch_change_all: 0,
  index_rate: PROD.indexRate,
  filter_radius: PROD.filterRadius,
  rms_mix_rate: PROD.rmsMixRate,
  pitch_detection_algorithm: 'rmvpe',
  crepe_hop_length: 128,
  protect: PROD.protect,
  output_format: 'wav',
  seed: Math.floor(Math.random() * 2147483647),
}
const armBInput = { ...armAInput, seed: Math.floor(Math.random() * 2147483647), reverb_size: 0, reverb_wetness: 0, reverb_dryness: 1 }
const armCInput = {
  input_audio: vocalUrl,
  custom_rvc_model_download_url: MODEL_URL,
  pitch_change: 0,
  index_rate: PROD.indexRate,
  filter_radius: PROD.filterRadius,
  rms_mix_rate: PROD.rmsMixRate,
  protect: PROD.protect,
  f0_method: 'rmvpe',
  output_format: 'wav',
}
const [pA, pB, pC] = await Promise.all([
  createPrediction(ZSXKIB_VERSION, armAInput),
  createPrediction(ZSXKIB_VERSION, armBInput),
  createPrediction(PSEUDORAM_VERSION, armCInput),
])
console.log(`  A=${pA.id}  B=${pB.id}  C=${pC.id}`)

const [dA, dB, dC] = await Promise.all([
  waitForPrediction(pA.id, 'armA'),
  waitForPrediction(pB.id, 'armB'),
  waitForPrediction(pC.id, 'armC'),
])

// 4. Timing + outputs.
console.log('4/4 Results:')
for (const [label, p] of [['armA zsxkib-defaults', dA], ['armB zsxkib-reverb-zero', dB], ['armC pseudoram-bare', dC]]) {
  const t = timing(p)
  console.log(`  ${label} TIMING queue=${fmtSec(t.queue)} compute=${fmtSec(t.compute)} total=${fmtSec(t.total)}`)
}
await download(outputUrl(dA.output), path.join(OUT_DIR, 'armA-zsxkib-defaults.wav'))
await download(outputUrl(dB.output), path.join(OUT_DIR, 'armB-zsxkib-reverb-zero.wav'))
await download(outputUrl(dC.output), path.join(OUT_DIR, 'armC-pseudoram-bare.wav'))
console.log(`\nDone. Listen in: ${OUT_DIR}`)
console.log(`Cleanup note: test object stems/${freshName} was left in the audio-uploads bucket.`)
