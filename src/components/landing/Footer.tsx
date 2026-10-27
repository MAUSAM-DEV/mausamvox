'use client'

import { LogoFull } from '@/components/ui/Logo'
import { SUPPORT_EMAIL } from '@/components/legal/LegalPage'

// Only links that actually exist — API Docs / Discord / Twitter were removed as dead '#'
// placeholders; re-add each when its destination is real.
const footerLinks = [
  { label: 'Terms', href: '/terms' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Refund', href: '/refund' },
  { label: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}` },
]

export function Footer() {
  return (
    <footer
      style={{
        padding: '40px 60px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '20px',
        borderTop: '1px solid rgba(255,255,255,.04)',
      }}
      className="site-footer sec-responsive"
    >
      <LogoFull size={30} />

      <p style={{ fontSize: '12px', color: '#9494BC' }}>
        © 2026 MausamVox by MausamLabs. Any Voice. Any Language. Any Song.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px' }}>
        {footerLinks.map((link) => (
          <a
            key={link.label}
            href={link.href}
            style={{
              fontSize: '12px',
              color: '#9494BC',
              textDecoration: 'none',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#F0F0FF' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#9494BC' }}
          >
            {link.label}
          </a>
        ))}
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .site-footer {
            padding: 32px 24px !important;
            flex-direction: column;
            align-items: flex-start;
          }
        }
      `}</style>
    </footer>
  )
}
