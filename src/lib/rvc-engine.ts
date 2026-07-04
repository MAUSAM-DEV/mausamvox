// Which RVC engine the voice-convert route runs, plus the version pins shared
// with the stem-split pre-warm ping. See PROJECT_STATUS §6 (speed work) for
// the A/B + probe data behind the switch.
//
//   bare  — pseudoram/rvc-v2: RVC conversion only, ~20-40s compute. Default.
//   cover — zsxkib/realistic-voice-cloning (AICoverGen): the old full
//           song-cover pipeline, ~140-220s compute on fresh tracks. Kept as
//           an env-flip rollback: set RVC_ENGINE=cover in Vercel + redeploy.

export const BARE_RVC_VERSION = 'd18e2e0a6a6d3af183cc09622cebba8555ec9a9e66983261fc64c8b1572b7dce'
export const COVER_RVC_VERSION = '0a9c7c558af4c0f20667c1bd1260ce32a2879944a0b9e44e1398660c077b1550'

// Absent/unset env means 'bare' — no Vercel dashboard step needed to adopt.
export function rvcEngine(): 'bare' | 'cover' {
  return process.env.RVC_ENGINE === 'cover' ? 'cover' : 'bare'
}
