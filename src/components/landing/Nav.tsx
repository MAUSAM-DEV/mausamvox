'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { LogoFull } from '@/components/ui/Logo'

const navLinks = [
  { href: '#features', label: 'Features' },
  { href: '#why', label: 'Why Us' },
  { href: '#tech', label: 'Technology' },
  { href: '#pricing', label: 'Pricing' },
]

interface AuthUser {
  name: string
  email: string
  initial: string
}

export function Nav() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
  const [dropOpen, setDropOpen] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user
      if (!u) return
      const name = (u.user_metadata?.full_name ?? u.user_metadata?.name ?? '') as string
      const email = u.email ?? ''
      const display = name || email.split('@')[0]
      setAuthUser({ name: display, email, initial: (display[0] ?? 'U').toUpperCase() })
    })
  }, [])

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [])

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    setAuthUser(null)
    setDropOpen(false)
  }

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

        <ul className="nav-links">
          {navLinks.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#9494BC',
                  textDecoration: 'none',
                  letterSpacing: '0.2px',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#F0F0FF' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#9494BC' }}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        {/* ── Right side: changes based on auth state ── */}
        <div className="nav-btns" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          {authUser ? (
            <>
              {/* Go to Dashboard CTA */}
              <Link
                href="/dashboard"
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8)',
                  color: '#fff',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  letterSpacing: '0.1px',
                  transition: 'all 0.25s',
                  whiteSpace: 'nowrap',
                  textDecoration: 'none',
                  display: 'inline-block',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)'
                  e.currentTarget.style.boxShadow = '0 6px 24px rgba(157,92,255,.4)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = ''
                  e.currentTarget.style.boxShadow = ''
                }}
              >
                Go to Dashboard
              </Link>

              {/* Avatar + dropdown */}
              <div ref={dropRef} style={{ position: 'relative' }}>
                <button
                  className="nav-avatar"
                  onClick={() => setDropOpen((o) => !o)}
                  aria-label="User menu"
                  aria-expanded={dropOpen}
                >
                  {authUser.initial}
                </button>

                {dropOpen && (
                  <div className="nav-drop">
                    <div className="nav-drop-user">
                      <div className="nav-drop-name">{authUser.name}</div>
                      <div className="nav-drop-email">{authUser.email}</div>
                    </div>
                    <div className="nav-drop-sep" />
                    <Link
                      href="/dashboard"
                      className="nav-drop-item"
                      onClick={() => setDropOpen(false)}
                    >
                      Dashboard
                    </Link>
                    <Link
                      href="/voice-swap"
                      className="nav-drop-item"
                      onClick={() => setDropOpen(false)}
                    >
                      Voice Swap
                    </Link>
                    <Link
                      href="/settings"
                      className="nav-drop-item"
                      onClick={() => setDropOpen(false)}
                    >
                      Settings
                    </Link>
                    <div className="nav-drop-sep" />
                    <button className="nav-drop-item nav-drop-out" onClick={handleSignOut}>
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <Link
                href="/auth/sign-in"
                className="nav-signin"
                style={{
                  padding: '8px 18px',
                  borderRadius: '8px',
                  border: '1px solid #3C3C6A',
                  background: 'transparent',
                  color: '#C8C8E8',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  whiteSpace: 'nowrap',
                  textDecoration: 'none',
                  display: 'inline-block',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#9D5CFF'
                  e.currentTarget.style.color = '#F0F0FF'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#3C3C6A'
                  e.currentTarget.style.color = '#C8C8E8'
                }}
              >
                Sign In
              </Link>

              <Link
                href="/auth/sign-up"
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8)',
                  color: '#fff',
                  fontFamily: 'Inter, sans-serif',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  letterSpacing: '0.1px',
                  transition: 'all 0.25s',
                  whiteSpace: 'nowrap',
                  textDecoration: 'none',
                  display: 'inline-block',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px)'
                  e.currentTarget.style.boxShadow = '0 6px 24px rgba(157,92,255,.4)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = ''
                  e.currentTarget.style.boxShadow = ''
                }}
              >
                Try for Free
              </Link>
            </>
          )}
        </div>
      </nav>

      <style>{`
        .site-nav { padding: 0 60px; }
        .nav-links {
          display: none;
          flex-direction: row;
          gap: 36px;
          list-style: none;
          margin: 0;
          padding: 0;
        }
        @media (min-width: 1024px) {
          .nav-links { display: flex; }
        }
        @media (max-width: 1024px) {
          .site-nav { padding: 0 24px; }
        }
        @media (max-width: 400px) {
          .site-nav { padding: 0 14px; }
          .nav-signin { display: none; }
        }

        /* avatar button */
        .nav-avatar {
          width: 34px; height: 34px; border-radius: 50%;
          background: linear-gradient(135deg,#9D5CFF,#F9459E,#0CC7E8);
          color: #fff; font-size: 13px; font-weight: 700;
          border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: transform 0.18s, box-shadow 0.18s;
          flex-shrink: 0;
        }
        .nav-avatar:hover {
          transform: scale(1.07);
          box-shadow: 0 0 0 3px rgba(157,92,255,.3);
        }

        /* dropdown */
        .nav-drop {
          position: absolute; top: calc(100% + 10px); right: 0;
          min-width: 210px;
          background: #0E0E20; border: 1px solid #3C3C6A;
          border-radius: 12px; padding: 6px;
          box-shadow: 0 20px 60px rgba(0,0,0,.7);
          animation: navDropIn 0.15s ease;
          z-index: 400;
        }
        @keyframes navDropIn {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .nav-drop-user { padding: 10px 10px 8px; }
        .nav-drop-name { font-size: 13px; font-weight: 600; color: #F0F0FF; }
        .nav-drop-email {
          font-size: 11px; color: #8E8EB4; margin-top: 2px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .nav-drop-sep { height: 1px; background: #2E2E56; margin: 4px 0; }
        .nav-drop-item {
          display: block; width: 100%;
          padding: 8px 10px; border-radius: 7px;
          font-size: 13px; font-weight: 500; color: #C4C4E0;
          text-decoration: none; cursor: pointer;
          border: none; background: none; text-align: left;
          transition: all 0.15s;
        }
        .nav-drop-item:hover { background: rgba(157,92,255,.1); color: #F0F0FF; }
        .nav-drop-out { color: #F87171 !important; }
        .nav-drop-out:hover { background: rgba(239,68,68,.08) !important; }
      `}</style>
    </>
  )
}
