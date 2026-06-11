'use client'

import Link from 'next/link'
import { LogoMark } from '@/components/ui/Logo'

const TOOLS = [
  { emoji: '🔄', label: 'Voice Swap', href: '/voice-swap', active: false },
  { emoji: '🧬', label: 'Voice Lab', href: '/voice-lab', active: true },
  { emoji: '✂️', label: 'Stem Studio', href: '#', active: false },
  { emoji: '🎼', label: 'Choir Composer', href: '#', active: false },
  { emoji: '🎷', label: 'Instruments', href: '#', active: false },
  { emoji: '🎵', label: 'Song Studio', href: '#', active: false },
]

const LIBRARY = [
  { emoji: '🎙️', label: 'My Voices', badge: '3' },
  { emoji: '📁', label: 'Projects', badge: '' },
  { emoji: '🛒', label: 'Marketplace', badge: '' },
]

interface VLSidebarProps {
  onToast: (msg: string) => void
}

export function VLSidebar({ onToast }: VLSidebarProps) {
  return (
    <>
      <aside className="vls-sidebar">
        <div className="vls-logo-row">
          <LogoMark size={34} />
          <span className="vls-wordmark">
            Mausam<em className="grad-text" style={{ fontStyle: 'normal' }}>Vox</em>
          </span>
        </div>

        <nav className="vls-nav">
          <div className="vls-group-lbl">Tools</div>
          {TOOLS.map((item) =>
            item.active ? (
              <Link key={item.href} href={item.href} className="vls-link vls-link--active">
                <span className="vls-ico">{item.emoji}</span>
                <span className="vls-lbl">{item.label}</span>
              </Link>
            ) : (
              <div
                key={item.label}
                className="vls-link"
                onClick={() => onToast(item.label + (item.href === '/voice-swap' ? '' : ' — coming soon'))}
              >
                <span className="vls-ico">{item.emoji}</span>
                <span className="vls-lbl">{item.label}</span>
              </div>
            )
          )}

          <div className="vls-group-lbl">Library</div>
          {LIBRARY.map((item) => (
            <div key={item.label} className="vls-link" onClick={() => onToast(item.label + ' — coming soon')}>
              <span className="vls-ico">{item.emoji}</span>
              <span className="vls-lbl">{item.label}</span>
              {item.badge && <span className="vls-badge">{item.badge}</span>}
            </div>
          ))}
        </nav>

        <div className="vls-foot">
          <div className="vls-credits-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', color: '#5A5A80' }}>Credits</span>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#C4C4E0' }}>20,400 / 30,000</span>
            </div>
            <div style={{ height: '4px', background: '#1E1E3A', borderRadius: '2px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '68%', borderRadius: '2px', background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)' }} />
            </div>
          </div>

          <div className="vls-user-row">
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff', flexShrink: 0 }}>M</div>
            <div className="vls-uinfo">
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#C4C4E0' }}>Mausam</div>
              <div style={{ fontSize: '11px', color: '#5A5A80' }}>Pro Plan</div>
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
          cursor: pointer;
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
