// Who gets the new engines (engine rollout step 3, 2026-10-25) — SERVER ONLY (reads env).
// "New engines" = everything that was admin-only until now: the song-language check and
// Auto engine by language, HD Voice (SoulX → your RVC voice → finishing), Standard +
// balanced finishing, the Configure "Voice" control, our own voice-engine deployment,
// the engine warm-ups, and the MVSEP lead/backing split. NOT included: English HD duets
// (admin only — Duet is frozen) and charging (only admins are never charged; testers pay).
//
// Vercel env (Settings → Environment Variables, then Redeploy):
//   NEW_ENGINES          off | testers | all     (unset or anything else = testers)
//     off     → nobody, admins included: everyone gets today's engine (kill switch)
//     testers → admin accounts + NEW_ENGINES_TESTERS
//     all     → every signed-in account
//   NEW_ENGINES_TESTERS  comma-separated emails (kept out of the code: the repo is public)
//   HD_VOICE=off         the older kill switch — still works, same as NEW_ENGINES=off
// The page asks /api/engine-access; the server checks again on every call.
import { ADMIN_EMAILS } from '@/lib/admin'

export type NewEnginesMode = 'off' | 'testers' | 'all'

export function newEnginesMode(): NewEnginesMode {
  if ((process.env.HD_VOICE ?? '').trim().toLowerCase() === 'off') return 'off'
  const v = (process.env.NEW_ENGINES ?? '').trim().toLowerCase()
  return v === 'off' ? 'off' : v === 'all' ? 'all' : 'testers'
}

function testers(): string[] {
  return (process.env.NEW_ENGINES_TESTERS ?? '').split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean)
}

export function newEnginesFor(email: string | null | undefined): boolean {
  if (!email) return false
  const mode = newEnginesMode()
  if (mode === 'off') return false
  if (mode === 'all') return true
  const e = email.trim().toLowerCase()
  return ADMIN_EMAILS.some((a) => a.toLowerCase() === e) || testers().includes(e)
}
