// Voice Swap prices in credits — one place for the server (which charges) and the
// page (which only shows them). Admin accounts are never charged.
export const FULL_SWAP_CREDITS = 200        // one voice, full song, Standard (a 2-voice duet = 2 × this)
export const HD_SWAP_CREDITS = 800          // one voice, full song, HD Voice (rollout step 5, founder 2026-10-25);
                                            // an HD swap that falls back to Standard costs FULL_SWAP_CREDITS
export const PREVIEW_CREDITS = 50           // a Standard preview after the free ones
export const FREE_PREVIEWS_PER_TRACK = 1    // Standard previews per uploaded song that cost nothing
                                            // (was 2; 1 since the free-credit protection, founder 2026-10-27)
export const HD_PREVIEW_CREDITS = 100       // every HD Voice preview (founder 2026-10-27) — counts toward the
                                            // full HD swap / saving it; doesn't use the free Standard previews

// Per-account guards (2026-10-25, engine rollout step 2) — enforced in the database
// (charge_swap_checked, migration 20261025000000):
export const SWAP_LOCK_MINUTES = 30         // one swap at a time; a swap whose page was closed stops blocking after this
export const HD_SWAPS_PER_DAY = 5           // HD Voice full swaps per account in any 24 hours (beta)

// Uploading a song (its vocals/music split) — charged once per song on the server by
// /api/stem-split or /api/hq-split, whichever asks first (2026-10-27). 100 since the free-credit
// protection (was 50; one upload costs us about $0.15 of machines).
export const SPLIT_CREDITS = 100

// Free credits a new account gets, once (set by the signup trigger — migration
// 20261027000002_signup_credits.sql). Shown on the pricing page and onboarding.
export const SIGNUP_CREDITS = 300

// Duet split (male/female singers, MVSEP) — charged and refunded on the server by /api/gender-split.
export const DUET_SPLIT_CREDITS = 250
// Beta (founder, 2026-10-25): any plan may split a duet when it has the credits — billing isn't
// wired, so every non-admin account is on 'free'. false = Premium plans only again (as before).
export const DUET_SPLIT_ANY_PLAN = true
