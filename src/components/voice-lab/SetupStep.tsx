'use client'

type CloneType = 'express' | 'studio'

interface SetupStepProps {
  cloneType: CloneType
  setCloneType: (t: CloneType) => void
}

const EXPRESS_FEATS = [
  { text: 'Instant — no training wait', dim: false },
  { text: 'Lower cost per clone', dim: false },
  { text: 'Great for quick tests', dim: false },
  { text: 'Standard fidelity only', dim: true },
  { text: 'Coming soon', dim: true },
]

const STUDIO_FEATS = [
  { text: '10–30 minutes of recording', dim: false },
  { text: 'HD fidelity — release ready', dim: false },
  { text: 'Commercial use cleared', dim: false },
  { text: 'Multilingual singing', dim: false },
  { text: '3 per month on Pro plan', dim: false },
]

export function SetupStep({ cloneType, setCloneType }: SetupStepProps) {
  return (
    <>
      <div className="vlst-grid">
        {([
          { id: 'studio' as CloneType, icon: '🎙️', name: 'Studio Clone', time: '10+ min audio · Ready in ~45 minutes', desc: 'Full production-quality clone that trains a real model on your voice — capturing your tone, vibrato, and emotional range. For releases and commercial work.', feats: STUDIO_FEATS, soon: false },
          { id: 'express' as CloneType, icon: '⚡', name: 'Express Clone', time: 'Instant zero-shot clone', desc: 'A fast, lower-fidelity clone with no training wait — perfect for quickly testing how your voice sounds.', feats: EXPRESS_FEATS, soon: true },
        ]).map((card) => (
          <div
            key={card.id}
            className={`vlst-card${cloneType === card.id ? ' vlst-card--on' : ''}${card.soon ? ' vlst-card--soon' : ''}`}
            onClick={() => { if (!card.soon) setCloneType(card.id) }}
            aria-disabled={card.soon}
          >
            {card.soon && <span className="vlst-soon-badge">Coming soon</span>}
            <div className="vlst-icon">{card.icon}</div>
            <div className="vlst-name">{card.name}</div>
            <div className="vlst-time">{card.time}</div>
            <p className="vlst-desc">{card.desc}</p>
            <ul className="vlst-feats">
              {card.feats.map((f) => (
                <li key={f.text} className={f.dim ? 'vlst-feat-dim' : ''}>{f.text}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="vlst-tip">
        <span className="vlst-tip-ico">💡</span>
        <span className="vlst-tip-txt">
          <b>Pro tip:</b> Record in a quiet room with soft furnishings, keep the mic 15–20cm from your mouth, and sing naturally. The wizard checks your audio quality in real time — it will warn you before bad audio ruins a clone.
        </span>
      </div>

      <style suppressHydrationWarning>{`
        .vlst-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          animation: vlFadeUp 0.3s ease;
        }
        @keyframes vlFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .vlst-card {
          background: #121225;
          border: 1px solid #1E1E3A;
          border-radius: 14px;
          padding: 28px 24px;
          cursor: pointer;
          transition: all 0.25s;
          position: relative;
          overflow: hidden;
        }
        .vlst-card::before {
          content: '';
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at 50% 0%, rgba(139,92,246,.08), transparent 60%);
          opacity: 0;
          transition: opacity 0.3s;
        }
        .vlst-card:hover { border-color: rgba(139,92,246,.35); transform: translateY(-3px); }
        .vlst-card:hover::before { opacity: 1; }
        .vlst-card--on { border-color: #8B5CF6 !important; background: rgba(139,92,246,.05) !important; }
        .vlst-card--on::after {
          content: '✓ Selected';
          position: absolute;
          top: 14px; right: 14px;
          font-size: 10px; font-weight: 700; color: #8B5CF6;
          padding: 3px 10px;
          border-radius: 99px;
          background: rgba(139,92,246,.12);
          border: 1px solid rgba(139,92,246,.25);
        }
        .vlst-card--soon {
          cursor: not-allowed;
          opacity: 0.55;
        }
        .vlst-card--soon:hover { border-color: #1E1E3A; transform: none; }
        .vlst-card--soon:hover::before { opacity: 0; }
        .vlst-soon-badge {
          position: absolute;
          top: 14px; right: 14px;
          font-size: 10px; font-weight: 700; letter-spacing: 0.4px;
          color: #06B6D4;
          padding: 3px 10px;
          border-radius: 99px;
          background: rgba(6,182,212,.1);
          border: 1px solid rgba(6,182,212,.25);
          z-index: 1;
        }
        .vlst-icon {
          width: 48px; height: 48px;
          border-radius: 13px;
          background: rgba(139,92,246,.1);
          border: 1px solid rgba(139,92,246,.18);
          display: flex; align-items: center; justify-content: center;
          font-size: 22px;
          margin-bottom: 16px;
        }
        .vlst-name {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 18px; font-weight: 600; color: #F0F0FF;
          margin-bottom: 4px;
        }
        .vlst-time {
          font-size: 12px; font-weight: 600;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          margin-bottom: 12px;
        }
        .vlst-desc { font-size: 12px; color: #5A5A80; line-height: 1.65; margin-bottom: 16px; }
        .vlst-feats { list-style: none; display: flex; flex-direction: column; gap: 6px; }
        .vlst-feats li {
          font-size: 12px; color: #C4C4E0;
          display: flex; gap: 7px; align-items: flex-start;
        }
        .vlst-feats li::before { content: '✓'; color: #8B5CF6; font-weight: 700; flex-shrink: 0; }
        .vlst-feat-dim { color: #5A5A80 !important; }
        .vlst-feat-dim::before { content: '–' !important; color: #272745 !important; }
        .vlst-tip {
          display: flex; gap: 12px; align-items: flex-start;
          background: rgba(6,182,212,.04);
          border: 1px solid rgba(6,182,212,.15);
          border-radius: 12px;
          padding: 14px 16px;
        }
        .vlst-tip-ico { font-size: 18px; flex-shrink: 0; line-height: 1.4; }
        .vlst-tip-txt { font-size: 12px; color: #C4C4E0; line-height: 1.6; }
        .vlst-tip-txt b { color: #06B6D4; font-weight: 600; }

        @media (max-width: 900px) {
          .vlst-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </>
  )
}
