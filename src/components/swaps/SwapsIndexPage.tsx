'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { LogoFull } from '@/components/ui/Logo'

// All saved tracks (playable voice_swaps rows), newest first — the dashboard's
// Recent Swaps shows only the latest 4; this page is the full list. Rows open
// the existing read-only /swaps/[swapId] page (play/download/delete live there).
// Same authenticated browser-side SELECT the dashboard uses (grant exists).

type SwapRow = {
  id: string
  song_name: string
  voice_used: string
  created_at: string
}

// Front-end paging only — all rows are already fetched; we just cap how many
// render so the list doesn't force a long scroll.
const INITIAL_VISIBLE = 5
const PAGE_STEP = 5

export function SwapsIndexPage() {
  const [swaps, setSwaps] = useState<SwapRow[]>([])
  const [loading, setLoading] = useState(true)
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id
      if (!uid) return // middleware guarantees a session; belt-and-braces
      supabase
        .from('voice_swaps')
        .select('id, song_name, voice_used, created_at')
        .eq('user_id', uid)
        .not('result_path', 'is', null)
        .order('created_at', { ascending: false })
        .then(({ data: rows, error }) => {
          if (error) console.error('saved-tracks fetch failed', error)
          else setSwaps(rows ?? [])
          setLoading(false)
        })
    })
  }, [])

  return (
    <>
      <div className="swl-shell">
        <header className="swl-head">
          <Link href="/" style={{ textDecoration: 'none' }}>
            <LogoFull size={30} />
          </Link>
          <Link href="/dashboard" className="swl-back">← Dashboard</Link>
        </header>

        <main className="swl-main">
          <div className="swl-title-row">
            <h1 className="swl-title">Saved Tracks</h1>
            {!loading && <span className="swl-count">{swaps.length} saved</span>}
          </div>
          <p className="swl-sub">
            Every finished swap you saved, exactly as it sounded when you saved it.
            Tracks are kept for 90 days.
          </p>

          {loading && <div className="swl-note">Loading…</div>}

          {!loading && swaps.length === 0 && (
            <div className="swl-empty">
              <div className="swl-empty-ico">🎵</div>
              <div className="swl-empty-title">No saved tracks yet</div>
              <p className="swl-empty-txt">
                Run a voice swap and save the result — it&rsquo;ll show up here.
              </p>
              <Link href="/voice-swap" className="swl-btn-solid">Start a swap</Link>
            </div>
          )}

          {!loading && swaps.slice(0, visibleCount).map((s) => (
            <Link key={s.id} href={`/swaps/${s.id}`} className="swl-row">
              <span className="swl-row-ico">🎵</span>
              <span className="swl-row-info">
                <span className="swl-row-name">{s.song_name}</span>
                <span className="swl-row-meta">
                  {s.voice_used} · {new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </span>
              </span>
              <span className="swl-row-open">Open →</span>
            </Link>
          ))}

          {!loading && swaps.length > INITIAL_VISIBLE && (
            <div className="swl-more-row">
              {visibleCount < swaps.length && (
                <button
                  className="swl-more-btn"
                  onClick={() => setVisibleCount((c) => Math.min(c + PAGE_STEP, swaps.length))}
                >
                  Show more
                </button>
              )}
              {visibleCount > INITIAL_VISIBLE && (
                <button
                  className="swl-more-btn"
                  onClick={() => setVisibleCount(INITIAL_VISIBLE)}
                >
                  Show less
                </button>
              )}
            </div>
          )}
        </main>
      </div>

      <style suppressHydrationWarning>{`
        body { background: #05050F; }
        .swl-shell {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: #05050F;
        }
        .swl-head {
          padding: 18px 40px;
          border-bottom: 1px solid #2E2E56;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .swl-back {
          font-size: 13px; font-weight: 600; color: #A0A0C8;
          text-decoration: none; transition: color 0.2s;
        }
        .swl-back:hover { color: #F0F0FF; }
        .swl-main {
          flex: 1;
          width: 100%;
          max-width: 620px;
          margin: 0 auto;
          padding: 48px 24px 72px;
        }
        .swl-title-row {
          display: flex; align-items: baseline; justify-content: space-between;
          margin-bottom: 6px;
        }
        .swl-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 24px; font-weight: 700; letter-spacing: -0.5px;
          color: #F0F0FF; margin: 0;
        }
        .swl-count { font-size: 12px; color: #8E8EB4; }
        .swl-sub {
          font-size: 13px; color: #A0A0C8; line-height: 1.6;
          margin: 0 0 26px;
        }
        .swl-note {
          text-align: center; padding: 60px 0;
          font-size: 13px; color: #8E8EB4;
        }
        .swl-empty {
          background: #09091A; border: 1px solid #2E2E56;
          border-radius: 16px; padding: 48px 32px; text-align: center;
        }
        .swl-empty-ico { font-size: 34px; margin-bottom: 14px; }
        .swl-empty-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 18px; font-weight: 700; color: #F0F0FF; margin-bottom: 8px;
        }
        .swl-empty-txt {
          font-size: 13px; color: #A0A0C8; line-height: 1.7;
          max-width: 360px; margin: 0 auto 22px;
        }
        .swl-btn-solid {
          display: inline-block;
          padding: 11px 22px; border-radius: 9px; border: none;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          color: #fff; text-decoration: none;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.25s;
        }
        .swl-btn-solid:hover {
          box-shadow: 0 8px 24px rgba(157,92,255,.4);
          transform: translateY(-1px);
        }
        .swl-row {
          display: flex; align-items: center; gap: 14px;
          background: #09091A; border: 1px solid #2E2E56;
          border-radius: 12px; padding: 14px 18px; margin-bottom: 8px;
          text-decoration: none; transition: all 0.2s;
        }
        .swl-row:hover {
          border-color: rgba(157,92,255,.35);
          transform: translateX(2px);
        }
        .swl-row-ico { font-size: 20px; flex-shrink: 0; }
        .swl-row-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .swl-row-name {
          font-size: 14px; font-weight: 600; color: #F0F0FF;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .swl-row-meta { font-size: 12px; color: #8E8EB4; }
        .swl-row-open {
          font-size: 12px; font-weight: 600; color: #9D5CFF; flex-shrink: 0;
        }
        .swl-more-row {
          display: flex; justify-content: center; gap: 10px;
          margin-top: 14px;
        }
        .swl-more-btn {
          padding: 10px 22px; border-radius: 9px;
          border: 1px solid #3C3C6A; background: transparent; color: #C4C4E0;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.2s;
        }
        .swl-more-btn:hover { border-color: #9D5CFF; color: #9D5CFF; }
        @media (max-width: 640px) {
          .swl-head { padding: 14px 20px; }
          .swl-main { padding-top: 28px; }
        }
      `}</style>
    </>
  )
}
