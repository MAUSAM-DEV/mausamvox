'use client'

const STEPS = ['Upload', 'Configure', 'Result']

interface VTopbarProps {
  step: 1 | 2 | 3
  onGoStep: (s: 1 | 2 | 3) => void
  // Guided (AI Cover) mode renames the breadcrumb steps; omitted = Voice Swap's.
  labels?: [string, string, string]
}

export function VTopbar({ step, onGoStep, labels }: VTopbarProps) {
  const steps = labels ?? STEPS
  return (
    <>
      <div className="vs-topbar">
        <div className="vs-breadcrumb">
          {steps.map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3
            const isDone = n < step
            const isActive = n === step
            const isPending = n > step
            return (
              <div
                key={label}
                className={`vs-step ${isActive ? 'vs-step--active' : ''} ${isDone ? 'vs-step--done' : ''} ${isPending ? 'vs-step--pending' : ''}`}
                onClick={() => isDone && onGoStep(n)}
                style={{ cursor: isDone ? 'pointer' : 'default' }}
              >
                <span className="vs-step-num">
                  {isDone ? '✓' : n}
                </span>
                <span className="vs-step-lbl">{label}</span>
              </div>
            )
          })}
        </div>

        <div className="vs-topbar-actions">
          <a href="/" className="vs-tb-back">
            ← Back to Home
          </a>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .vs-topbar {
          height: 58px;
          border-bottom: 1px solid #2E2E56;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 20px;
          flex-shrink: 0;
          background: #09091A;
        }
        .vs-breadcrumb {
          display: flex;
          align-items: center;
          gap: 0;
        }
        .vs-step {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 500;
          position: relative;
          transition: color 0.2s;
        }
        .vs-step::after {
          content: '›';
          position: absolute;
          right: -4px;
          font-size: 16px;
          color: #3C3C6A;
        }
        .vs-step:last-child::after { display: none; }
        .vs-step--pending { color: #8E8EB4; }
        .vs-step--done { color: #9D5CFF; }
        .vs-step--active {
          color: #F0F0FF;
          font-weight: 600;
        }
        .vs-step--active::before {
          content: '';
          position: absolute;
          bottom: 0;
          left: 16px;
          right: 16px;
          height: 2px;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          border-radius: 2px 2px 0 0;
        }
        .vs-step-num {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          flex-shrink: 0;
          background: rgba(255,255,255,.06);
          transition: all 0.2s;
        }
        .vs-step--active .vs-step-num {
          background: linear-gradient(135deg, #9D5CFF, #F9459E);
          color: #fff;
        }
        .vs-step--done .vs-step-num {
          background: rgba(157,92,255,.15);
          color: #9D5CFF;
        }
        .vs-topbar-actions { display: flex; align-items: center; gap: 12px; }
        .vs-tb-back {
          font-size: 12px;
          color: #8E8EB4;
          text-decoration: none;
          transition: color 0.2s;
        }
        .vs-tb-back:hover { color: #F0F0FF; }

        @media (max-width: 420px) {
          .vs-step-lbl { display: none; }
          .vs-topbar { padding: 0 12px; }
          .vs-tb-back { display: none; }
        }
      `}</style>
    </>
  )
}
