// Which RVC engine the voice-convert route runs, plus the version pins shared
// with the pre-warm pings. See PROJECT_STATUS §6 (speed work) for the A/B +
// probe data behind the switch.
//
//   bare  — pseudoram/rvc-v2: RVC conversion only, ~20-40s compute. Default.
//   cover — zsxkib/realistic-voice-cloning (AICoverGen): the old full
//           song-cover pipeline, ~140-220s compute on fresh tracks. Kept as
//           an env-flip rollback: set RVC_ENGINE=cover in Vercel + redeploy.

import Replicate from 'replicate'

export const BARE_RVC_VERSION = 'd18e2e0a6a6d3af183cc09622cebba8555ec9a9e66983261fc64c8b1572b7dce'
export const COVER_RVC_VERSION = '0a9c7c558af4c0f20667c1bd1260ce32a2879944a0b9e44e1398660c077b1550'

// Absent/unset env means 'bare' — no Vercel dashboard step needed to adopt.
export function rvcEngine(): 'bare' | 'cover' {
  return process.env.RVC_ENGINE === 'cover' ? 'cover' : 'bare'
}

// Fire-and-forget pre-warm of the bare-RVC shared pool: one tiny built-in-voice
// prediction (~2-3s compute, ~$0.001) wakes the pool so an upcoming real
// conversion skips the ~2.5-5 min cold boot. The 2026-07-05 acceptance swap
// showed the pool re-chills in UNDER 7 minutes (probes had suggested ~18), so
// callers should ping as close to the real conversion as they can. Only the
// create call is awaited (an un-awaited promise can be frozen with the lambda);
// every failure is swallowed — warming must never break the caller. No-op on
// the cover engine (zsxkib's pool is kept warm by its own traffic).
export async function fireWarmPing(origin: string, logTag: string): Promise<void> {
  if (rvcEngine() !== 'bare') return
  if (!process.env.REPLICATE_API_TOKEN) return
  try {
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const ping = await replicate.predictions.create({
      version: BARE_RVC_VERSION,
      input: { input_audio: `${origin}/warm-ping.wav`, pitch_change: 0, output_format: 'mp3' },
    })
    console.log(`[${logTag}] warm-ping fired (${ping.id})`)
  } catch (err) {
    console.warn(`[${logTag}] warm-ping failed (caller unaffected):`, err instanceof Error ? err.message : String(err))
  }
}
