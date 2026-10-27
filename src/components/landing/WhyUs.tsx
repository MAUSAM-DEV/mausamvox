'use client'

import { useReveal } from './useReveal'

const reasons = [
  {
    num: '01',
    title: 'Controls that do what they say',
    desc: 'Pick the song key (or let Auto key fit the song to your range), choose Standard or HD, and on duets lock which singer becomes you. You see the credit cost before anything runs.',
  },
  {
    num: '02',
    title: 'Hear it before you spend a single credit',
    desc: 'Your first preview of every song is free. Hear your voice on the track and A/B it against the original before you pay for the full swap — and if a song has loud group vocals, we tell you where before you start.',
  },
  {
    num: '03',
    title: 'Real people behind the support inbox',
    desc: 'Billing issue, broken output or a question? Email support@mausamvox.com and a person who builds MausamVox answers. If a job fails on our side, its credits come back automatically.',
  },
  {
    num: '04',
    title: 'Fair billing — no nasty surprises',
    desc: 'One-time credit packs — no subscription, nothing renews; credits stay valid for 12 months. An unused pack can be refunded within 14 days. Lower India pricing for the same packs.',
  },
  {
    num: '05',
    title: 'Guided recording = better clones',
    desc: 'The #1 reason clones sound bad is bad input audio. Our wizard gives you real-time mic quality feedback, noise level indicators, and sentence prompts — so your clone starts from the best possible source.',
  },
  {
    num: '06',
    title: 'Global languages — not just English',
    desc: 'Hindi, Spanish, French, Japanese, Korean, Arabic, Tamil, Bengali, and more. Clone and swap voices in 12+ languages. The world makes music in every language — your platform should too.',
  },
]

export function WhyUs() {
  const { ref, visible } = useReveal()

  return (
    <section
      id="why"
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
        Why MausamVox
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
        Built differently.<br />From the ground up.
      </h2>
      <p style={{ fontSize: '16px', color: '#9494BC', maxWidth: '480px', lineHeight: 1.75 }}>
        We obsessed over the things other platforms got wrong — and made each one a core feature.
      </p>

      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '64px' }}
        className="why-grid rv-stagger"
      >
        {reasons.map((r) => (
          <WhyCard key={r.num} {...r} />
        ))}
      </div>

      <style>{`
        @media (max-width: 1024px) { .why-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </section>
  )
}

function WhyCard({ num, title, desc }: { num: string; title: string; desc: string }) {
  return (
    <div
      style={{
        background: '#13132A',
        border: '1px solid #2E2E56',
        borderRadius: '16px',
        padding: '36px 32px',
        display: 'flex',
        gap: '20px',
        alignItems: 'flex-start',
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
      <span
        className="grad-text"
        style={{
          fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
          fontSize: '42px',
          fontWeight: 700,
          letterSpacing: '-2px',
          flexShrink: 0,
          lineHeight: 1,
          marginTop: '2px',
        }}
      >
        {num}
      </span>
      <div>
        <h3
          style={{
            fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
            fontSize: '17px',
            fontWeight: 600,
            color: '#F0F0FF',
            marginBottom: '8px',
            letterSpacing: '-0.2px',
          }}
        >
          {title}
        </h3>
        <p style={{ fontSize: '13px', color: '#9494BC', lineHeight: 1.7 }}>{desc}</p>
      </div>
    </div>
  )
}
