'use client'

import type { Persona } from './OnboardingPage'

interface PersonaScreenProps {
  onPick: (p: Persona) => void
}

const PERSONAS: { id: Persona; emoji: string; name: string; desc: string; cta: string }[] = [
  {
    id: 'artist',
    emoji: '🎤',
    name: "I'm a Singer",
    desc: 'Clone your voice and hear yourself on professionally produced tracks.',
    cta: 'Clone my voice →',
  },
  {
    id: 'producer',
    emoji: '🎧',
    name: "I'm a Producer",
    desc: 'Add pro-quality vocals to your beats without hiring a singer.',
    cta: 'Voice my beat →',
  },
  {
    id: 'creator',
    emoji: '📱',
    name: 'I Make Content',
    desc: 'Generate scroll-stopping vocal styles for Reels, Shorts, and videos.',
    cta: 'Make something viral →',
  },
]

export function PersonaScreen({ onPick }: PersonaScreenProps) {
  return (
    <>
      <div className="ob-screen ob-sc-center">
        <div className="ob-eyebrow">Welcome to MausamVox</div>
        <h1 className="ob-h1">
          What brings you here,<br />
          <span className="ob-gt">creator</span>?
        </h1>
        <p className="ob-sub">
          We&apos;ll set you up with the perfect first experience — your first result is less than 3
          minutes away.
        </p>

        <div className="obp-grid">
          {PERSONAS.map(p => (
            <div key={p.id} className="obp-card" onClick={() => onPick(p.id)}>
              <div className="obp-emoji">{p.emoji}</div>
              <div className="obp-name">{p.name}</div>
              <div className="obp-desc">{p.desc}</div>
              <div className="obp-cta">{p.cta}</div>
            </div>
          ))}
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .obp-grid {
          display: grid; grid-template-columns: repeat(3, 1fr);
          gap: 14px; max-width: 860px; margin: 0 auto;
        }
        .obp-card {
          background: #121225; border: 1px solid #1E1E3A; border-radius: 16px;
          padding: 30px 24px; cursor: pointer; transition: all .28s;
          position: relative; overflow: hidden; text-align: left;
        }
        .obp-card::before {
          content: ''; position: absolute; inset: 0;
          background: radial-gradient(ellipse at 50% 0%, rgba(139,92,246,.1), transparent 65%);
          opacity: 0; transition: opacity .3s;
        }
        .obp-card:hover {
          border-color: rgba(139,92,246,.45); transform: translateY(-5px);
          box-shadow: 0 18px 44px rgba(139,92,246,.12);
        }
        .obp-card:hover::before { opacity: 1; }
        .obp-emoji {
          width: 54px; height: 54px; border-radius: 15px; margin-bottom: 18px;
          background: rgba(139,92,246,.1); border: 1px solid rgba(139,92,246,.2);
          display: flex; align-items: center; justify-content: center; font-size: 25px;
          transition: transform .3s;
        }
        .obp-card:hover .obp-emoji { transform: scale(1.1) rotate(-4deg); }
        .obp-name {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 18px; font-weight: 600; color: #F0F0FF; margin-bottom: 6px;
        }
        .obp-desc { font-size: 12px; color: #5A5A80; line-height: 1.65; margin-bottom: 16px; }
        .obp-cta {
          font-size: 12px; font-weight: 600;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        @media (max-width: 760px) {
          .obp-grid { grid-template-columns: 1fr; }
          .obp-card { padding: 22px 18px; }
          .obp-emoji { width: 46px; height: 46px; font-size: 21px; margin-bottom: 12px; }
        }
      `}</style>
    </>
  )
}
