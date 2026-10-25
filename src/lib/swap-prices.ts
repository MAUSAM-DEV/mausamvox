// Voice Swap prices in credits — one place for the server (which charges) and the
// page (which only shows them). Admin accounts are never charged.
export const FULL_SWAP_CREDITS = 200        // one voice, full song (a 2-voice duet = 2 × this)
export const PREVIEW_CREDITS = 50           // a preview after the free ones
export const FREE_PREVIEWS_PER_TRACK = 2    // previews per uploaded song that cost nothing

// Per-account guards (2026-10-25, engine rollout step 2) — enforced in the database
// (charge_swap_checked, migration 20261025000000):
export const SWAP_LOCK_MINUTES = 30         // one swap at a time; a swap whose page was closed stops blocking after this
export const HD_SWAPS_PER_DAY = 5           // HD Voice full swaps per account in any 24 hours (beta)
