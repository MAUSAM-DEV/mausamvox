'use client'

import type { Persona } from './OnboardingPage'

const FINALE_SUB: Record<Persona, string> = {
  artist:
    'That was a 30-second instant clone. Imagine what a full Studio Clone sounds like.',
  producer:
    "Next: clone your own artist's voice and use it on every beat you make.",
  creator:
    'One-tap share to Reels, Shorts and WhatsApp is now unlocked on your account.',
}

const UNLOCKS = [
  { value: '500', label: 'free credits added' },
  { value: '1',   label: 'free voice swap' },
  { value: '1',   label: 'express clone' },
]

interface FinaleScreenProps {
  persona: Persona
  onToast: (m: string) => void
}

export function FinaleScreen({ persona, onToast }: FinaleScreenProps) {
  return (
    <>
      <div className="ob-screen ob-sc-center">
        <div className="obf-badge">🎉</div>
        <h1 className="ob-h1">
          You&apos;re in, <span className="ob-gt">Mausam</span>.
        </h1>
        <p className="ob-sub">{FINALE_SUB[persona]}</p>

        <div className="obf-unlock-row">
          {UNLOCKS.map(u => (
            <span key={u.label} className="obf-unlock">
              ✓ <b>{u.value}</b> {u.label}
            </span>
          ))}
        </div>

        <div className="ob-btn-row">
          <button
            className="ob-btn-big"
            onClick={() => onToast('Opening your dashboard…')}
          >
            Enter MausamVox
          </button>
          <button
            className="ob-btn-quiet"
            onClick={() => onToast('Opening share card for Reels…')}
          >
            📱 Share my first track
          </button>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .obf-badge {
          width: 84px; height: 84px; border-radius: 50%; margin: 0 auto 22px;
          background: rgba(16,185,129,.08); border: 2px solid rgba(16,185,129,.35);
          display: flex; align-items: center; justify-content: center; font-size: 36px;
          animation: obfPop .55s cubic-bezier(.34,1.56,.64,1);
        }
        @keyframes obfPop {
          from { transform: scale(0) rotate(-20deg); }
          to   { transform: scale(1) rotate(0); }
        }
        .obf-unlock-row {
          display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; margin-bottom: 34px;
        }
        .obf-unlock {
          padding: 8px 16px; border-radius: 99px;
          background: #121225; border: 1px solid #1E1E3A;
          font-size: 12px; color: #C4C4E0; font-weight: 500;
          display: flex; align-items: center; gap: 7px;
        }
        .obf-unlock b { color: #8B5CF6; }
        @media (max-width: 760px) {
          .obf-unlock-row { flex-direction: column; align-items: center; }
        }
      `}</style>
    </>
  )
}
