'use client'

const STEPS = ['Setup', 'Record', 'Train', 'Test']

interface VLTopbarProps {
  step: 1 | 2 | 3 | 4
  onGoStep: (s: 1 | 2 | 3 | 4) => void
}

export function VLTopbar({ step, onGoStep }: VLTopbarProps) {
  return (
    <>
      <div className="vlt-bar">
        <span className="vlt-title">Voice Lab</span>
        <div className="vlt-divider" />
        <span className="vlt-sub">Train your personal AI singing voice</span>

        <div className="vlt-steps">
          {STEPS.map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3 | 4
            const isDone = n < step
            const isActive = n === step
            return (
              <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 && <div className="vlt-sep" />}
                <div
                  className={`vlt-step${isActive ? ' vlt-step--active' : ''}${isDone ? ' vlt-step--done' : ''}`}
                  onClick={() => isDone && onGoStep(n)}
                  style={{ cursor: isDone ? 'pointer' : 'default' }}
                >
                  <div className="vlt-step-n">{isDone ? '✓' : n}</div>
                  <span>{label}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .vlt-bar {
          flex-shrink: 0;
          height: 58px;
          display: flex;
          align-items: center;
          padding: 0 24px;
          gap: 12px;
          background: #09091A;
          border-bottom: 1px solid #2E2E56;
        }
        .vlt-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 15px;
          font-weight: 600;
          color: #F0F0FF;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .vlt-divider { width: 1px; height: 18px; background: #2E2E56; flex-shrink: 0; }
        .vlt-sub { font-size: 12px; color: #8E8EB4; white-space: nowrap; flex-shrink: 0; }
        .vlt-steps {
          margin-left: auto;
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }
        .vlt-sep { width: 24px; height: 1px; background: #2E2E56; flex-shrink: 0; }
        .vlt-step {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 5px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          color: #8E8EB4;
          transition: color 0.2s;
          position: relative;
        }
        .vlt-step--active { color: #F0F0FF; }
        .vlt-step--active::after {
          content: '';
          position: absolute;
          bottom: -1px;
          left: 12px;
          right: 12px;
          height: 2px;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          border-radius: 1px;
          animation: vltUs 0.4s ease;
        }
        @keyframes vltUs { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .vlt-step--done { color: #9D5CFF; }
        .vlt-step-n {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #2E2E56;
          border: 1px solid #383866;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          flex-shrink: 0;
          transition: all 0.3s;
        }
        .vlt-step--active .vlt-step-n {
          background: #9D5CFF;
          border-color: #9D5CFF;
          color: #fff;
          box-shadow: 0 0 10px rgba(157,92,255,.5);
        }
        .vlt-step--done .vlt-step-n {
          background: rgba(157,92,255,.12);
          border-color: rgba(157,92,255,.3);
          color: #9D5CFF;
        }

        @media (max-width: 900px) {
          .vlt-bar {
            height: auto;
            flex-wrap: wrap;
            padding: 10px 14px;
            row-gap: 8px;
          }
          .vlt-sub, .vlt-divider { display: none; }
          .vlt-steps { margin-left: 0; width: 100%; justify-content: space-between; }
          .vlt-step { padding: 4px 3px; font-size: 10px; gap: 4px; }
          .vlt-sep { width: 8px; }
        }

        @media (max-width: 420px) {
          .vlt-step span { display: none; }
          .vlt-step--active span { display: inline; }
        }
      `}</style>
    </>
  )
}
