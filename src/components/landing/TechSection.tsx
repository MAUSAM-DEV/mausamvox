'use client'

import { useReveal } from './useReveal'

const techs = [
  {
    tag: "Voice Clone",
    title: "VoxClone Engine",
    desc: "Train a custom voice from your own samples in 30 seconds to 10 minutes. Supports 12+ languages. Reuse it across every swap.",
    model: "VoxClone · Mausam Studio Engine",
  },
  {
    tag: "Vocal Isolation",
    title: "ClearVoice Engine",
    desc: "Industry-leading vocal separation, tuned for dense mixes and layered harmonies. Fast, near-real-time processing.",
    model: "ClearVoice · Mausam Studio Engine",
  },
  {
    tag: "Full Stem Split",
    title: "StemSplit Engine",
    desc: "Clean 4-stem separation built for production work — vocals, bass, drums, and more, isolated with studio-grade clarity.",
    model: "StemSplit · Mausam Studio Engine",
  },
  {
    tag: "Infrastructure",
    title: "Elastic Compute Grid",
    desc: "Pay-per-second processing. No upfront infrastructure cost. Scales from zero to enterprise without changing the architecture.",
    model: "Elastic Compute Grid",
  },
]

export function TechSection() {
  const { ref, visible } = useReveal()

  return (
    <section
      id="tech"
      ref={ref as React.Ref<HTMLElement>}
      style={{
        background: '#05050F',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(26px)',
        transition: 'opacity 0.65s ease, transform 0.65s ease',
      }}
    >
      <div className="sec-responsive" style={{ maxWidth: '1240px', margin: '0 auto', padding: '96px 48px' }}>
        <div className="grad-text" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', marginBottom: '18px', display: 'inline-block' }}>
          AI Technology
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
          Powered by<br />Mausam Studio Engine.
        </h2>
        <p style={{ fontSize: '16px', color: '#9494BC', maxWidth: '480px', lineHeight: 1.75 }}>
          Built and tuned specifically for vocals — not retrofitted speech models.
        </p>

        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginTop: '64px' }}
          className="tech-grid rv-stagger"
        >
          {techs.map((t) => (
            <TechCard key={t.title} {...t} />
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 1024px) { .tech-grid { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (max-width: 600px)  { .tech-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </section>
  )
}

function TechCard({ tag, title, desc, model }: { tag: string; title: string; desc: string; model: string }) {
  return (
    <div
      style={{
        background: '#13132A',
        border: '1px solid #2E2E56',
        borderRadius: '14px',
        padding: '28px 24px',
        transition: 'border-color 0.3s, transform 0.3s',
        cursor: 'default',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(157,92,255,.3)'
        e.currentTarget.style.transform = 'translateY(-3px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#2E2E56'
        e.currentTarget.style.transform = ''
      }}
    >
      <div className="grad-text" style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '12px', display: 'inline-block' }}>
        {tag}
      </div>
      <h4
        style={{
          fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
          fontSize: '16px',
          fontWeight: 600,
          color: '#F0F0FF',
          marginBottom: '8px',
        }}
      >
        {title}
      </h4>
      <p style={{ fontSize: '12px', color: '#9494BC', lineHeight: 1.65 }}>{desc}</p>
      <span
        style={{
          marginTop: '14px',
          padding: '5px 12px',
          background: 'rgba(157,92,255,.07)',
          border: '1px solid rgba(157,92,255,.18)',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#9D5CFF',
          fontFamily: 'var(--font-grotesk), "Space Grotesk", monospace',
          fontWeight: 600,
          display: 'inline-block',
        }}
      >
        {model}
      </span>
    </div>
  )
}
