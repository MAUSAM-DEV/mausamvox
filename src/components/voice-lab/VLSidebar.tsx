'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { LogoMark } from '@/components/ui/Logo'
import { createClient } from '@/lib/supabase/client'

const TOOLS = [
  { emoji: '🔄', label: 'Voice Swap', href: '/voice-swap', active: false },
  { emoji: '🧬', label: 'Voice Lab', href: '/voice-lab', active: true },
  { emoji: '✂️', label: 'Stem Studio', href: '/stem-studio', active: false },
  { emoji: '🎼', label: 'Choir Composer', href: '/choir', active: false },
  { emoji: '🎷', label: 'Instruments', href: '/instruments', active: false },
  { emoji: '🎵', label: 'Song Studio', href: '/song-studio', active: false },
]

// href: null = unbuilt, rendered dim + "Soon". My Voices links to Voice Lab,
// whose right panel is the full voices list (view/open/delete).
const LIBRARY: { emoji: string; label: string; href: string | null }[] = [
  { emoji: '🎙️', label: 'My Voices', href: '/voice-lab' },
  // "Saved Tracks" (not "Projects" — they're finished outputs, not editable
  // projects; stems/settings aren't stored). Matches the dashboard's naming.
  { emoji: '📁', label: 'Saved Tracks', href: '/swaps' },
  { emoji: '🛒', label: 'Marketplace', href: null },
]

function fmtN(n: number) {
  return n.toLocaleString('en-US')
}

// 'free' → 'Free Plan' etc.; placeholder while the plan is still loading.
function planLabel(plan: string | null) {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) + ' Plan' : '…'
}

