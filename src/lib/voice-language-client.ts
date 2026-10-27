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
