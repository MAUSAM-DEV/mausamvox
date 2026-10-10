'use client'
// Compare keys — lives INSIDE the Song Key box on Configure (no new page
// buttons). A hint line opens a small panel: three ~15 s chorus previews
// (Auto, Auto −2, Auto +2); tap one to play, "Use this key" applies it.
// The work itself happens in keyPreviews.ts (passed in as `run`).

import { useEffect, useRef, useState } from 'react'
import type { KeyPreview } from './keyPreviews'
import { KEY_COMPARE_MAX } from '@/lib/key-compare-shared'

type Phase = { s: 'idle' } | { s: 'working'; stage: string } | { s: 'ready'; previews: KeyPreview[] } | { s: 'error'; msg: string } | { s: 'limit'; minutes: number }

const fmtKey = (k: number) => (k === 0 ? 'Original' : `${k > 0 ? '+' : ''}${k} st`)

export function KeyCompare({ available, unavailableWhy, settingsId, run, onUse }: {
  available: boolean
  unavailableWhy?: string
  settingsId: string // previews belong to this song + voice + pitch settings
  run: (onStage: (s: string) => void) => Promise<KeyPreview[]>
  onUse: (p: KeyPreview) => void
}) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>({ s: 'idle' })
  const [selected, setSelected] = useState<number | null>(null)
  const [playing, setPlaying] = useState<number | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)
  const runIdRef = useRef(0)

  const stop = () => { try { srcRef.current?.stop() } catch { /* already stopped */ } srcRef.current = null; setPlaying(null) }
  // New song / voice / pitch settings → old previews no longer apply.
  useEffect(() => { runIdRef.current++; stop(); setPhase({ s: 'idle' }); setSelected(null) }, [settingsId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { stop(); void ctxRef.current?.close() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function start() {
    const id = ++runIdRef.current
    stop(); setSelected(null)
    setPhase({ s: 'working', stage: '' })
    try {
      const previews = await run((stage) => { if (runIdRef.current === id) setPhase({ s: 'working', stage }) })
      if (runIdRef.current !== id) return
      setPhase({ s: 'ready', previews })
      setSelected(previews.find((p) => p.isAuto)?.key ?? previews[0]?.key ?? null)
    } catch (err) {
      if (runIdRef.current !== id) return
      const e = err as Error & { retryAfterSecs?: number }
      if (e.message === 'limit') setPhase({ s: 'limit', minutes: Math.max(1, Math.ceil((e.retryAfterSecs ?? 3600) / 60)) })
      else setPhase({ s: 'error', msg: e.message || 'Something went wrong' })
    }
  }

  async function toggle(p: KeyPreview) {
    setSelected(p.key)
    if (playing === p.key) { stop(); return }
    stop()
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    if (ctxRef.current.state === 'suspended') await ctxRef.current.resume()
    const src = ctxRef.current.createBufferSource()
    src.buffer = p.buffer; src.connect(ctxRef.current.destination)
    src.onended = () => { if (srcRef.current === src) { srcRef.current = null; setPlaying(null) } }
    src.start(); srcRef.current = src; setPlaying(p.key)
  }

  function close() { runIdRef.current++; stop(); setOpen(false); if (phase.s === 'working') setPhase({ s: 'idle' }) }

  return (
    <div className="vs-kc">
      <div className="vs-kc-hint">
        Doesn&rsquo;t sound like you? Try a different key{available ? <> — <button className="vs-kc-link" onClick={() => { setOpen(true); if (phase.s === 'idle') void start() }}>Compare keys ›</button></> : null}
        {!available && unavailableWhy ? <span className="vs-kc-why"> ({unavailableWhy})</span> : null}
      </div>
      {open && (
        <div className="vs-kc-panel" role="region" aria-label="Compare keys">
          {phase.s === 'working' && (
            <div className="vs-kc-status" role="status"><span className="vs-kc-spin" aria-hidden="true" /> Making 3 previews… about 1 minute {phase.stage && <span className="vs-kc-stage">{phase.stage}</span>}</div>
          )}
          {phase.s === 'error' && (
            <div className="vs-kc-status vs-kc-status--err">
              Couldn&rsquo;t make the previews — {phase.msg}. <button className="vs-kc-link" onClick={() => void start()}>Try again</button>
            </div>
          )}
          {phase.s === 'limit' && (
            <div className="vs-kc-status vs-kc-status--err">
              You&rsquo;ve compared keys {KEY_COMPARE_MAX} times for this song in the last hour. Try again in about {phase.minutes} min.
            </div>
          )}
          {phase.s === 'ready' && (
            <>
              <div className="vs-kc-cards">
                {phase.previews.map((p) => (
                  <button
                    key={p.key}
                    className={`vs-kc-card${selected === p.key ? ' vs-kc-card--on' : ''}`}
                    onClick={() => void toggle(p)}
                    aria-pressed={selected === p.key}
                    aria-label={`${playing === p.key ? 'Stop' : 'Play'} preview in key ${p.isAuto ? 'Auto ' : ''}${fmtKey(p.key)}`}
                  >
                    <span className="vs-kc-play" aria-hidden="true">{playing === p.key ? '■' : '▶'}</span>
                    <span className="vs-kc-key">{p.isAuto ? `Auto ${fmtKey(p.key)}` : fmtKey(p.key)}</span>
                    {p.isAuto && <span className="vs-kc-sub">recommended</span>}
                  </button>
                ))}
              </div>
              <div className="vs-kc-actions">
                <button className="vs-kc-use" disabled={selected === null} onClick={() => { const p = phase.previews.find((x) => x.key === selected); if (p) { stop(); onUse(p); setOpen(false) } }}>
                  Use this key
                </button>
                <button className="vs-kc-link" onClick={() => void start()}>Make new previews</button>
                <span className="vs-kc-free">Free · {KEY_COMPARE_MAX} per song per hour</span>
              </div>
            </>
          )}
          <button className="vs-kc-close" onClick={close} aria-label="Close Compare keys">✕</button>
        </div>
      )}
      <style>{`
        .vs-kc { margin-top: 8px; }
        .vs-kc-hint { font-size: 12px; color: #A8A8CC; line-height: 1.5; }
        .vs-kc-why { color: #6E6E96; }
        .vs-kc-link { background: none; border: none; padding: 0; color: #C4B5FD; font: inherit; font-weight: 600; cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
        .vs-kc-link:hover { color: #E9D5FF; }
        .vs-kc-panel { position: relative; margin-top: 8px; padding: 12px 12px 10px; border: 1px solid #2E2E56; border-radius: 10px; background: #0E0E20; }
        .vs-kc-status { font-size: 12px; color: #C4C4E0; display: flex; align-items: center; gap: 8px; padding-right: 22px; flex-wrap: wrap; }
        .vs-kc-status--err { color: #FCD34D; display: block; }
        .vs-kc-stage { color: #6E6E96; font-size: 11px; }
        .vs-kc-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #2E2E56; border-top-color: #9D5CFF; animation: vs-kc-spin .8s linear infinite; flex-shrink: 0; }
        @keyframes vs-kc-spin { to { transform: rotate(360deg) } }
        .vs-kc-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding-right: 22px; }
        .vs-kc-card { min-height: 56px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 8px 6px; border-radius: 8px; border: 1px solid #2E2E56; background: #15152B; color: #E6E6F5; cursor: pointer; font: inherit; }
        .vs-kc-card--on { border-color: #9D5CFF; background: rgba(157,92,255,.14); }
        .vs-kc-play { font-size: 13px; color: #C4B5FD; }
        .vs-kc-key { font-size: 13px; font-weight: 600; white-space: nowrap; }
        .vs-kc-sub { font-size: 10px; color: #8E8EB4; }
        .vs-kc-actions { margin-top: 10px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .vs-kc-use { min-height: 36px; padding: 0 16px; border-radius: 8px; border: none; background: linear-gradient(135deg,#9D5CFF,#F9459E); color: #fff; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
        .vs-kc-use:disabled { opacity: .5; cursor: default; }
        .vs-kc-free { font-size: 11px; color: #6E6E96; margin-left: auto; }
        .vs-kc-close { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; border: none; background: none; color: #8E8EB4; cursor: pointer; font-size: 14px; border-radius: 6px; }
        .vs-kc-close:hover { color: #fff; background: #1E1E3A; }
        @media (max-width: 480px) {
          .vs-kc-cards { grid-template-columns: 1fr; padding-right: 0; margin-top: 22px; }
          .vs-kc-card { flex-direction: row; justify-content: flex-start; gap: 10px; min-height: 48px; padding: 8px 12px; }
          .vs-kc-use { flex: 1 1 100%; min-height: 44px; }
          .vs-kc-free { margin-left: 0; }
        }
      `}</style>
    </div>
  )
}
