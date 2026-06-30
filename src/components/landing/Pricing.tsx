'use client'

import Link from 'next/link'
import { useReveal } from './useReveal'

type PlanFeature = { text: string; dim?: boolean }

interface Plan {
  tier: string
  price: string
  currency?: string
  period?: string
  india?: string
  desc: string
  features: PlanFeature[]
  btnLabel: string
  btnVariant: 'ghost' | 'solid'
  popular?: boolean
}

const plans: Plan[] = [
  {
    tier: 'Free',
    price: '$0',
    desc: 'Try before you buy',
    features: [
      { text: '500 credits' },
      { text: '1 watermarked swap' },
      { text: '1 express voice clone' },
      { text: '4-stem split' },
      { text: 'No HD quality', dim: true },
      { text: 'No SATB choir', dim: true },
    ],
    btnLabel: 'Start Free',
    btnVariant: 'ghost',
  },
  {
    tier: 'Starter',
    price: '9',
    currency: '$',
    period: '/mo',
    india: 'Also ₹499/mo India',
    desc: 'Also ₹499/mo India',
    features: [
      { text: '8,000 credits/month' },
      { text: 'Unlimited voice swaps' },
      { text: '1 studio clone/month' },
      { text: '4-stem split + BPM/key' },
      { text: 'Standard quality' },
      { text: 'No SATB choir', dim: true },
    ],
    btnLabel: 'Get Starter',
    btnVariant: 'ghost',
  },
  {
    tier: 'Pro',
    price: '24',
    currency: '$',
    period: '/mo',
    india: 'Also ₹999/mo India',
    desc: 'Also ₹999/mo India',
    features: [
      { text: '30,000 credits/month' },
      { text: 'Unlimited HD swaps' },
      { text: '3 studio clones/month' },
      { text: 'SATB choir + sheet music' },
      { text: 'Style marketplace' },
      { text: '50+ instrument engine' },
    ],
    btnLabel: 'Get Pro',
    btnVariant: 'solid',
    popular: true,
  },
  {
    tier: 'Studio',
    price: '59',
    currency: '$',
    period: '/mo',
    india: 'Also ₹2,499/mo India',
    desc: 'Also ₹2,499/mo India',
    features: [
      { text: 'Unlimited credits' },
      { text: '10 studio clones/month' },
      { text: 'API access' },
      { text: 'DAW plugin (VST/AU)' },
      { text: 'Priority GPU queue' },
      { text: 'Team workspace' },
    ],
    btnLabel: 'Get Studio',
    btnVariant: 'ghost',
  },
]

export function Pricing() {
  const { ref, visible } = useReveal()

  return (
    <section
      id="pricing"
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
        Pricing
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
        Simple, honest pricing.<br />Global &amp; India tiers.
      </h2>
      <p style={{ fontSize: '16px', color: '#606088', maxWidth: '480px', lineHeight: 1.75 }}>
        Prorated upgrades. 7-day refund. UPI + card support. No surprises.
      </p>

      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginTop: '64px' }}
        className="pricing-grid"
      >
        {plans.map((plan) => (
          <PriceCard key={plan.tier} plan={plan} />
        ))}
      </div>

      <style>{`
        @media (max-width: 1024px) { .pricing-grid { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (max-width: 600px)  { .pricing-grid { grid-template-columns: 1fr !important; } }
      `}</style>
    </section>
  )
}

function PriceCard({ plan }: { plan: Plan }) {
  return (
    <div
      style={{
        background: '#13132A',
        border: plan.popular ? 'none' : '1px solid #1E1E3A',
        borderRadius: '16px',
        padding: '32px 28px',
        transition: 'transform 0.3s',
        position: 'relative',
        ...(plan.popular
          ? {
              background: 'linear-gradient(#13132A, #13132A) padding-box, linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4) border-box',
              border: '1px solid transparent',
            }
          : {}),
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-4px)' }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = '' }}
    >
      {plan.popular && (
        <div
          style={{
            position: 'absolute',
            top: '-13px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '4px 16px',
            borderRadius: '999px',
            background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)',
            color: '#fff',
            fontSize: '10px',
            fontWeight: 700,
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          }}
        >
          Most Popular
        </div>
      )}

      <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '3px', textTransform: 'uppercase', color: '#606088', marginBottom: '16px' }}>
        {plan.tier}
      </div>

      {plan.currency ? (
        <div
          style={{
            fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
            fontSize: '52px',
            fontWeight: 700,
            letterSpacing: '-2px',
            lineHeight: 1,
            color: '#F0F0FF',
          }}
        >
          <sup style={{ fontSize: '22px', verticalAlign: 'super', letterSpacing: 0 }}>{plan.currency}</sup>
          {plan.price}
          <sub style={{ fontSize: '14px', fontFamily: 'Inter, sans-serif', fontWeight: 400, color: '#606088', letterSpacing: 0 }}>
            {plan.period}
          </sub>
        </div>
      ) : (
        <div
          style={{
            fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
            fontSize: '52px',
            fontWeight: 700,
            letterSpacing: '-2px',
            lineHeight: 1,
            color: '#F0F0FF',
          }}
        >
          {plan.price}
        </div>
      )}

      {plan.india && (
        <div style={{ fontSize: '13px', color: '#606088', marginTop: '6px', marginBottom: '20px' }}>
          {plan.india}
        </div>
      )}
      {!plan.india && (
        <div style={{ fontSize: '13px', color: '#606088', marginTop: '6px', marginBottom: '20px' }}>
          Try before you buy
        </div>
      )}

      <div style={{ height: '1px', background: '#1E1E3A', margin: '18px 0' }} />

      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '9px' }}>
        {plan.features.map((f) => (
          <li
            key={f.text}
            style={{
              fontSize: '13px',
              color: f.dim ? '#606088' : '#C8C8E8',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
            }}
          >
            <span style={{ color: f.dim ? '#1E1E3A' : '#8B5CF6', fontWeight: 700, flexShrink: 0, marginTop: '1px' }}>
              {f.dim ? '–' : '✓'}
            </span>
            {f.text}
          </li>
        ))}
      </ul>

      <Link
        href="/auth/sign-up"
        style={{
          display: 'block',
          width: '100%',
          marginTop: '24px',
          padding: '12px',
          borderRadius: '8px',
          fontFamily: 'var(--font-grotesk), "Space Grotesk", sans-serif',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'all 0.25s',
          letterSpacing: '0.2px',
          textAlign: 'center',
          textDecoration: 'none',
          boxSizing: 'border-box',
          ...(plan.btnVariant === 'solid'
            ? {
                border: 'none',
                background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)',
                color: '#fff',
              }
            : {
                background: 'transparent',
                color: '#F0F0FF',
                border: '1px solid #2A2A4A',
              }),
        }}
        onMouseEnter={(e) => {
          if (plan.btnVariant === 'solid') {
            e.currentTarget.style.boxShadow = '0 10px 30px rgba(139,92,246,.4)'
            e.currentTarget.style.transform = 'translateY(-1px)'
          } else {
            e.currentTarget.style.borderColor = '#8B5CF6'
            e.currentTarget.style.color = '#8B5CF6'
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = ''
          e.currentTarget.style.transform = ''
          if (plan.btnVariant === 'ghost') {
            e.currentTarget.style.borderColor = '#2A2A4A'
            e.currentTarget.style.color = '#F0F0FF'
          }
        }}
      >
        {plan.btnLabel}
      </Link>
    </div>
  )
}
