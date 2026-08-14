// ── Pre-launch gate ────────────────────────────────────────────────
//
// Single source of truth for "are public registrations open?".
//
// Controlled by NEXT_PUBLIC_SIGNUPS_OPEN. Only the exact string "true"
// opens sign-ups — anything else (unset, "false", "1", "TRUE") keeps them
// closed. Fail-closed is deliberate: a typo in the Vercel env var must not
// silently open registration before launch.
//
// NEXT_PUBLIC_ is required because landing-page CTAs and the sign-up page
// are client/statically-rendered — the flag has to be inlined into the
// client bundle at build time. That means flipping the flag on Vercel
// requires a REDEPLOY to take effect, not just an env-var save.
//
// This gate covers REGISTRATION ONLY. Sign-in, password reset, and every
// existing account keep working untouched.
export const SIGNUPS_OPEN = process.env.NEXT_PUBLIC_SIGNUPS_OPEN === 'true'
