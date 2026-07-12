// Feasibility spike: voice → instrument (Instruments feature), 2026-07-12.
// STANDALONE — never imported by app code (ab-* scripts precedent).
//
// Pipeline proven here, all in plain Node (Vercel-function-compatible):
//   monophonic audio → @spotify/basic-pitch (TensorFlow.js, CPU backend)
//   → note events → MIDI (@tonejs/midi) → js-synthesizer (libfluidsynth
//   2.4.6 compiled to WASM — the "static FluidSynth binary" equivalent,
//   no native binary needed) + a GM soundfont → instrument audio.
//
// Measured on the 2026-07-12 run (Apple Silicon, Node 26):
//   * basic-pitch accepts a raw Float32Array (22050 Hz mono) — no browser
//     AudioBuffer needed; model ships IN the npm package (1.9 MB).
//   * Transcription of a synthesized C4-E4-G4-E4-C4 melody: exact
//     (midi 60/64/67/64/60, correct onsets/durations).
//   * Loaded-runtime footprint: 6.8 MB of JS across 20 files (the 295 MB
//     node_modules install is dist-format/sourcemap bloat, not runtime);
//     tfjs import 62 ms, model load <10 ms.
//   * Inference: 4.2 s for 3.2 s of audio (~1.3× realtime) on the pure-JS
//     CPU backend — THE constraint; see PROJECT_STATUS §6 for mitigations
//     (tfjs wasm backend / input cap).
//   * MIDI→audio via WASM FluidSynth + TimGM6mb.sf2 (5.9 MB GM soundfont,
//     the one bundled in pretty_midi): 77 ms for a 7 s render. Round-trip
//     re-transcription of the rendered piano recovered the same melody.
//
// Deps are NOT in package.json (spike-only). To run:
//   npm install --no-save @spotify/basic-pitch @tensorflow/tfjs js-synthesizer
//   curl -sLo /tmp/TimGM6mb.sf2 https://github.com/craffel/pretty-midi/raw/main/pretty_midi/TimGM6mb.sf2
//   node scripts/spike-voice-to-instrument.mjs <input.wav> /tmp/TimGM6mb.sf2 <output.wav> [gm-program]
// gm-program: General MIDI program number (default 0 = acoustic grand piano;
// 40 = violin, 73 = flute).
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const [inWav, sf2Path, outWav, programArg] = process.argv.slice(2)
if (!inWav || !sf2Path || !outWav) {
  console.error('usage: node scripts/spike-voice-to-instrument.mjs <input.wav> <soundfont.sf2> <output.wav> [gm-program]')
  process.exit(1)
}
const program = Number(programArg ?? 0)
const ffmpeg = require('ffmpeg-static')
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'spike-v2i-'))

// ── 1. Decode input to 22050 Hz mono float32 (basic-pitch's expected rate) ──
const f32Path = path.join(tmp, 'in.f32')
execFileSync(ffmpeg, ['-v', 'error', '-y', '-i', inWav, '-f', 'f32le', '-ar', '22050', '-ac', '1', f32Path])
const raw = fs.readFileSync(f32Path)
const audio = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
console.log(`input: ${(audio.length / 22050).toFixed(1)}s of audio`)

// ── 2. Audio → notes (basic-pitch on the tfjs CPU backend) ──────────────────
const tf = require('@tensorflow/tfjs')
const { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } = require('@spotify/basic-pitch')
const MODEL_DIR = path.dirname(require.resolve('@spotify/basic-pitch/model/model.json'))

// The browser-oriented tfjs loads models via fetch; hand it the files directly.
const fileIOHandler = {
  load: async () => {
    const modelJSON = JSON.parse(fs.readFileSync(path.join(MODEL_DIR, 'model.json'), 'utf8'))
    return {
      modelTopology: modelJSON.modelTopology,
      format: modelJSON.format,
      generatedBy: modelJSON.generatedBy,
      convertedBy: modelJSON.convertedBy,
      weightSpecs: modelJSON.weightsManifest.flatMap((g) => g.weights),
      weightData: new Uint8Array(Buffer.concat(
        modelJSON.weightsManifest.flatMap((g) => g.paths.map((p) => fs.readFileSync(path.join(MODEL_DIR, p))))
      )).buffer,
    }
  },
}

const t0 = Date.now()
const basicPitch = new BasicPitch(tf.loadGraphModel(fileIOHandler))
const frames = [], onsets = [], contours = []
await basicPitch.evaluateModel(audio, (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c) }, () => {})
const notes = noteFramesToTime(addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)))
console.log(`transcribed ${notes.length} notes in ${Date.now() - t0}ms:`)
for (const n of notes) console.log(`  midi=${n.pitchMidi} t=${n.startTimeSeconds.toFixed(2)}s d=${n.durationSeconds.toFixed(2)}s amp=${n.amplitude.toFixed(2)}`)
if (notes.length === 0) { console.error('no notes detected — is the input monophonic and pitched?'); process.exit(1) }

// ── 3. Notes → MIDI ──────────────────────────────────────────────────────────
const { Midi } = require('@tonejs/midi')
const midi = new Midi()
const track = midi.addTrack()
track.instrument.number = program
for (const n of notes) {
  track.addNote({ midi: n.pitchMidi, time: n.startTimeSeconds, duration: n.durationSeconds, velocity: Math.min(1, n.amplitude) })
}
const midBytes = Buffer.from(midi.toArray())

// ── 4. MIDI → instrument audio (libfluidsynth WASM + GM soundfont) ──────────
const libfluid = require('js-synthesizer/externals/libfluidsynth-2.4.6.js')
if (typeof globalThis.Module === 'undefined') globalThis.Module = libfluid
const JSSynth = require('js-synthesizer')
await JSSynth.waitForReady()

const SR = 44100
const synth = new JSSynth.Synthesizer()
synth.init(SR)
const sf2 = fs.readFileSync(sf2Path)
await synth.loadSFont(sf2.buffer.slice(sf2.byteOffset, sf2.byteOffset + sf2.byteLength))
await synth.addSMFDataToPlayer(midBytes.buffer.slice(midBytes.byteOffset, midBytes.byteOffset + midBytes.byteLength))
await synth.playPlayer()

const tRender = Date.now()
const CHUNK = 8192
const chunks = []
let renderedFrames = 0
const maxFrames = SR * Math.ceil(audio.length / 22050 + 3)
while (synth.isPlayerPlaying() && renderedFrames < maxFrames) {
  const l = new Float32Array(CHUNK), r = new Float32Array(CHUNK)
  synth.render([l, r])
  chunks.push([l, r]); renderedFrames += CHUNK
}
for (let i = 0; i < Math.ceil(SR / CHUNK); i++) { // 1s release tail
  const l = new Float32Array(CHUNK), r = new Float32Array(CHUNK)
  synth.render([l, r])
  chunks.push([l, r]); renderedFrames += CHUNK
}
synth.close()
console.log(`rendered ${(renderedFrames / SR).toFixed(1)}s in ${Date.now() - tRender}ms`)

const out = new Float32Array(renderedFrames * 2)
let o = 0
for (const [l, r] of chunks) for (let i = 0; i < l.length; i++) { out[o++] = l[i]; out[o++] = r[i] }
const outF32 = path.join(tmp, 'out.f32')
fs.writeFileSync(outF32, Buffer.from(out.buffer))
execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', outF32, '-af', 'volume=12dB,alimiter=limit=0.891', '-c:a', 'pcm_s16le', outWav])
fs.rmSync(tmp, { recursive: true, force: true })
console.log(`wrote ${outWav} (GM program ${program})`)
