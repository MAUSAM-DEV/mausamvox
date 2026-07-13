'use client'

import { LogoMark } from '@/components/ui/Logo'

interface OBTopbarProps {
  screen: 1 | 2 | 3 | 4
  onSkip: () => void
}

export function OBTopbar({ screen, onSkip }: OBTopbarProps) {
  return (
    <>
      <div className="obt-strip">
        <div className="obt-logo">
          <LogoMark size={32} />
          <span className="obt-logo-txt">Mausam<em>Vox</em></span>
        </div>
        {screen < 4 && (
          <span className="obt-skip" role="button" onClick={onSkip}>
            Skip for now →
          </span>
        )}
      </div>

      <style suppressHydrationWarning>{`
        .obt-strip {
          width: 100%; max-width: 920px;
          display: flex; align-items: center; justify-content: space-between;
          padding: 22px 0; flex-shrink: 0;
        }
        .obt-logo { display: flex; align-items: center; gap: 10px; }
        .obt-logo-txt {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 18px; font-weight: 700; letter-spacing: -.2px; color: #F0F0FF;
        }
        .obt-logo-txt em {
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          font-style: normal;
        }
        .obt-skip { font-size: 12px; color: #8E8EB4; cursor: pointer; transition: color .2s; }
        .obt-skip:hover { color: #F0F0FF; }
        @media (max-width: 760px) { .obt-strip { padding: 16px 0; } }
      `}</style>
    </>
  )
}
