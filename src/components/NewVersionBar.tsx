'use client'
// "New version — Reload" (2026-10-10): a tab left open keeps running the app
// code it loaded, even after a new deploy — a live test ran on the old code
// that way. Every 5 min, and whenever the tab comes back into view, compare
// this page's version with /api/version; if they differ, show a small bar.
// Never reloads by itself (that could cut off a swap or a save).

import { useEffect, useState } from 'react'

const MY_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || ''
const CHECK_EVERY_MS = 5 * 60_000
const MIN_GAP_MS = 30_000 // tab switches in a row → one check

export function NewVersionBar() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!MY_VERSION) return // local dev: no version to compare
    let last = 0
    let stopped = false
    const check = async () => {
      if (stopped || document.visibilityState !== 'visible' || Date.now() - last < MIN_GAP_MS) return
      last = Date.now()
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const { version } = await res.json()
        if (typeof version === 'string' && version && version !== MY_VERSION) { stopped = true; setShow(true) }
      } catch { /* offline — try again later */ }
    }
    const id = setInterval(check, CHECK_EVERY_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  if (!show) return null
  return (
    <div className="nvb" role="status">
      <span>New version</span>
      <span className="nvb-dash" aria-hidden="true">—</span>
      <button className="nvb-reload" onClick={() => window.location.reload()}>Reload</button>
      <button className="nvb-close" onClick={() => setShow(false)} aria-label="Dismiss">✕</button>
      <style>{`
        .nvb { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 9999; display: flex; align-items: center; gap: 8px; max-width: calc(100vw - 32px); padding: 8px 8px 8px 14px; border-radius: 999px; border: 1px solid #2E2E56; background: #15152B; color: #E6E6F5; font-size: 13px; box-shadow: 0 6px 24px rgba(0,0,0,.45); }
        .nvb span { white-space: nowrap; }
        .nvb-dash { color: #6E6E96; }
        .nvb-reload { min-height: 32px; padding: 0 14px; border: none; border-radius: 999px; background: linear-gradient(135deg,#9D5CFF,#F9459E); color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
        .nvb-close { width: 32px; height: 32px; border: none; border-radius: 50%; background: none; color: #8E8EB4; cursor: pointer; font-size: 13px; }
        .nvb-close:hover { background: #1E1E3A; color: #fff; }
      `}</style>
    </div>
  )
}
