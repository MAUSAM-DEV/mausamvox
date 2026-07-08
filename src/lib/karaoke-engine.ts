// UVR MDX-Net KARA_2 karaoke split (lead vs backing vocals) via
// erickluis00/all-in-one-audio. Version + model live here as the single source
// of truth shared by the karaoke-split route and its pre-warm ping (mirrors
// rvc-engine.ts). See PROJECT_STATUS §6 (speed step 2) for the cold-start data.

import Replicate from 'replicate'

// Version hash captured from the live Replicate API; confirm with
// replicate.models.get before shipping if it ever changes.
export const KARAOKE_VERSION = 'f2a8516c9084ef460592deaa397acd4a97f60f18c3d15d273644c72500cdff0e'

// The exact karaoke checkpoint validated in smoke-tests (Hindi + English):
// cleanly separates lead from backing on a vocals-only input.
export const KARAOKE_MODEL = 'UVR_MDXNET_KARA_2.onnx'

// Fire-and-forget pre-warm of the karaoke (UVR) pool — mirrors rvc-engine's
// fireWarmPing. One tiny built-in-audio prediction wakes the shared pool so the
// REAL karaoke-split — which runs right after Demucs lands, ~120-155s later —
// skips the ~19s cold-start queue (measured 2026-07-07). Fired ONCE, at swap
// start (stem-split POST): the Demucs window is exactly the cold-boot runway,
// and unlike the RVC ping there is no later re-ping because karaoke-split runs
// immediately when the stems land (a GET-time ping would race the real job).
// Only the create call is awaited (an un-awaited promise can be frozen with the
// lambda); every failure is swallowed — warming must never block or break the
// caller, change quality, or alter behaviour. ~$0.002/swap.
export async function fireKaraokeWarmPing(origin: string, logTag: string): Promise<void> {
  if (!process.env.REPLICATE_API_TOKEN) return
  try {
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const ping = await replicate.predictions.create({
      version: KARAOKE_VERSION,
      input: {
        music_input: `${origin}/warm-ping.wav`,
        audioSeparator: true,
        audioSeparatorModel: KARAOKE_MODEL,
      },
    })
    console.log(`[${logTag}] karaoke warm-ping fired (${ping.id})`)
  } catch (err) {
    console.warn(`[${logTag}] karaoke warm-ping failed (caller unaffected):`, err instanceof Error ? err.message : String(err))
  }
}
