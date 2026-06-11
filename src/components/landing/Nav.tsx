'use client'

import { LogoFull } from '@/components/ui/Logo'

const navLinks = [
  { href: '#features', label: 'Features' },
  { href: '#why', label: 'Why Us' },
  { href: '#tech', label: 'Technology' },
  { href: '#pricing', label: 'Pricing' },
]

export function Nav() {
  return (
    <>
      <nav
        className="site-nav"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 300,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: '66px',
          background: 'rgba(5,5,15,0.75)',
          backdropFilter: 'blur(28px)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <LogoFull size={38} />

        <ul className="hidden lg:flex gap-9 list-none">
          {navLinks.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#606088',
                  textDecoration: 'none',
                  letterSpacing: '0.2px',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#F0F0FF' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#606088' }}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex gap-[10px] items-center nav-btns">
          <button
            style={{
              padding: '8px 18px',
              borderRadius: '8px',
              border: '1px solid #2A2A4A',
              background: 'transparent',
              color: '#C8C8E8',
              fontFamily: 'Inter, sans-serif',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#8B5CF6'
              e.currentTarget.style.color = '#F0F0FF'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#2A2A4A'
              e.currentTarget.style.color = '#C8C8E8'
            }}
          >
            Sign In
          </button>

          <button
            style={{
              padding: '8px 16px',
              borderRadius: '8px',
              border: 'none',
              background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)',
              color: '#fff',
              fontFamily: 'Inter, sans-serif',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              letterSpacing: '0.1px',
              transition: 'all 0.25s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.boxShadow = '0 6px 24px rgba(139,92,246,.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = ''
              e.currentTarget.style.boxShadow = ''
            }}
          >
            Try for Free
          </button>
        </div>
      </nav>

      <style>{`
        .site-nav { padding: 0 60px; }
        @media (max-width: 1024px) {
          .site-nav { padding: 0 24px; }
        }
        @media (max-width: 400px) {
          .site-nav { padding: 0 14px; }
          .nav-btns button:first-child { display: none; }
        }
      `}</style>
    </>
  )
}
