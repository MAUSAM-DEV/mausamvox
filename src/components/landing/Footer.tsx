'use client'

import { LogoFull } from '@/components/ui/Logo'

const footerLinks = ['Privacy', 'Terms', 'Support', 'API Docs', 'Discord', 'Twitter']

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

      <p style={{ fontSize: '12px', color: '#606088' }}>
        © 2026 MausamVox. Any Voice. Any Language. Any Song.
      </p>

      <div style={{ display: 'flex', gap: '24px' }}>
        {footerLinks.map((link) => (
          <a
            key={link}
            href="#"
            style={{
              fontSize: '12px',
              color: '#606088',
              textDecoration: 'none',
              transition: 'color 0.2s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = '#F0F0FF' }}
            onMouseLeave={(e) => { e.currentTarget.style.color = '#606088' }}
          >
            {link}
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
