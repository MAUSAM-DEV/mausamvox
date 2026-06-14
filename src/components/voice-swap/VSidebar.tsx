'use client'

import Link from 'next/link'
import { LogoMark } from '@/components/ui/Logo'

const TOOLS = [
  { emoji: '🔄', label: 'Voice Swap', href: '/voice-swap', active: true },
  { emoji: '🧬', label: 'Voice Lab', href: '/voice-lab', active: false },
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

interface VSidebarProps {
  onToast: (msg: string) => void
}

export function VSidebar({ onToast }: VSidebarProps) {
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
            item.active ? (
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
              <div
                key={item.label}
                className="vs-sb-link"
                onClick={() => onToast(item.label + ' — coming soon')}
              >
                <span className="vs-sb-ico">{item.emoji}</span>
                <span className="vs-sb-lbl">{item.label}</span>
              </div>
            )
          )}

          <div className="vs-group-lbl">Library</div>
          {LIBRARY.map((item) => (
            <div key={item.label} className="vs-sb-link" onClick={() => onToast(item.label + ' — coming soon')}>
              <span className="vs-sb-ico">{item.emoji}</span>
              <span className="vs-sb-lbl">{item.label}</span>
              {item.badge && <span className="vs-sb-badge">{item.badge}</span>}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="vs-sb-foot">
          <div className="vs-credits-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '11px', color: '#5A5A80' }}>Credits</span>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#C4C4E0' }}>20,400 / 30,000</span>
            </div>
            <div style={{ height: '4px', background: '#1E1E3A', borderRadius: '2px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: '68%',
                  borderRadius: '2px',
                  background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)',
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
              M
            </div>
            <div className="vs-uinfo">
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#C4C4E0' }}>Mausam</div>
              <div style={{ fontSize: '11px', color: '#5A5A80' }}>Pro Plan</div>
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
          cursor: pointer;
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
