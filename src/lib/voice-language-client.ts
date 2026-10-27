import type { createClient } from '@/lib/supabase/client'

// Browser side of /api/voice-lab/language (2026-10-27): detect a voice's language from its
// recording, in the background — fire and forget, never throws. Once per voice per browser
// session (an already-detected voice answers at once without a job).
const asked = new Set<string>()

export function detectVoiceLanguage(voiceId: string): void {
  if (!voiceId || asked.has(voiceId)) return
  asked.add(voiceId)
  void (async () => {
    try {
      const res = await fetch('/api/voice-lab/language', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voiceId }) })
      const start = await res.json().catch(() => ({}))
      if (!res.ok || !start.id) return
      const t0 = Date.now()
      while (Date.now() - t0 < 4 * 60_000) {
        await new Promise((r) => setTimeout(r, 6000))
        const poll = await fetch(`/api/voice-lab/language?id=${encodeURIComponent(start.id)}&voiceId=${encodeURIComponent(voiceId)}`).then((r) => r.json()).catch(() => null)
        if (!poll || poll.status === 'starting' || poll.status === 'processing') continue
        if (poll.status === 'succeeded') console.log(`[voice-language] voice ${voiceId}: ${poll.language}`)
        return
      }
    } catch { /* background only */ }
  })()
}

// "hi" → "Hindi". null for no / unknown code.
export function languageName(code: string | null | undefined): string | null {
  if (!code) return null
  try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code } catch { return code }
}

// Same language for matching a voice to a song: Urdu counts as Hindi (the detector already does
// this for voices; a song can still come back 'ur').
export function sameLanguage(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (c: string | null | undefined) => (c === 'ur' ? 'hi' : c ?? '')
  return !!a && !!b && n(a) === n(b)
}

// Each own voice's DETECTED language (voice_clones.language counts only with language_detected),
// by voice id. Best-effort and separate from the main voices query, so a missing column or a
// failed read only means "no labels".
export async function loadVoiceLanguages(supabase: ReturnType<typeof createClient>, userId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  try {
    const { data, error } = await supabase.from('voice_clones').select('id, language, language_detected').eq('user_id', userId)
    if (error || !Array.isArray(data)) return out
    for (const r of data as { id: string; language: string | null; language_detected: boolean | null }[]) {
      if (r.language_detected && r.language) out.set(r.id, r.language)
    }
  } catch { /* labels are optional */ }
  return out
}
