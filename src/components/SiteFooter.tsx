'use client'

import { usePathname } from 'next/navigation'
import { SUPPORT_EMAIL } from '@/components/legal/LegalPage'

// Slim legal footer on every page (Paddle's review wants Terms / Privacy / Refund reachable
// from anywhere). The landing page and the legal pages draw their own fuller footers, and the
// internal dsp-test pages don't need one. In the 100vh app shells it sits just below the fold.
const OWN_FOOTER = ['/', '/terms', '/privacy', '/refund']

export function SiteFooter() {
  const path = usePathname() ?? '/'
  if (OWN_FOOTER.includes(path) || path.startsWith('/dsp-test')) return null
  return (
    <footer className="sf">
      <span>© 2026 MausamVox by MausamLabs</span>
      <nav className="sf-links">
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
        <a href="/refund">Refund</a>
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
      </nav>
      <style suppressHydrationWarning>{`
        .sf {
          display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
          gap: 8px 20px; padding: 14px 24px; border-top: 1px solid #1C1C38;
          background: #05050F; font-size: 12px; color: #8A8AB0;
        }
        .sf-links { display: flex; flex-wrap: wrap; gap: 8px 18px; }
        .sf a { color: #8A8AB0; text-decoration: none; }
        .sf a:hover { color: #F0F0FF; }
        @media (max-width: 640px) { .sf { padding: 14px 16px; } }
      `}</style>
    </footer>
  )
}
