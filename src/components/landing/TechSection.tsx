'use client'

import { useReveal } from './useReveal'

const techs = [
  {
    tag: 'Voice Clone',
    title: 'GPT-SoVITS v2',
    desc: '1 minute of voice data trains a usable model. Multilingual. 0.028 RTF — processes faster than real time on mid-range hardware.',
    model: 'GPT-SoVITS · Open Source',
  },
  {
    tag: 'Vocal Isolation',
    title: 'BS-RoFormer',
    desc: '2026 SDX leaderboard champion. 95%+ clean vocal isolation. Transformer-based — the same tech powering the best pro tools.',
    model: 'BS-RoFormer · Replicate',
  },
  {
    tag: 'Full Stem Split',
    title: 'HTDemucs FT',
    desc: "Meta's fine-tuned Hybrid Transformer Demucs. The standard for clean 6-stem splits in 2026. Ensemble mode with MDX-Net for dense mixes.",
    model: 'HTDemucs FT · Replicate',
  },
  {
    tag: 'Infrastructure',
    title: 'Replicate + RunPod',
    desc: 'Pay-per-second GPU compute. No upfront infrastructure cost. Scales from zero to enterprise without changing the architecture.',
    model: 'RunPod · Burst GPU',
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
          World-class models.<br />Not just the fastest ones.
        </h2>
        <p style={{ fontSize: '16px', color: '#606088', maxWidth: '480px', lineHeight: 1.75 }}>
          We chose each AI model based on 2026 benchmark results. Here&apos;s exactly what runs under the hood.
        </p>

        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginTop: '64px' }}
          className="tech-grid"
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
        border: '1px solid #1E1E3A',
        borderRadius: '14px',
        padding: '28px 24px',
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
      <p style={{ fontSize: '12px', color: '#606088', lineHeight: 1.65 }}>{desc}</p>
      <span
        style={{
          marginTop: '14px',
          padding: '5px 12px',
          background: 'rgba(139,92,246,.07)',
          border: '1px solid rgba(139,92,246,.18)',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#8B5CF6',
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
