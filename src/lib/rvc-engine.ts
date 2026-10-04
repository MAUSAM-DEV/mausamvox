// Which RVC engine the voice-convert route runs, plus the version pins shared
// with the pre-warm pings. See PROJECT_STATUS (2026-10-03/04 voice tests).
//
//   indexed — mausam-dev/rvc-v2-index (our MIT copy of pseudoram/rvc-v2,
//             repo MAUSAM-DEV/mausamvox-models): actually USES the voice's
//             FAISS index (so Style Intensity works), crepe pitch tracking
//             (fewer voice breaks on faint high notes), per-request voice
//             models deleted after every run. DEFAULT.
//   bare    — pseudoram/rvc-v2: the previous default (ignores the index,
//             rmvpe). Instant rollback: RVC_ENGINE=bare in Vercel + redeploy.
//   cover   — zsxkib/realistic-voice-cloning (AICoverGen): the old full
//             song-cover pipeline. RVC_ENGINE=cover.

import Replicate from 'replicate'

export const BARE_RVC_VERSION = 'd18e2e0a6a6d3af183cc09622cebba8555ec9a9e66983261fc64c8b1572b7dce'
export const COVER_RVC_VERSION = '0a9c7c558af4c0f20667c1bd1260ce32a2879944a0b9e44e1398660c077b1550'
// mausam-dev/rvc-v2-index, version with the per-request rmvpe_threshold input
// (2026-10-04). Public model: billed only while working; predictions stay private.
export const INDEXED_RVC_VERSION = '35029e837dfbd4e043786f7fcf57ec7656897a9ca03f6cd9cf8bf1147983934b'
// Pitch tracker for the indexed engine. crepe vs rmvpe on a solo test song:
// words 85% vs 79%, voice dropouts 17.9 vs 33.5 per minute (2026-10-04);
// ~3x the compute (~60 s vs ~20 s for a 2:15 song on T4, ≈ +$0.01).
export const INDEXED_F0_METHOD = 'mangio-crepe'
export const INDEXED_CREPE_HOP = 64

export type RvcEngine = 'indexed' | 'bare' | 'cover'

// Absent/unset env means 'indexed'. 'bare' / 'cover' are rollbacks.
export function rvcEngine(): RvcEngine {
  const v = (process.env.RVC_ENGINE ?? '').trim().toLowerCase()
  return v === 'cover' ? 'cover' : v === 'bare' ? 'bare' : 'indexed'
}

export function rvcVersion(engine: RvcEngine = rvcEngine()): string {
  return engine === 'indexed' ? INDEXED_RVC_VERSION : engine === 'bare' ? BARE_RVC_VERSION : COVER_RVC_VERSION
}

// Fire-and-forget pre-warm of the RVC pool (indexed: our own model's pool —
// it only gets our traffic, so cold boots of 2-4.5 min were seen; bare: the
// shared pseudoram pool): one tiny built-in-voice
// prediction (~2-3s compute, ~$0.001) wakes the pool so an upcoming real
// conversion skips the ~2.5-5 min cold boot. The 2026-07-05 acceptance swap
// showed the pool re-chills in UNDER 7 minutes (probes had suggested ~18), so
// callers should ping as close to the real conversion as they can. Only the
// create call is awaited (an un-awaited promise can be frozen with the lambda);
// every failure is swallowed — warming must never break the caller. No-op on
// the cover engine (zsxkib's pool is kept warm by its own traffic).
export async function fireWarmPing(origin: string, logTag: string): Promise<void> {
  const engine = rvcEngine()
  if (engine === 'cover') return
  if (!process.env.REPLICATE_API_TOKEN) return
  try {
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const ping = await replicate.predictions.create(
      engine === 'indexed'
        // warm_only boots the instance and returns the input untouched.
        ? { version: INDEXED_RVC_VERSION, input: { input_audio: `${origin}/warm-ping.wav`, warm_only: true } }
        : { version: BARE_RVC_VERSION, input: { input_audio: `${origin}/warm-ping.wav`, pitch_change: 0, output_format: 'mp3' } },
    )
    console.log(`[${logTag}] warm-ping fired (${ping.id})`)
  } catch (err) {
    console.warn(`[${logTag}] warm-ping failed (caller unaffected):`, err instanceof Error ? err.message : String(err))
  }
}
