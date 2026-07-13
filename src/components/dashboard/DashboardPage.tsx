'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { LogoFull } from '@/components/ui/Logo'
import { VToast } from '@/components/voice-swap/VToast'

const TOOLS = [
  {
    emoji: '✨',
    name: 'AI Cover',
    desc: 'Cover any song in a new voice in 3 guided steps — free community voices, no training needed.',
    href: '/ai-cover',
    live: true,
    gradient: 'linear-gradient(135deg,#F9459E,#F59E0B)',
  },
  {
    emoji: '🔄',
    name: 'Voice Swap',
    desc: 'Replace any song\'s vocals with your cloned AI voice in minutes.',
    href: '/voice-swap',
    live: true,
    gradient: 'linear-gradient(135deg,#9D5CFF,#F9459E)',
  },
  {
    emoji: '🧬',
    name: 'Voice Lab',
    desc: 'Record and train a photorealistic AI clone of your own voice.',
    href: '/voice-lab',
    live: true,
    gradient: 'linear-gradient(135deg,#F9459E,#0CC7E8)',
  },
  {
    emoji: '✂️',
    name: 'Stem Studio',
    desc: 'Separate any track into vocals, bass, drums and more with the StemSplit Engine.',
    href: '/stem-studio',
    live: true,
    gradient: 'linear-gradient(135deg,#0CC7E8,#9D5CFF)',
  },
  {
    emoji: '🎼',
    name: 'Choir Composer',
    desc: 'Turn a solo vocal into stacked harmonies of your own voice.',
    href: '/choir',
    live: true,
    gradient: 'linear-gradient(135deg,#9D5CFF,#0CC7E8)',
  },
  {
    emoji: '🎷',
    name: 'Instruments',
    desc: 'Hum a melody and hear it played on a real instrument.',
    href: '/instruments',
    live: true,
    gradient: 'linear-gradient(135deg,#F9459E,#9D5CFF)',
  },
  {
    emoji: '🎵',
    name: 'Song Studio',
    desc: 'Generate full AI songs from your lyrics and a style prompt.',
    href: '/song-studio',
    live: true,
    gradient: 'linear-gradient(135deg,#0CC7E8,#F9459E)',
  },
  {
    emoji: '🌐',
    name: 'Voice Library',
    desc: 'Browse community-shared voices and use them in your swaps — free.',
    href: '/library',
    live: true,
    gradient: 'linear-gradient(135deg,#10B981,#0CC7E8)',
  },
]

type RecentSwap = {
  id: string
  song_name: string
  voice_used: string
  created_at: string
}

