'use client'

import { useEffect, useState } from 'react'

// "I own this audio or have the rights to use it" — asked once per account, before its first
// song upload (Voice Swap, Stem Studio). /api/consent remembers it; the split routes refuse a
// non-admin upload without it. `accepted` stays null while the answer loads.
export function useUploadRights() {
  const [accepted, setAccepted] = useState<boolean | null>(null)
  const [askedHere, setAskedHere] = useState(false) // keep the ticked box on screen after ticking
  const [nudge, setNudge] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/api/consent')
      .then((r) => (r.ok ? r.json() : { uploadRights: false }))
      .then((d: { uploadRights?: boolean }) => {
        if (!live) return
        setAccepted(!!d.uploadRights)
        if (!d.uploadRights) setAskedHere(true)
      })
      .catch(() => { if (live) { setAccepted(false); setAskedHere(true) } })
    return () => { live = false }
  }, [])

  async function accept(on: boolean) {
    setAccepted(on)
    setNudge(false)
    if (on) await fetch('/api/consent', { method: 'POST' }).catch(() => {})
  }

  // Call before starting an upload: true = go ahead; false = not ticked yet (the box is highlighted)
  function ready(): boolean {
    if (accepted) return true
    setAskedHere(true)
    setNudge(true)
    return false
  }

  return { accepted, askedHere, nudge, accept, ready }
}

export function UploadRightsCheck({ rights }: { rights: ReturnType<typeof useUploadRights> }) {
  if (!rights.askedHere) return null
  return (
    <label className={`urc ${rights.nudge ? 'urc--nudge' : ''}`} onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={!!rights.accepted}
        onChange={(e) => { void rights.accept(e.target.checked) }}
      />
      <span>
        I own this audio or have the rights to use it.{' '}
        <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a>
      </span>
      <style suppressHydrationWarning>{`
        .urc {
          display: flex; align-items: flex-start; gap: 10px; margin: 12px 0 0;
          padding: 10px 12px; border: 1px solid #2E2E56; border-radius: 10px;
          background: #0E0E20; font-size: 13px; color: #C8C8E8; cursor: pointer; line-height: 1.45;
        }
        .urc input { margin-top: 2px; accent-color: #9D5CFF; flex-shrink: 0; }
        .urc a { color: #A78BFA; }
        .urc--nudge { border-color: #F59E0B; box-shadow: 0 0 0 3px rgba(245,158,11,.15); }
      `}</style>
    </label>
  )
}
