// Shared by /api/voice-convert (swaps) and /api/key-compare (Compare keys):
// which model file a voice converts with, and the exact engine inputs — so a
// key comparison always sounds like the swap it previews.
import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { INDEXED_CREPE_HOP, INDEXED_F0_METHOD, VOICE_SWAP_FILTER_RADIUS, VOICE_SWAP_INDEX_RATE, VOICE_SWAP_PROTECT, VOICE_SWAP_RMS_MIX_RATE, type RvcEngine } from '@/lib/rvc-engine'

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

// Model URL for `voiceId` as `userId` may use it: their own voice, or a voice
// published to the Library. Returns '' when neither has a model.
//
// Prefer the durable Supabase copy (model_path, signed on read) so the voice
// still works after the ephemeral replicate.delivery URL expires. Fall back to
// model_url from DB (older voices not yet persisted).
export async function resolveVoiceModelUrl(voiceId: string, userId: string, origin: string, logTag: string): Promise<string> {
  let { data: clone } = await supabaseAdmin
    .from('voice_clones')
    .select('model_path, model_url')
    .eq('id', voiceId)
    .eq('user_id', userId)
    .maybeSingle()

  if (!clone) {
    // Voice Library: not the caller's own voice — allow it only if its
    // owner published it (free community use, owner consent recorded at
    // publish time). Errors here (incl. a missing published column
    // pre-migration) read as not found, keeping private voices private.
    const { data: pub } = await supabaseAdmin
      .from('voice_clones')
      .select('model_path, model_url')
      .eq('id', voiceId)
      .eq('published', true)
      .maybeSingle()
    clone = pub
    if (pub) console.log(`[${logTag}] using published Library voice`, voiceId)
  }

  if (clone?.model_path) {
    // Route Replicate through our proxy so the model URL never expires
    // (the proxy signs fresh on every fetch) and the last URL segment is a
    // clean, short filename. Both engines need this, for different reasons:
    //
    // cover cog: derives its local filename from url.split('/')[-1] WITHOUT
    // stripping query strings — a signed Supabase URL produces
    // "uuid.zip?token=<JWT>" (300+ chars), hitting Errno 36. The filename
    // also doubles as its MODEL CACHE KEY (it skips the download when the
    // folder exists on a warm instance), so the name must be unique per
    // voice AND per model file — hash of model_path, so a retrain that
    // writes a new path also busts the cache. Never a constant name.
    //
    // bare cog: parses the filename safely (urlparse + query strip) and
    // re-downloads every run (overwrite=True) — no cache-key hazard; the
    // proxy's fresh signing is what it needs.
    const modelTag = createHash('sha1').update(clone.model_path).digest('hex').slice(0, 8)
    console.log(`[${logTag}] using model proxy for`, voiceId, `(cache key ${voiceId}-${modelTag})`)
    return `${origin}/api/voice-model/${voiceId}/${voiceId}-${modelTag}.zip`
  }
  if (clone?.model_url) {
    console.log(`[${logTag}] model_path null, using model_url from DB for`, voiceId)
    return clone.model_url
  }
  return ''
}

// The engine inputs for one conversion. Index strength, consonant guard,
// loudness envelope and smoothing are fixed server-side (VOICE_SWAP_* in
// rvc-engine.ts) — no user controls: none was audible across its full range
// (2026-10-04). `pitchShift` = the client's octave match + Pitch Shift + key
// (rounded, clamped ±24); `autotune` 0…1 (our indexed engine only, sent only when on).
//
// WAV output on all engines so the converted vocal isn't re-compressed.
// bare: pseudoram/rvc-v2 runs ONLY the RVC conversion; pitch is plain
// semitones; mono output. cover: re-separates (legacy rollback) and needs a
// random seed so Replicate can't return a cached prediction for a resubmit.
export function rvcInput(engine: RvcEngine, vocalsUrl: string, modelUrl: string, pitchShift: number, autotune: number): Record<string, unknown> {
  const pitchChangeAll = Math.round(clamp(pitchShift, -24, 24))
  const autotuneAmount = Math.round(clamp(Number(autotune) || 0, 0, 1) * 100) / 100
  const common = {
    index_rate: VOICE_SWAP_INDEX_RATE,
    filter_radius: VOICE_SWAP_FILTER_RADIUS,
    rms_mix_rate: VOICE_SWAP_RMS_MIX_RATE,
    protect: VOICE_SWAP_PROTECT,
    output_format: 'wav',
  }
  if (engine === 'indexed') {
    return {
      // Our engine: the voice's index is really applied and pitch is tracked
      // with crepe (fewer breaks on faint high notes).
      input_audio: vocalsUrl,
      custom_rvc_model_download_url: modelUrl,
      pitch_change: pitchChangeAll,
      f0_method: INDEXED_F0_METHOD,
      crepe_hop_length: INDEXED_CREPE_HOP,
      ...common,
      ...(autotuneAmount > 0 ? { autotune: autotuneAmount } : {}),
    }
  }
  if (engine === 'bare') {
    return { input_audio: vocalsUrl, custom_rvc_model_download_url: modelUrl, pitch_change: pitchChangeAll, f0_method: 'rmvpe', crepe_hop_length: 128, ...common }
  }
  return {
    song_input: vocalsUrl,
    rvc_model: 'CUSTOM',
    custom_rvc_model_download_url: modelUrl,
    pitch_change: 'no-change',
    pitch_change_all: pitchChangeAll,
    pitch_detection_algorithm: 'rmvpe',
    crepe_hop_length: 128,
    ...common,
    seed: Math.floor(Math.random() * 2147483647),
  }
}
