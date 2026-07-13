'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

function WaveCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const tRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function resize() {
      if (!canvas || !ctx) return
      canvas.width = canvas.offsetWidth * (window.devicePixelRatio || 1)
      canvas.height = canvas.offsetHeight * (window.devicePixelRatio || 1)
      ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1)
    }
    resize()
    window.addEventListener('resize', resize)

    const layers = [
      { amp: 24, f: 0.016, spd: 0.038, alpha: 1,   lw: 2.2, color: 'rgba(157,92,255,' },
      { amp: 15, f: 0.027, spd: 0.062, alpha: 0.55, lw: 1.5, color: 'rgba(249,69,158,' },
      { amp: 9,  f: 0.04,  spd: 0.09,  alpha: 0.3,  lw: 1,   color: 'rgba(12,199,232,' },
    ]

    function frame() {
      if (!canvas || !ctx) return
      const W = canvas.offsetWidth
      const H = canvas.offsetHeight
      ctx.clearRect(0, 0, W, H)

      layers.forEach((l) => {
        ctx.beginPath()
        ctx.lineWidth = l.lw
        ctx.strokeStyle = l.color + l.alpha + ')'
        ctx.shadowColor = l.color + (l.alpha * 0.8) + ')'
        ctx.shadowBlur = 10
        for (let x = 0; x <= W; x += 1.5) {
          const noise = Math.sin(x * 0.09 + tRef.current * 2.1) * 2.5
          const y =
            H / 2 +
            Math.sin(x * l.f + tRef.current * l.spd) * l.amp +
            Math.sin(x * l.f * 2.1 + tRef.current * l.spd * 1.6) * (l.amp * 0.38) +
            noise * 0.5
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.stroke()
        ctx.shadowBlur = 0
      })

      tRef.current += 0.045
      animRef.current = requestAnimationFrame(frame)
    }
    frame()

    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '72px', display: 'block' }}
    />
  )
}

// Only claims that are true TODAY. Removed as over-claims (honesty audit):
// "7-day money back" + "Prorated upgrades" (no billing exists), "Quality score
// on every output" (feature removed), "Live support 24/7" (no support channel).
const trustItems = [
  'Free trial — no card',
  '2 free previews per track',
  'Your voice stays private',
]

export function Hero() {
  return (
    <section
      style={{
        position: 'relative',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '110px 28px 80px',
        overflow: 'hidden',
      }}
    >
      {/* Orb 1 */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -58%)',
          width: '700px',
          height: '700px',
          borderRadius: '50%',
          background:
            'radial-gradient(ellipse at 40% 35%, rgba(157,92,255,.28) 0%, rgba(249,69,158,.18) 35%, rgba(12,199,232,.12) 65%, transparent 80%)',
          filter: 'blur(48px)',
          animation: 'orbPulse 7s ease-in-out infinite',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      {/* Orb 2 */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-42%, -50%)',
          width: '400px',
          height: '400px',
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, rgba(12,199,232,.15) 0%, transparent 70%)',
          filter: 'blur(60px)',
          animation: 'orbPulse 9s 2s ease-in-out infinite reverse',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />
      {/* Grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px)',
          backgroundSize: '72px 72px',
          pointerEvents: 'none',
          zIndex: 0,
          maskImage: 'radial-gradient(ellipse 90% 80% at 50% 50%,black,transparent)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 80% at 50% 50%,black,transparent)',
        }}
      />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {/* Badge */}
        <div
          className="hero-badge"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 16px',
            borderRadius: '999px',
            border: '1px solid rgba(157,92,255,.35)',
            background: 'rgba(157,92,255,.08)',
            fontSize: '11px',
            fontWeight: 600,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            color: '#9D5CFF',
            marginBottom: '36px',
            animation: 'fadeUp 0.6s ease both',
          }}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: '#9D5CFF',
              boxShadow: '0 0 8px #9D5CFF',
              animation: 'blip 2s ease infinite',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          Now in Early Access — Join 12,000+ Creators
        </div>
        <style>{`
          @media (max-width: 600px) {
            .hero-badge { letter-spacing: 0.5px !important; padding: 6px 12px !important; font-size: 10px !important; }
            .hero-h1 { letter-spacing: -2px !important; }
          }
        `}</style>

        {/* Headline */}
        <h1
          className="hero-h1"
          style={{
            fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
            fontSize: 'clamp(52px, 9vw, 108px)',
            fontWeight: 700,
            letterSpacing: '-3px',
            lineHeight: 0.95,
            color: '#F0F0FF',
            marginBottom: '12px',
            animation: 'fadeUp 0.7s 0.08s ease both',
          }}
        >
          Any Voice.<br />
          <span className="grad-text">Any Language.</span><br />
          Any Song.
        </h1>

        {/* Waveform */}
        <div
          style={{
            margin: '44px auto 0',
            width: 'min(680px, 88vw)',
            animation: 'fadeUp 0.7s 0.22s ease both',
          }}
        >
          <WaveCanvas />
          <p
            style={{
              marginTop: '8px',
              fontSize: '10px',
              fontWeight: 600,
              letterSpacing: '2px',
              textTransform: 'uppercase',
              color: 'rgba(157,92,255,.5)',
              textAlign: 'center',
            }}
          >
            Live Voice Preview — See Your Clone In Action
          </p>
        </div>

        {/* Subheadline */}
        <p
          style={{
            fontSize: '18px',
            fontWeight: 300,
            color: '#9494BC',
            maxWidth: '580px',
            margin: '24px auto 0',
            lineHeight: 1.75,
            animation: 'fadeUp 0.7s 0.16s ease both',
          }}
        >
          Clone your voice in minutes. Swap vocals in any song. Build cinematic
          choirs.{' '}
          <strong style={{ color: '#C8C8E8', fontWeight: 500 }}>
            Professional quality — honest controls.
          </strong>
        </p>

        {/* CTA buttons */}
        <div
          style={{
            display: 'flex',
            gap: '14px',
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginTop: '40px',
            animation: 'fadeUp 0.7s 0.28s ease both',
          }}
        >
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
            Start Free — No Card Needed
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
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              textDecoration: 'none',
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
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 11l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            See How It Works
          </a>
        </div>

        {/* Trust row */}
        <div
          style={{
            display: 'flex',
            gap: '24px',
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginTop: '44px',
            animation: 'fadeUp 0.7s 0.34s ease both',
          }}
        >
          {trustItems.map((item) => (
            <TrustChip key={item} label={item} />
          ))}
        </div>
      </div>

      <style>{`
        @keyframes orbPulse {
          0%, 100% { transform: translate(-50%, -58%) scale(1); }
          50% { transform: translate(-50%, -58%) scale(1.08); }
        }
        @keyframes blip {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.7); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(22px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </section>
  )
}

function TrustChip({ label }: { label: string }) {
  return (
    <span
      style={{
        fontSize: '12px',
        fontWeight: 500,
        color: '#9494BC',
        display: 'flex',
        alignItems: 'center',
        gap: '7px',
      }}
    >
      <span
        style={{
          width: '18px',
          height: '18px',
          borderRadius: '50%',
          background: 'rgba(16,185,129,.12)',
          border: '1px solid rgba(16,185,129,.25)',
          color: '#10B981',
          fontSize: '9px',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        ✓
      </span>
      {label}
    </span>
  )
}
