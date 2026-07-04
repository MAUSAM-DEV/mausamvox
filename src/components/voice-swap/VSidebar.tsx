'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { LogoMark } from '@/components/ui/Logo'
import { createClient } from '@/lib/supabase/client'

const TOOLS = [
  { emoji: '🔄', label: 'Voice Swap', href: '/voice-swap' },
  { emoji: '🧬', label: 'Voice Lab', href: '/voice-lab' },
  { emoji: '✂️', label: 'Stem Studio', href: '/stem-studio' },
  { emoji: '🎼', label: 'Choir Composer', href: '#' },
  { emoji: '🎷', label: 'Instruments', href: '#' },
  { emoji: '🎵', label: 'Song Studio', href: '#' },
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

interface VSidebarProps {
  creditsRemaining: number | null
  creditsTotal: number | null
  // Real plan from users.plan (free | starter | pro | studio), owned by the
  // page alongside credits — the sidebar previously hardcoded "Pro Plan".
  plan: string | null
  // Which tool this sidebar instance highlights — the sidebar is shared by
  // Voice Swap and Stem Studio.
  activeTool?: string
}

function fmtN(n: number) {
  return n.toLocaleString('en-US')
}

// 'free' → 'Free Plan' etc.; placeholder while the plan is still loading.
function planLabel(plan: string | null) {
  return plan ? plan.charAt(0).toUpperCase() + plan.slice(1) + ' Plan' : '…'
}

export function VSidebar({ creditsRemaining, creditsTotal, plan, activeTool = 'Voice Swap' }: VSidebarProps) {
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
      <aside className="vs-sidebar">
        {/* Logo */}
        <a href="/" className="vs-logo-row" style={{ textDecoration: 'none' }}>
          <LogoMark size={34} />
          <span className="vs-wordmark">
            Mausam<em className="grad-text" style={{ fontStyle: 'normal' }}>Vox</em>
          </span>
        </a>

        {/* Nav */}
        <nav className="vs-sb-nav">
          <div className="vs-group-lbl">Tools</div>
          {TOOLS.map((item) =>
            item.label === activeTool ? (
              <Link key={item.href} href={item.href} className="vs-sb-link vs-sb-link--active">
                <span className="vs-sb-ico">{item.emoji}</span>
                <span className="vs-sb-lbl">{item.label}</span>
              </Link>
            ) : item.href !== '#' ? (
              <Link key={item.href} href={item.href} className="vs-sb-link">
                <span className="vs-sb-ico">{item.emoji}</span>
                <span className="vs-sb-lbl">{item.label}</span>
              </Link>
            ) : (
              /* Unbuilt tool — dim + "Soon" (dashboard pattern), not a fake live link */
              <div key={item.label} className="vs-sb-link vs-sb-link--soon" aria-disabled="true">
                <span className="vs-sb-ico">{item.emoji}</span>
                <span className="vs-sb-lbl">{item.label}</span>
                <span className="vs-sb-badge vs-sb-badge--soon">Soon</span>
              </div>
            )
          )}

          <div className="vs-group-lbl">Library</div>
          {LIBRARY.map((item) => {
            const badge = item.label === 'My Voices'
              ? (voiceClonesCount === null ? '' : String(voiceClonesCount))
              : ''
            return item.href ? (
              <Link key={item.label} href={item.href} className="vs-sb-link">
                <span className="vs-sb-ico">{item.emoji}</span>
                <span className="vs-sb-lbl">{item.label}</span>
                {badge && <span className="vs-sb-badge">{badge}</span>}
              </Link>
            ) : (
              /* Unbuilt — dim + "Soon" (dashboard pattern) */
              <div key={item.label} className="vs-sb-link vs-sb-link--soon" aria-disabled="true">
                <span className="vs-sb-ico">{item.emoji}</span>
                <span className="vs-sb-lbl">{item.label}</span>
                <span className="vs-sb-badge vs-sb-badge--soon">Soon</span>
              </div>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="vs-sb-foot">
          <div className="vs-credits-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', color: '#5A5A80' }}>Credits</span>
              <span style={{ fontSize: '11px', fontWeight: 600, color: hasCredits ? '#C4C4E0' : '#5A5A80' }}>
                {creditsRemaining === null ? '…' : fmtN(creditsRemaining)} / {creditsTotal === null ? '…' : fmtN(creditsTotal)}
              </span>
            </div>
            <div style={{ height: '4px', background: '#1E1E3A', borderRadius: '2px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${remainingPct}%`,
                  borderRadius: '2px',
                  background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>

          <div className="vs-user-row">
            <div
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 700,
                color: '#fff',
                flexShrink: 0,
              }}
            >
              {userInitial || '·'}
            </div>
            <div className="vs-uinfo">
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#C4C4E0' }}>{userName || '…'}</div>
              <div style={{ fontSize: '11px', color: '#5A5A80' }}>{planLabel(plan)}</div>
            </div>
          </div>
        </div>
      </aside>

      <style suppressHydrationWarning>{`
        .vs-sidebar {
          background: #09091A;
          border-right: 1px solid #1E1E3A;
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
          width: 216px;
          flex-shrink: 0;
        }
        .vs-logo-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 18px 16px 16px;
          border-bottom: 1px solid #1E1E3A;
          flex-shrink: 0;
        }
        .vs-wordmark {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.2px;
          color: #F0F0FF;
        }
        .vs-sb-nav {
          flex: 1;
          overflow-y: auto;
          padding: 10px 8px;
          scrollbar-width: none;
        }
        .vs-sb-nav::-webkit-scrollbar { display: none; }
        .vs-group-lbl {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: #5A5A80;
          padding: 10px 8px 6px;
        }
        .vs-sb-link {
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
        .vs-sb-link:hover {
          background: #0E0E20;
          color: #F0F0FF;
        }
        .vs-sb-link--active {
          background: rgba(139,92,246,.1);
          border-color: rgba(139,92,246,.18);
          color: #F0F0FF;
        }
        .vs-sb-link--active:hover {
          background: rgba(139,92,246,.15);
        }
        .vs-sb-ico { font-size: 15px; width: 20px; text-align: center; flex-shrink: 0; }
        .vs-sb-lbl { flex: 1; }
        .vs-sb-badge {
          margin-left: auto;
          background: rgba(139,92,246,.15);
          color: #8B5CF6;
          font-size: 10px;
          font-weight: 700;
          padding: 1px 7px;
          border-radius: 99px;
        }
        .vs-sb-link--soon { opacity: 0.5; cursor: default; }
        .vs-sb-link--soon:hover { background: transparent; color: #7878A0; }
        .vs-sb-badge--soon {
          background: rgba(255,255,255,.05);
          color: #5A5A80;
          font-size: 9px;
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .vs-sb-foot {
          border-top: 1px solid #1E1E3A;
          padding: 12px;
          flex-shrink: 0;
        }
        .vs-credits-box {
          background: #0E0E20;
          border: 1px solid #1E1E3A;
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 10px;
        }
        .vs-user-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 6px 2px;
          /* Display-only (no click handler) — don't advertise clickability */
          cursor: default;
        }

        @media (max-width: 900px) {
          .vs-sidebar {
            width: 100% !important;
            height: auto !important;
            border-right: none !important;
            border-bottom: 1px solid #1E1E3A;
            flex-direction: column;
          }
          .vs-sb-nav {
            display: flex !important;
            flex-direction: row !important;
            overflow-x: auto !important;
            overflow-y: hidden !important;
            padding: 8px !important;
            gap: 4px;
          }
          .vs-group-lbl { display: none !important; }
          .vs-sb-link {
            flex-shrink: 0;
            white-space: nowrap;
            margin: 0 !important;
          }
          .vs-sb-badge { display: none !important; }
          .vs-sb-foot {
            display: flex !important;
            flex-direction: row !important;
            align-items: center !important;
            gap: 10px;
            padding: 10px 12px !important;
          }
          .vs-credits-box { flex: 1; margin-bottom: 0 !important; }
          .vs-uinfo { display: none !important; }
        }
      `}</style>
    </>
  )
}
