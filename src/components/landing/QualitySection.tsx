'use client'

import { useEffect, useRef, useState } from 'react'
import { useReveal } from './useReveal'

const scoreBars = [
  { label: 'Voice Match',    pct: 94, id: 'b1' },
  { label: 'Pitch Accuracy', pct: 87, id: 'b2' },
  { label: 'Naturalness',    pct: 78, id: 'b3' },
]

export function QualitySection() {
  const { ref, visible } = useReveal()
  const [barsAnimated, setBarsAnimated] = useState(false)

  useEffect(() => {
    if (visible && !barsAnimated) {
      setBarsAnimated(true)
    }
  }, [visible, barsAnimated])

  return (
    <section
      ref={ref as React.Ref<HTMLElement>}
      style={{
        background: '#0A0A1A',
        borderTop: '1px solid rgba(255,255,255,.04)',
        borderBottom: '1px solid rgba(255,255,255,.04)',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(26px)',
        transition: 'opacity 0.65s ease, transform 0.65s ease',
      }}
    >
      <div
        className="sec-responsive quality-inner"
        style={{
          maxWidth: '1240px',
          margin: '0 auto',
          padding: '96px 48px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '80px',
          alignItems: 'center',
        }}
      >
        {/* Text */}
        <div>
          <div className="grad-text" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '18px', display: 'inline-block' }}>
            Quality System
          </div>
          <h2
            style={{
              fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
              fontSize: 'clamp(38px, 5vw, 62px)',
              fontWeight: 700,
              letterSpacing: '-2px',
              lineHeight: 1.05,
              color: '#F0F0FF',
              marginBottom: '16px',
            }}
          >
            You see the score<br />before you download.
          </h2>
          <p style={{ fontSize: '16px', color: '#606088', maxWidth: '420px', lineHeight: 1.75 }}>
            Every output gets a quality confidence score before it reaches you. Not happy with it?
            Regenerate for free — no credit penalty within the 10-minute window.
          </p>
          <div style={{ marginTop: '36px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {[
              'Score shown before every download',
              'Free regeneration if score is below 60',
              'A/B player — compare original vs swapped',
            ].map((item) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px', color: '#C8C8E8' }}>
                <span
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: 'rgba(16,185,129,.12)',
                    border: '1px solid rgba(16,185,129,.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#10B981',
                    fontSize: '12px',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  ✓
                </span>
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* Score card */}
        <div style={{ position: 'relative' }}>
          <div
            style={{
              background: '#13132A',
              border: '1px solid #1E1E3A',
              borderRadius: '20px',
              padding: '32px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '-60px',
                right: '-60px',
                width: '200px',
                height: '200px',
                borderRadius: '50%',
                background: 'radial-gradient(rgba(139,92,246,.15),transparent 70%)',
                pointerEvents: 'none',
              }}
            />
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#606088', marginBottom: '12px' }}>
              Quality Confidence Score
            </div>
            <div
              className="grad-text"
              style={{
                fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
                fontSize: '72px',
                fontWeight: 700,
                letterSpacing: '-3px',
                lineHeight: 1,
              }}
            >
              82
            </div>

            {scoreBars.map((bar, i) => (
              <div key={bar.id} style={{ marginTop: i === 0 ? '20px' : '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#606088', marginBottom: '6px' }}>
                  <span>{bar.label}</span>
                  <span>{bar.pct}%</span>
                </div>
                <div style={{ height: '6px', background: '#1E1E3A', borderRadius: '3px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      borderRadius: '3px',
                      background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)',
                      width: barsAnimated ? `${bar.pct}%` : '0%',
                      transition: `width 1.5s ease ${i * 200}ms`,
                    }}
                  />
                </div>
              </div>
            ))}

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '20px' }}>
              {['✓ Ready to download', '✓ High fidelity'].map((chip) => (
                <span
                  key={chip}
                  style={{
                    padding: '5px 14px',
                    borderRadius: '999px',
                    background: 'rgba(16,185,129,.08)',
                    border: '1px solid rgba(16,185,129,.2)',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#10B981',
                  }}
                >
                  {chip}
                </span>
              ))}
            </div>

            <div
              style={{
                marginTop: '16px',
                padding: '12px 20px',
                background: '#0F0F22',
                border: '1px solid #1E1E3A',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                fontSize: '13px',
                color: '#606088',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M4 4v5h5M20 20v-5h-5" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" />
                <path d="M20 9A8 8 0 0 0 5.66 5.66M4 15a8 8 0 0 0 14.34 3.34" stroke="#8B5CF6" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Score below 60?{' '}
              <strong style={{ color: '#8B5CF6', fontWeight: 600 }}>Regenerate free</strong> within 10 min
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .quality-inner { grid-template-columns: 1fr !important; gap: 48px !important; }
        }
      `}</style>
    </section>
  )
}
