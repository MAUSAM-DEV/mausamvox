'use client'

import { useReveal } from './useReveal'

const testimonials = [
  {
    quote:
      '"The gender lock alone changed everything. I asked for a male vocal — I got a male vocal. Sounds obvious, but I\'ve tried four other platforms where the AI just ignores you."',
    avatar: '🎤',
    name: 'Priya Nair',
    role: 'Singer-Songwriter · Chennai',
  },
  {
    quote:
      '"The 30-second preview before spending credits is the smartest thing any voice platform has done. I know exactly what I\'m getting before it costs me anything."',
    avatar: '🎧',
    name: 'Marcus Lin',
    role: 'Bedroom Producer · Singapore',
  },
  {
    quote:
      '"SATB choir with 4 separate stems. As a film composer, that sentence is everything. I used to spend 3 days building choir sessions in Logic — now it takes 20 minutes."',
    avatar: '🎬',
    name: 'Sarah Okonkwo',
    role: 'Film Composer · Lagos',
  },
]

export function Testimonials() {
  const { ref, visible } = useReveal()

  return (
    <section
      ref={ref as React.Ref<HTMLElement>}
      className="sec-responsive"
      style={{
        maxWidth: '1240px',
        margin: '0 auto',
        padding: '0 48px 96px',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(26px)',
        transition: 'opacity 0.65s ease, transform 0.65s ease',
      }}
    >
      <div className="grad-text" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '18px', display: 'inline-block' }}>
        Beta Creators
      </div>
      <h2
        style={{
          fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
          fontSize: 'clamp(38px, 5vw, 62px)',
          fontWeight: 700,
          letterSpacing: '-2px',
          lineHeight: 1.05,
          color: '#F0F0FF',
          marginBottom: '64px',
        }}
      >
        What creators say.
      </h2>

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}
        className="testi-grid"
      >
        {testimonials.map((t) => (
          <TestiCard key={t.name} {...t} />
        ))}
      </div>

      <style>{`
        @media (max-width: 1024px) { .testi-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </section>
  )
}

function TestiCard({ quote, avatar, name, role }: { quote: string; avatar: string; name: string; role: string }) {
  return (
    <div
      style={{
        background: '#13132A',
        border: '1px solid #1E1E3A',
        borderRadius: '16px',
        padding: '32px',
        transition: 'border-color 0.3s, transform 0.3s',
        cursor: 'default',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(139,92,246,.3)'
        e.currentTarget.style.transform = 'translateY(-3px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#1E1E3A'
        e.currentTarget.style.transform = ''
      }}
    >
      {/* Stars */}
      <div style={{ display: 'flex', gap: '3px', marginBottom: '16px' }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            style={{
              width: '16px',
              height: '16px',
              background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)',
              WebkitMask: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'/%3E%3C/svg%3E\") center/contain no-repeat",
              mask: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 24 24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'/%3E%3C/svg%3E\") center/contain no-repeat",
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
        ))}
      </div>

      <p
        style={{
          fontSize: '14px',
          lineHeight: 1.75,
          color: '#C8C8E8',
          fontStyle: 'italic',
          marginBottom: '20px',
        }}
      >
        {quote}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            flexShrink: 0,
          }}
        >
          {avatar}
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif', fontSize: '13px', fontWeight: 600, color: '#F0F0FF' }}>
            {name}
          </div>
          <div style={{ fontSize: '11px', color: '#606088', marginTop: '1px' }}>{role}</div>
        </div>
      </div>
    </div>
  )
}
