'use client'

import Link from 'next/link'
import { useReveal } from './useReveal'

export function CtaBand() {
  const { ref, visible } = useReveal()

  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: '#0A0A1A',
        borderTop: '1px solid rgba(255,255,255,.04)',
        borderBottom: '1px solid rgba(255,255,255,.04)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(26px)',
        transition: 'opacity 0.65s ease, transform 0.65s ease',
      }}
    >
      {/* Orb */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '600px',
          height: '300px',
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(157,92,255,.18), rgba(249,69,158,.1) 40%, transparent 70%)',
          filter: 'blur(48px)',
          pointerEvents: 'none',
        }}
      />

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          textAlign: 'center',
          padding: '100px 48px',
        }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
            fontSize: 'clamp(36px, 5vw, 62px)',
            fontWeight: 700,
            letterSpacing: '-2px',
            lineHeight: 1.05,
            color: '#F0F0FF',
            marginBottom: '16px',
          }}
        >
          Your voice.<br />
          <span className="grad-text">Anywhere in the world.</span>
        </h2>
        <p style={{ fontSize: '16px', color: '#9494BC', maxWidth: '440px', margin: '0 auto 40px', lineHeight: 1.7 }}>
          Clone it. Swap it. Share it. Start free — no card needed, no commitment.
        </p>
        <div style={{ display: 'flex', gap: '14px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link
            href="/auth/sign-up"
            style={{
              padding: '15px 38px',
              borderRadius: '10px',
              border: 'none',
              background: 'linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8)',
              color: '#fff',
              fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.28s',
              letterSpacing: '0.2px',
              textDecoration: 'none',
              display: 'inline-block',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 16px 44px rgba(157,92,255,.45)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = ''
              e.currentTarget.style.boxShadow = ''
            }}
          >
            Create Your Voice — Free
          </Link>
          <a
            href="#features"
            style={{
              padding: '14px 34px',
              borderRadius: '10px',
              border: '1px solid #3C3C6A',
              background: 'rgba(255,255,255,.03)',
              color: '#F0F0FF',
              fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
              fontSize: '15px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.28s',
              textDecoration: 'none',
              display: 'inline-block',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(157,92,255,.5)'
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.background = 'rgba(157,92,255,.06)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#3C3C6A'
              e.currentTarget.style.transform = ''
              e.currentTarget.style.background = 'rgba(255,255,255,.03)'
            }}
          >
            See All Features
          </a>
        </div>
      </div>
    </div>
  )
}
