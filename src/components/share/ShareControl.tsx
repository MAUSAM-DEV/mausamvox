'use client'

import { useState } from 'react'

// Share/revoke control for one saved swap. Used on the swap Result screen and
// the saved-track page. Private by default: nothing is public until the user
// clicks Share. Sharing mints (or reuses) the row's unguessable share token
// via POST /api/voice-swaps/share and copies /s/<token> to the clipboard;
// Unshare revokes the token, killing every distributed link immediately.
interface ShareControlProps {
  swapId: string | null // null = the track isn't saved yet (persist in flight)
  initialToken: string | null
  onToast?: (message: string) => void
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard API can be unavailable (older browsers, non-secure contexts).
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

export function ShareControl({ swapId, initialToken, onToast }: ShareControlProps) {
  const [token, setToken] = useState<string | null>(initialToken)
  const [busy, setBusy] = useState(false)

  const shareUrl = token ? `${typeof window !== 'undefined' ? window.location.origin : ''}/s/${token}` : null

  async function toggle(enable: boolean) {
    if (!swapId || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/voice-swaps/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swapId, enable }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? `Share request failed (${res.status})`)
      setToken(data.shareToken ?? null)
      if (enable && data.shareToken) {
        const url = `${window.location.origin}/s/${data.shareToken}`
        const copied = await copyText(url)
        onToast?.(copied ? 'Public link copied — anyone with it can listen' : `Shared. Link: ${url}`)
      } else if (!enable) {
        onToast?.('Sharing turned off — the link no longer works')
      }
    } catch (err) {
      console.error('[share] toggle failed:', err)
      onToast?.(err instanceof Error ? err.message : 'Sharing failed — please try again')
    } finally {
      setBusy(false)
    }
  }

  async function copyLink() {
    if (!shareUrl) return
    const copied = await copyText(shareUrl)
    onToast?.(copied ? 'Public link copied' : `Link: ${shareUrl}`)
  }

  if (!token) {
    return (
      <button
        className="shc-btn"
        onClick={() => toggle(true)}
        disabled={!swapId || busy}
        title={swapId ? 'Create a public link anyone can listen to' : 'Saving your track… Share unlocks once it’s saved'}
      >
        {busy ? '⏳ Sharing…' : '⬆ Share'}
        <style suppressHydrationWarning>{shcCss}</style>
      </button>
    )
  }

  return (
    <span className="shc-group">
      <button className="shc-btn shc-btn--live" onClick={copyLink} disabled={busy} title={shareUrl ?? undefined}>
        🔗 Copy link
      </button>
      <button
        className="shc-btn shc-btn--revoke"
        onClick={() => toggle(false)}
        disabled={busy}
        title="Turn the public link off — it stops working immediately"
      >
        {busy ? '⏳' : '✕ Unshare'}
      </button>
      <style suppressHydrationWarning>{shcCss}</style>
    </span>
  )
}

const shcCss = `
  .shc-group { display: inline-flex; gap: 8px; }
  .shc-btn {
    padding: 11px 18px; border-radius: 9px;
    border: 1px solid #2A2A4A; background: transparent; color: #C4C4E0;
    font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
    font-size: 13px; font-weight: 600; cursor: pointer;
    transition: all 0.2s; white-space: nowrap;
  }
  .shc-btn:hover:not(:disabled) { border-color: #8B5CF6; color: #8B5CF6; }
  .shc-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .shc-btn--live { border-color: rgba(139,92,246,.5); color: #A78BFA; }
  .shc-btn--revoke { border-color: rgba(239,68,68,.3); color: #F87171; }
  .shc-btn--revoke:hover:not(:disabled) { border-color: rgba(239,68,68,.5); color: #F87171; background: rgba(239,68,68,.08); }
`
