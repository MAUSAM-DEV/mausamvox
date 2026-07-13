'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { LogoFull } from '@/components/ui/Logo'
import { AudioPlayer } from '@/components/voice-swap/AudioPlayer'

// Public listener page for a shared track (/s/<token>). No auth, no account.
// Audio streams through /api/shared/<token>/audio, which re-signs the stored
// file on every load — the link keeps working for as long as sharing is on.

type Meta = { songName: string; voiceUsed: string; createdAt: string }
type LoadState = 'loading' | 'ready' | 'notFound'

export function SharedTrackPage({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>('loading')
  const [meta, setMeta] = useState<Meta | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/shared/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) { setState('notFound'); return }
        const data = (await res.json()) as Meta
        setMeta(data)
        setState('ready')
      })
      .catch(() => { if (!cancelled) setState('notFound') })
    return () => { cancelled = true }
  }, [token])

  const created = meta ? new Date(meta.createdAt) : null

  return (
    <div className="sh-shell">
      <header className="sh-head">
        <Link href="/" style={{ textDecoration: 'none' }}>
          <LogoFull size={30} />
        </Link>
      </header>

      <main className="sh-main">
        {state === 'loading' && <div className="sh-note">Loading…</div>}

        {state === 'notFound' && (
          <div className="sh-card sh-card--note">
            <div className="sh-ico">🔇</div>
            <div className="sh-title">This track isn&rsquo;t available</div>
            <p className="sh-txt">
              The link may have been turned off by its owner, or it never existed.
            </p>
            <Link href="/" className="sh-cta">Make your own with MausamVox</Link>
          </div>
        )}

        {state === 'ready' && meta && (
          <div className="sh-card">
            <div className="sh-badge">Shared track</div>
            <h1 className="sh-song">{meta.songName}</h1>
            <div className="sh-sub">
              Voice: <strong>{meta.voiceUsed}</strong>
              {created && <> · {created.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</>}
            </div>

            <AudioPlayer src={`/api/shared/${encodeURIComponent(token)}/audio`} label={meta.voiceUsed} />

            <p className="sh-foot">
              Made with <Link href="/" style={{ color: '#9D5CFF', textDecoration: 'none', fontWeight: 600 }}>MausamVox</Link> —
              AI voice swaps for your songs.
            </p>
          </div>
        )}
      </main>

      <style suppressHydrationWarning>{`
        body { background: #05050F; }
        .sh-shell { min-height: 100vh; display: flex; flex-direction: column; background: #05050F; }
        .sh-head {
          padding: 18px 40px; border-bottom: 1px solid #2E2E56;
          display: flex; align-items: center;
        }
        .sh-main {
          flex: 1; width: 100%; max-width: 560px;
          margin: 0 auto; padding: 48px 24px 72px;
        }
        .sh-note { text-align: center; padding: 80px 0; font-size: 13px; color: #8E8EB4; }
        .sh-card {
          background: #09091A; border: 1px solid #2E2E56;
          border-radius: 16px; padding: 28px 24px;
        }
        .sh-card--note { text-align: center; padding: 48px 32px; }
        .sh-ico { font-size: 34px; margin-bottom: 14px; }
        .sh-badge {
          display: inline-block; font-size: 10px; font-weight: 700;
          letter-spacing: 2px; text-transform: uppercase; color: #9D5CFF;
          background: rgba(157,92,255,.12); border: 1px solid rgba(157,92,255,.3);
          border-radius: 999px; padding: 4px 12px; margin-bottom: 14px;
        }
        .sh-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 18px; font-weight: 700; color: #F0F0FF; margin-bottom: 8px;
        }
        .sh-song {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 22px; font-weight: 700; letter-spacing: -0.4px;
          color: #F0F0FF; margin: 0 0 6px; word-break: break-word;
        }
        .sh-sub { font-size: 13px; color: #A0A0C8; margin-bottom: 20px; }
        .sh-sub strong { color: #C4C4E0; font-weight: 600; }
        .sh-txt {
          font-size: 13px; color: #A0A0C8; line-height: 1.7;
          max-width: 380px; margin: 0 auto 22px;
        }
        .sh-cta {
          display: inline-block; padding: 11px 22px; border-radius: 9px;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          color: #fff; text-decoration: none;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; transition: all 0.25s;
        }
        .sh-cta:hover { box-shadow: 0 8px 24px rgba(157,92,255,.4); transform: translateY(-1px); }
        .sh-foot { font-size: 12px; color: #8E8EB4; line-height: 1.6; margin: 18px 0 0; }
        @media (max-width: 640px) {
          .sh-head { padding: 14px 20px; }
          .sh-main { padding-top: 28px; }
        }
      `}</style>
    </div>
  )
}