export function DashboardPage() {
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [userInitial, setUserInitial] = useState('M')
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null)
  const [voiceClonesCount, setVoiceClonesCount] = useState<number | null>(null)
  const [voiceSwapsCount, setVoiceSwapsCount] = useState<number | null>(null)
  const [recentSwaps, setRecentSwaps] = useState<RecentSwap[]>([])
  const [swapsLoading, setSwapsLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [dropOpen, setDropOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)
  // Same VToast pattern as the other pages — used to surface delete failures.
  const [toast, setToast] = useState({ visible: false, message: '' })
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const showToast = useCallback((message: string, ms = 3200) => {
    clearTimeout(toastTimerRef.current)
    setToast({ visible: true, message })
    toastTimerRef.current = setTimeout(() => setToast((p) => ({ ...p, visible: false })), ms)
  }, [])
  useEffect(() => () => clearTimeout(toastTimerRef.current), [])
  // Captured on mount so the focus/visibility refetch can re-query without
  // re-resolving the session each time.
  const userIdRef = useRef<string | null>(null)

  // Live-refetch the dashboard numbers — counts, the Recent Swaps list (same
  // query), and Credits Left — so revisiting the dashboard reflects activity
  // elsewhere (swaps/clones created or deleted, credits spent on other pages).
  // Stable identity (no deps) so the focus/visibility listeners stay attached.
  const refetchCounts = useCallback(async () => {
    const uid = userIdRef.current
    if (!uid) return
    const supabase = createClient()

    supabase
      .from('users')
      .select('credits_remaining')
      .eq('id', uid)
      .single()
      .then(({ data: row, error }) => {
        if (row) setCreditsRemaining(row.credits_remaining)
        else if (error) console.error('credits fetch failed', error)
      })

    supabase
      .from('voice_clones')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)
      .then(({ count, error }) => {
        if (error) console.error('voice_clones count failed', error)
        else setVoiceClonesCount(count ?? 0)
      })

    // Only playable swaps: rows whose durable file is gone (persist soft-failed
    // or expired by the 90-day cleanup) are excluded from both count and list.
    supabase
      .from('voice_swaps')
      .select('id, song_name, voice_used, created_at', { count: 'exact' })
      .eq('user_id', uid)
      .not('result_path', 'is', null)
      .order('created_at', { ascending: false })
      .limit(4)
      .then(({ data: s, count, error }) => {
        if (error) console.error('voice_swaps fetch failed', error)
        else { setVoiceSwapsCount(count ?? 0); setRecentSwaps(s ?? []) }
        setSwapsLoading(false)
      })
  }, [])

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user
      if (!u) return
      const name = (u.user_metadata?.full_name ?? u.user_metadata?.name ?? '') as string
      const email = u.email ?? ''
      const display = name || email.split('@')[0]
      setUserName(display)
      setUserEmail(email)
      setUserInitial((display[0] ?? 'M').toUpperCase())
      userIdRef.current = u.id

      // Initial load: counts + Recent Swaps + Credits Left (all in refetchCounts).
      void refetchCounts()
    })
  }, [refetchCounts])

  // Refetch counts + credits whenever the dashboard regains focus or the tab
  // becomes visible again, so numbers stay live after creating/deleting swaps
  // or clones (or spending credits) on another page or tab — without polling.
  useEffect(() => {
    const onFocus = () => { void refetchCounts() }
    const onVisible = () => { if (document.visibilityState === 'visible') void refetchCounts() }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refetchCounts])

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  async function handleDeleteSwap(id: string) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/voice-swaps/delete?id=${id}`, { method: 'DELETE' })
      if (res.ok) {
        // Optimistically drop the row for snappy UI, then refetch so the count
        // (and list) come from the DB rather than a local decrement.
        setRecentSwaps((prev) => prev.filter((s) => s.id !== id))
        void refetchCounts()
      } else {
        const body = await res.json().catch(() => null)
        showToast(`Delete failed — ${body?.error ?? `server error (${res.status})`}`)
      }
    } catch {
      showToast('Delete failed — network error. Check your connection and try again.')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const firstName = userName.split(' ')[0]

  return (
    <>
      {/* ── Topbar ─────────────────────────────────────────────────── */}
      <header className="db-topbar">
        <LogoFull size={32} />

        <nav className="db-topnav">
          <Link href="/dashboard" className="db-tnav db-tnav--active">Dashboard</Link>
          <Link href="/voice-swap" className="db-tnav">Voice Swap</Link>
          <Link href="/voice-lab" className="db-tnav">Voice Lab</Link>
        </nav>

        <div ref={dropRef} className="db-topbar-end">
          <div
            className="db-avatar"
            onClick={() => setDropOpen((o) => !o)}
            aria-label="User menu"
          >
            {userInitial}
          </div>

          {dropOpen && (
            <div className="db-drop">
              <div className="db-drop-user">
                <div className="db-drop-name">{userName}</div>
                <div className="db-drop-email">{userEmail}</div>
              </div>
              <div className="db-drop-sep" />
              <Link href="/dashboard" className="db-drop-item" onClick={() => setDropOpen(false)}>
                Dashboard
              </Link>
              <Link href="/settings" className="db-drop-item" onClick={() => setDropOpen(false)}>
                Settings
              </Link>
              <div className="db-drop-sep" />
              <button className="db-drop-item db-drop-out" onClick={handleSignOut}>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────────────── */}
      <main className="db-main">

        {/* Welcome */}
        <div className="db-welcome">
          <p className="db-welcome-eye">Welcome back</p>
          <h1 className="db-welcome-h1">
            Hey, <span className="grad-text">{firstName || 'there'}</span> 👋
          </h1>
          <p className="db-welcome-sub">Your AI music studio is ready. What are you creating today?</p>
        </div>

        {/* Quick stats row */}
        <div className="db-stats">
          {[
            { label: 'Saved Tracks', value: voiceSwapsCount === null ? '—' : voiceSwapsCount.toLocaleString('en-US'), icon: '🔄' },
            { label: 'Voice Clones', value: voiceClonesCount === null ? '—' : voiceClonesCount.toLocaleString('en-US'), icon: '🧬' },
            { label: 'Credits Left', value: creditsRemaining === null ? '…' : creditsRemaining.toLocaleString('en-US'), icon: '⚡' },
          ].map((s) => (
            <div key={s.label} className="db-stat">
              <span className="db-stat-ico">{s.icon}</span>
              <div>
                <div className="db-stat-val">{s.value}</div>
                <div className="db-stat-lbl">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Tools */}
        <section className="db-section">
          <div className="db-sec-hdr">
            <h2 className="db-sec-title">Tools</h2>
          </div>
          <div className="db-grid">
            {TOOLS.map((tool) =>
              tool.live ? (
                <Link key={tool.name} href={tool.href} className="db-card db-card--live">
                  <div className="db-card-top">
                    <div className="db-card-ico" style={{ background: tool.gradient }}>
                      {tool.emoji}
                    </div>
                    <span className="db-badge db-badge--live">Live</span>
                  </div>
                  <div className="db-card-name">{tool.name}</div>
                  <div className="db-card-desc">{tool.desc}</div>
                  <span className="db-card-arrow">Open →</span>
                </Link>
              ) : (
                <div key={tool.name} className="db-card db-card--soon">
                  <div className="db-card-top">
                    <div className="db-card-ico db-card-ico--dim" style={{ background: tool.gradient }}>
                      {tool.emoji}
                    </div>
                    <span className="db-badge db-badge--soon">Soon</span>
                  </div>
                  <div className="db-card-name">{tool.name}</div>
                  <div className="db-card-desc">{tool.desc}</div>
                </div>
              )
            )}
          </div>
        </section>

        {/* Recent swaps */}
        <section className="db-section">
          <div className="db-sec-hdr">
            <h2 className="db-sec-title">Recent Swaps</h2>
            <span style={{ display: 'flex', gap: '18px' }}>
              <Link href="/swaps" className="db-sec-more">View all →</Link>
              <Link href="/voice-swap" className="db-sec-more">New swap →</Link>
            </span>
          </div>
          <div className="db-recent">
            {swapsLoading ? (
              <div style={{ padding: '20px 0', color: '#8E8EB4', fontSize: '13px' }}>Loading…</div>
            ) : recentSwaps.length === 0 ? (
              <div style={{ padding: '20px 0', color: '#8E8EB4', fontSize: '13px' }}>
                No swaps yet —{' '}
                <Link href="/voice-swap" style={{ color: '#9D5CFF' }}>start your first</Link>
              </div>
            ) : (
              recentSwaps.map((item) => (
                <div key={item.id} className="db-row">
                  <span className="db-row-ico">🎵</span>
                  <div className="db-row-info">
                    <div className="db-row-name">{item.song_name}</div>
                    <div className="db-row-meta">{item.voice_used}</div>
                  </div>
                  <Link href={`/swaps/${item.id}`} className="db-row-open">Open</Link>
                  <button
                    className="db-row-del"
                    onClick={() => handleDeleteSwap(item.id)}
                    disabled={deletingId === item.id}
                    aria-label="Delete swap"
                  >
                    {deletingId === item.id ? '…' : '×'}
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      <VToast visible={toast.visible} message={toast.message} />

      <style suppressHydrationWarning>{`
        /* ── topbar ── */
        body { background: #05050F; }
        .db-topbar {
          position: sticky; top: 0; z-index: 100;
          height: 60px;
          display: flex; align-items: center; gap: 28px;
          padding: 0 40px;
          background: rgba(5,5,15,.85);
          backdrop-filter: blur(24px);
          border-bottom: 1px solid #2E2E56;
        }
        .db-topnav { display: flex; gap: 2px; flex: 1; }
        .db-tnav {
          padding: 6px 14px; border-radius: 7px;
          font-size: 13px; font-weight: 500; color: #A0A0C8;
          text-decoration: none; transition: all 0.2s;
        }
        .db-tnav:hover { color: #F0F0FF; background: rgba(255,255,255,.04); }
        .db-tnav--active { color: #F0F0FF; background: rgba(157,92,255,.12); }
        .db-topbar-end { margin-left: auto; position: relative; flex-shrink: 0; }
        .db-avatar {
          width: 34px; height: 34px; border-radius: 50%;
          background: linear-gradient(135deg,#9D5CFF,#F9459E,#0CC7E8);
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; font-weight: 700; color: #fff;
          cursor: pointer; transition: transform 0.18s, box-shadow 0.18s;
          user-select: none;
        }
        .db-avatar:hover { transform: scale(1.07); box-shadow: 0 0 0 3px rgba(157,92,255,.3); }
        .db-drop {
          position: absolute; top: calc(100% + 10px); right: 0;
          min-width: 210px;
          background: #0E0E20; border: 1px solid #3C3C6A;
          border-radius: 12px; padding: 6px;
          box-shadow: 0 20px 60px rgba(0,0,0,.7);
          animation: dbFade 0.15s ease;
        }
        @keyframes dbFade {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .db-drop-user { padding: 10px 10px 8px; }
        .db-drop-name { font-size: 13px; font-weight: 600; color: #F0F0FF; }
        .db-drop-email { font-size: 11px; color: #8E8EB4; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .db-drop-sep { height: 1px; background: #2E2E56; margin: 4px 0; }
        .db-drop-item {
          display: block; width: 100%;
          padding: 8px 10px; border-radius: 7px;
          font-size: 13px; font-weight: 500; color: #C4C4E0;
          text-decoration: none; cursor: pointer;
          border: none; background: none; text-align: left;
          transition: all 0.15s;
        }
        .db-drop-item:hover { background: rgba(157,92,255,.1); color: #F0F0FF; }
        .db-drop-out { color: #F87171 !important; }
        .db-drop-out:hover { background: rgba(239,68,68,.08) !important; }

        /* ── main ── */
        .db-main {
          max-width: 1040px; margin: 0 auto;
          padding: 52px 40px 100px;
        }

        /* welcome */
        .db-welcome { margin-bottom: 40px; }
        .db-welcome-eye {
          font-size: 11px; font-weight: 700; letter-spacing: 2.5px;
          text-transform: uppercase; color: #8E8EB4; margin: 0 0 10px;
        }
        .db-welcome-h1 {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 38px; font-weight: 700; letter-spacing: -1px;
          color: #F0F0FF; margin: 0 0 10px; line-height: 1.1;
        }
        .db-welcome-sub { font-size: 15px; color: #8E8EB4; margin: 0; }

        /* stats */
        .db-stats {
          display: flex; gap: 14px; margin-bottom: 48px; flex-wrap: wrap;
        }
        .db-stat {
          flex: 1; min-width: 140px;
          display: flex; align-items: center; gap: 12px;
          padding: 16px 18px; border-radius: 12px;
          background: #09091A; border: 1px solid #2E2E56;
        }
        .db-stat-ico { font-size: 20px; }
        .db-stat-val {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 20px; font-weight: 700; color: #F0F0FF; line-height: 1;
        }
        .db-stat-lbl { font-size: 11px; color: #8E8EB4; margin-top: 3px; }

        /* sections */
        .db-section { margin-bottom: 48px; }
        .db-sec-hdr {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 16px;
        }
        .db-sec-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 17px; font-weight: 700; color: #F0F0FF; margin: 0;
        }
        .db-sec-more {
          font-size: 12px; font-weight: 600; color: #9D5CFF;
          text-decoration: none; transition: color 0.2s;
        }
        .db-sec-more:hover { color: #C084FC; }

        /* tool grid */
        .db-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        .db-card {
          display: flex; flex-direction: column; gap: 10px;
          padding: 18px; border-radius: 14px;
          border: 1px solid #2E2E56;
          background: #09091A;
          text-decoration: none; position: relative;
          transition: all 0.22s;
        }
        .db-card--live:hover {
          border-color: rgba(157,92,255,.4);
          background: rgba(157,92,255,.04);
          transform: translateY(-2px);
          box-shadow: 0 14px 40px rgba(0,0,0,.35);
        }
        .db-card--soon { opacity: 0.5; cursor: default; }
        .db-card-top {
          display: flex; align-items: flex-start; justify-content: space-between;
        }
        .db-card-ico {
          width: 42px; height: 42px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center;
          font-size: 20px; flex-shrink: 0;
        }
        .db-card-ico--dim { filter: saturate(0.5); }
        .db-badge {
          font-size: 9px; font-weight: 700; letter-spacing: 1px;
          text-transform: uppercase;
          padding: 3px 8px; border-radius: 99px; margin-top: 2px;
        }
        .db-badge--live { background: rgba(157,92,255,.15); color: #9D5CFF; }
        .db-badge--soon { background: rgba(255,255,255,.05); color: #8E8EB4; }
        .db-card-name {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 14px; font-weight: 700; color: #F0F0FF;
        }
        .db-card-desc { font-size: 12px; color: #8E8EB4; line-height: 1.55; flex: 1; }
        .db-card-arrow {
          font-size: 12px; font-weight: 600; color: #9D5CFF;
          opacity: 0; transition: opacity 0.2s, transform 0.2s;
          margin-top: 4px;
        }
        .db-card--live:hover .db-card-arrow { opacity: 1; transform: translateX(2px); }

        /* recent swaps */
        .db-recent { display: flex; flex-direction: column; gap: 8px; }
        .db-row {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 14px; border-radius: 10px;
          background: #09091A; border: 1px solid #2E2E56;
          transition: border-color 0.2s;
        }
        .db-row:hover { border-color: rgba(157,92,255,.25); }
        .db-row-ico { font-size: 18px; flex-shrink: 0; }
        .db-row-info { flex: 1; min-width: 0; }
        .db-row-name { font-size: 13px; font-weight: 600; color: #F0F0FF; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .db-row-meta { font-size: 11px; color: #8E8EB4; }
        .db-row-open {
          font-size: 12px; font-weight: 600; color: #9D5CFF;
          text-decoration: none; flex-shrink: 0;
          padding: 5px 12px; border-radius: 7px; border: 1px solid rgba(157,92,255,.25);
          transition: all 0.18s;
        }
        .db-row-open:hover { background: rgba(157,92,255,.1); border-color: rgba(157,92,255,.5); }
        .db-row-del {
          font-size: 14px; line-height: 1; font-weight: 400; color: #8E8EB4;
          background: none; border: none; cursor: pointer; flex-shrink: 0;
          padding: 5px 7px; border-radius: 6px; transition: color 0.18s, background 0.18s;
        }
        .db-row-del:hover:not(:disabled) { color: #F87171; background: rgba(239,68,68,.08); }
        .db-row-del:disabled { opacity: 0.4; cursor: default; }

        @media (max-width: 860px) {
          .db-topbar { padding: 0 20px; }
          .db-main { padding: 32px 20px 60px; }
          .db-grid { grid-template-columns: repeat(2, 1fr); }
          .db-welcome-h1 { font-size: 28px; }
        }
        @media (max-width: 540px) {
          .db-grid { grid-template-columns: 1fr; }
          .db-topnav { display: none; }
          .db-stats { gap: 10px; }
          .db-stat { min-width: 0; }
        }
      `}</style>
    </>
  )
}