export function VLSidebar() {
  const [creditsRemaining, setCreditsRemaining] = useState<number | null>(null)
  const [creditsTotal, setCreditsTotal] = useState<number | null>(null)
  // Real plan from users.plan (free | starter | pro | studio) — was hardcoded
  // "Pro Plan".
  const [plan, setPlan] = useState<string | null>(null)
  // Live "My Voices" count from voice_clones (same query the dashboard + pickers
  // use), so the sidebar badge reflects the real number instead of a stale '3'.
  const [voiceClonesCount, setVoiceClonesCount] = useState<number | null>(null)
  // Real user name + avatar initial, derived exactly like the dashboard header
  // (metadata full_name/name, else email prefix) — was hardcoded "Mausam"/"M".
  const [userName, setUserName] = useState('')
  const [userInitial, setUserInitial] = useState('')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user
      const uid = u?.id
      if (!u || !uid) return
      const name = (u.user_metadata?.full_name ?? u.user_metadata?.name ?? '') as string
      const display = name || (u.email ?? '').split('@')[0]
      setUserName(display)
      setUserInitial((display[0] ?? '').toUpperCase())
      supabase
        .from('users')
        .select('credits_remaining, credits_total, plan')
        .eq('id', uid)
        .single()
        .then(({ data: row, error }) => {
          if (row) { setCreditsRemaining(row.credits_remaining); setCreditsTotal(row.credits_total); setPlan(row.plan) }
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
    })
  }, [])

  const hasCredits = creditsRemaining !== null && creditsTotal !== null && creditsTotal > 0
  // Bar fill = remaining fraction; empty when data is unavailable (never a full bar on failure)
  const remainingPct = hasCredits ? Math.min(100, Math.max(0, (creditsRemaining / creditsTotal) * 100)) : 0

  return (
    <>
      <aside className="vls-sidebar">
        <a href="/" className="vls-logo-row" style={{ textDecoration: 'none' }}>
          <LogoMark size={34} />
          <span className="vls-wordmark">
            Mausam<em className="grad-text" style={{ fontStyle: 'normal' }}>Vox</em>
          </span>
        </a>

        <nav className="vls-nav">
          <div className="vls-group-lbl">Tools</div>
          {TOOLS.map((item) =>
            item.active ? (
              <Link key={item.href} href={item.href} className="vls-link vls-link--active">
                <span className="vls-ico">{item.emoji}</span>
                <span className="vls-lbl">{item.label}</span>
              </Link>
            ) : item.href !== '#' ? (
              <Link key={item.href} href={item.href} className="vls-link">
                <span className="vls-ico">{item.emoji}</span>
                <span className="vls-lbl">{item.label}</span>
              </Link>
            ) : (
              /* Unbuilt tool — dim + "Soon" (dashboard pattern), not a fake live link */
              <div key={item.label} className="vls-link vls-link--soon" aria-disabled="true">
                <span className="vls-ico">{item.emoji}</span>
                <span className="vls-lbl">{item.label}</span>
                <span className="vls-badge vls-badge--soon">Soon</span>
              </div>
            )
          )}

          <div className="vls-group-lbl">Library</div>
          {LIBRARY.map((item) => {
            const badge = item.label === 'My Voices'
              ? (voiceClonesCount === null ? '' : String(voiceClonesCount))
              : ''
            return item.href ? (
              <Link key={item.label} href={item.href} className="vls-link">
                <span className="vls-ico">{item.emoji}</span>
                <span className="vls-lbl">{item.label}</span>
                {badge && <span className="vls-badge">{badge}</span>}
              </Link>
            ) : (
              /* Unbuilt — dim + "Soon" (dashboard pattern) */
              <div key={item.label} className="vls-link vls-link--soon" aria-disabled="true">
                <span className="vls-ico">{item.emoji}</span>
                <span className="vls-lbl">{item.label}</span>
                <span className="vls-badge vls-badge--soon">Soon</span>
              </div>
            )
          })}
        </nav>

        <div className="vls-foot">
          <div className="vls-credits-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', color: '#5A5A80' }}>Credits</span>
              <span style={{ fontSize: '11px', fontWeight: 600, color: hasCredits ? '#C4C4E0' : '#5A5A80' }}>
                {creditsRemaining === null ? '…' : fmtN(creditsRemaining)} / {creditsTotal === null ? '…' : fmtN(creditsTotal)}
              </span>
            </div>
            <div style={{ height: '4px', background: '#1E1E3A', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${remainingPct}%`, borderRadius: '2px', background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)' }} />
            </div>
          </div>

          <div className="vls-user-row">
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{userInitial || '·'}</div>
            <div className="vls-uinfo">
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#C4C4E0' }}>{userName || '…'}</div>
              <div style={{ fontSize: '11px', color: '#5A5A80' }}>{planLabel(plan)}</div>
            </div>
          </div>
        </div>
      </aside>

      <style suppressHydrationWarning>{`
        .vls-sidebar {
          background: #09091A;
          border-right: 1px solid #1E1E3A;
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          width: 216px;
          flex-shrink: 0;
        }
        .vls-logo-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 18px 16px 16px;
          border-bottom: 1px solid #1E1E3A;
          flex-shrink: 0;
        }
        .vls-wordmark {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.2px;
          color: #F0F0FF;
        }
        .vls-nav {
          flex: 1;
          overflow-y: auto;
          padding: 10px 8px;
          scrollbar-width: none;
        }
        .vls-nav::-webkit-scrollbar { display: none; }
        .vls-group-lbl {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: #5A5A80;
          padding: 10px 8px 6px;
        }
        .vls-link {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 10px;
          border-radius: 8px;
          margin-bottom: 1px;
          font-size: 13px;
          font-weight: 500;
          color: #7878A0;
          cursor: pointer;
          transition: all 0.2s;
          text-decoration: none;
          border: 1px solid transparent;
        }
        .vls-link:hover { background: #0E0E20; color: #F0F0FF; }
        .vls-link--active {
          background: rgba(139,92,246,.1);
          border-color: rgba(139,92,246,.18);
          color: #F0F0FF;
        }
        .vls-link--active:hover { background: rgba(139,92,246,.15); }
        .vls-ico { font-size: 15px; width: 20px; text-align: center; flex-shrink: 0; }
        .vls-lbl { flex: 1; }
        .vls-badge {
          margin-left: auto;
          background: rgba(139,92,246,.15);
          color: #8B5CF6;
          font-size: 10px;
          font-weight: 700;
          padding: 1px 7px;
          border-radius: 99px;
        }
        .vls-link--soon { opacity: 0.5; cursor: default; }
        .vls-link--soon:hover { background: transparent; color: #7878A0; }
        .vls-badge--soon {
          background: rgba(255,255,255,.05);
          color: #5A5A80;
          font-size: 9px;
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .vls-foot {
          border-top: 1px solid #1E1E3A;
          padding: 12px;
          flex-shrink: 0;
        }
        .vls-credits-box {
          background: #0E0E20;
          border: 1px solid #1E1E3A;
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 10px;
        }
        .vls-user-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 2px;
          /* Display-only (no click handler) — don't advertise clickability */
          cursor: default;
        }

        @media (max-width: 900px) {
          .vls-sidebar {
            width: 100% !important;
            height: auto !important;
            border-right: none !important;
            border-bottom: 1px solid #1E1E3A;
          }
          .vls-nav {
            display: flex !important;
            flex-direction: row !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            padding: 8px !important;
            gap: 4px;
          }
          .vls-group-lbl { display: none !important; }
          .vls-link {
            flex-shrink: 0;
            white-space: nowrap;
            margin: 0 !important;
          }
          .vls-badge { display: none !important; }
          .vls-foot {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            gap: 10px;
            padding: 10px 12px !important;
          }
          .vls-credits-box { flex: 1; margin-bottom: 0 !important; }
          .vls-uinfo { display: none !important; }
        }
      `}</style>
    </>
  )
}
