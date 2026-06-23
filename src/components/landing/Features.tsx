'use client'

import { useReveal } from './useReveal'

const features = [
  {
    icon: '🔄',
    title: 'Precision Voice Swap',
    desc: 'Replace any song\'s vocals with your cloned voice. Full gender lock, age range, accent selector, and style intensity slider. The AI actually follows your instructions. See a 30-second preview before spending any credits.',
    pills: ['Gender Lock', 'Accent Selector', '30-sec Preview', 'Quality Score', 'A/B Compare', 'Free Regenerate'],
    tag: 'Core Feature',
    tagType: 'v',
    wide: true,
  },
  {
    icon: '🧬',
    title: 'Voice Lab',
    desc: 'Guided recording wizard with real-time mic quality feedback. Live training meter — no blind waits. Express clone in 3 minutes. Studio clone from 10-min audio.',
    tag: 'Express + Studio',
    tagType: 'v',
  },
  {
    icon: '✂️',
    title: 'Smart Stem Studio',
    desc: '6-stem separation, tuned for clean isolation even on dense mixes. BPM and key detection. In-browser per-stem editing. Smart file naming.',
    tag: '6 Stems · Studio Engine',
    tagType: 'c',
  },
  {
    icon: '🎼',
    title: 'Choir Composer Pro',
    desc: 'True SATB polyphonic output — 4 separate stems. Piano roll melody input, full song lyrics, live preview, and sheet music PDF export.',
    tag: 'SATB · 4 Stems',
    tagType: 'p',
  },
  {
    icon: '🎷',
    title: 'Vocal Instrument Engine',
    desc: '50+ instruments — sax, violin, sitar, synth. Articulation control (legato, staccato, vibrato). Blend two instruments into one output.',
    tag: '50+ Instruments',
    tagType: 'c',
  },
  {
    icon: '🎵',
    title: 'Song Studio',
    desc: 'Text prompt → full song with timeline editor. Set structure, key, tempo. Hum your melody in. 3 variations per generation — pick the best.',
    tag: 'AI Song Gen',
    tagType: 'v',
  },
  {
    icon: '📱',
    title: 'Mobile-First Recording + Social Share',
    desc: 'Record, clone, swap, and share — all from your phone. The guided wizard works perfectly on mobile because most creators record on their phones, not studios. After a great result, one-tap share to Instagram Reels, YouTube Shorts, or WhatsApp with a branded waveform card.',
    tag: 'Day One · Mobile',
    tagType: 'g',
    wide: true,
  },
  {
    icon: '🎨',
    title: 'Voice Style Marketplace',
    desc: 'Discover styles by genre, mood, language. 30-second preview. Creators earn royalties when others use their styles.',
    tag: 'Creator Revenue',
    tagType: 'p',
  },
  {
    icon: '👥',
    title: 'Team Workspace',
    desc: 'Role-based collaboration — View, Use, Remix, Admin. Activity logs, version history, comment threads on every asset.',
    tag: 'Collaborate',
    tagType: 'v',
  },
]

const tagColors: Record<string, { bg: string; color: string; border: string }> = {
  v: { bg: 'rgba(139,92,246,.1)',  color: '#8B5CF6', border: 'rgba(139,92,246,.2)' },
  c: { bg: 'rgba(6,182,212,.08)',  color: '#06B6D4', border: 'rgba(6,182,212,.2)'  },
  p: { bg: 'rgba(236,72,153,.08)', color: '#EC4899', border: 'rgba(236,72,153,.2)' },
  g: { bg: 'rgba(16,185,129,.08)', color: '#10B981', border: 'rgba(16,185,129,.2)' },
}

export function Features() {
  const { ref, visible } = useReveal()

  return (
    <section
      id="features"
      ref={ref as React.Ref<HTMLElement>}
      className="sec-responsive"
      style={{
        maxWidth: '1240px',
        margin: '0 auto',
        padding: '96px 48px',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(26px)',
        transition: 'opacity 0.65s ease, transform 0.65s ease',
      }}
    >
      <div className="grad-text" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '18px', display: 'inline-block' }}>
        Platform Features
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
        Everything you need<br />to own your sound.
      </h2>
      <p style={{ fontSize: '16px', color: '#606088', maxWidth: '480px', lineHeight: 1.75 }}>
        10 professional-grade tools built with quality controls, honest previews, and global language support.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '2px',
          marginTop: '64px',
          borderRadius: '20px',
          overflow: 'hidden',
        }}
        className="feat-grid"
      >
        {features.map((f, i) => (
          <FeatureCard key={i} {...f} />
        ))}
      </div>

      <style>{`
        @media (max-width: 1024px) {
          .feat-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .feat-card-wide { grid-column: span 1 !important; }
        }
        @media (max-width: 600px) {
          .feat-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  )
}

function FeatureCard({
  icon, title, desc, pills, tag, tagType, wide,
}: {
  icon: string
  title: string
  desc: string
  pills?: string[]
  tag: string
  tagType: string
  wide?: boolean
}) {
  const tc = tagColors[tagType]

  return (
    <div
      className={wide ? 'feat-card-wide' : ''}
      style={{
        gridColumn: wide ? 'span 2' : 'span 1',
        background: '#13132A',
        padding: '40px 36px',
        position: 'relative',
        transition: 'background 0.3s, box-shadow 0.3s',
        cursor: 'default',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = '#0F0F22'
        e.currentTarget.style.boxShadow = 'inset 0 0 0 1px rgba(139,92,246,.35)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = '#13132A'
        e.currentTarget.style.boxShadow = ''
      }}
    >
      <div
        style={{
          width: '52px',
          height: '52px',
          borderRadius: '14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '22px',
          marginBottom: '22px',
          background: 'rgba(139,92,246,.1)',
          border: '1px solid rgba(139,92,246,.18)',
        }}
      >
        {icon}
      </div>
      <h3
        style={{
          fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
          fontSize: '19px',
          fontWeight: 600,
          letterSpacing: '-0.3px',
          color: '#F0F0FF',
          marginBottom: '10px',
        }}
      >
        {title}
      </h3>
      <p style={{ fontSize: '13px', color: '#606088', lineHeight: 1.7 }}>{desc}</p>

      {pills && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '16px' }}>
          {pills.map((p) => (
            <span
              key={p}
              style={{
                padding: '4px 10px',
                borderRadius: '4px',
                background: 'rgba(255,255,255,.04)',
                border: '1px solid #1E1E3A',
                fontSize: '11px',
                color: '#606088',
              }}
            >
              {p}
            </span>
          ))}
        </div>
      )}

      <span
        style={{
          display: 'inline-block',
          marginTop: '18px',
          padding: '3px 11px',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          background: tc.bg,
          color: tc.color,
          border: `1px solid ${tc.border}`,
        }}
      >
        {tag}
      </span>
    </div>
  )
}
