'use client'

type CloneType = 'express' | 'studio'

interface TrainingStepProps {
  cloneType: CloneType
  trainProgress: number
  trainEta: number
}

export function TrainingStep({ cloneType, trainProgress, trainEta }: TrainingStepProps) {
  return (
    <>
      <div className="vltr-stage">
        <div className="vltr-orb" />
        <div className="vltr-title">
          {cloneType === 'studio' ? 'Training Your Studio Clone' : 'Training Your Express Clone'}
        </div>
        <div className="vltr-sub">GPT-SoVITS v2 · Your audio never leaves encrypted storage</div>
        <div className="vltr-quality">
          <div className="vltr-tq-row">
            <span>Model Quality (live)</span>
            <b>{Math.floor(trainProgress)}</b>
          </div>
          <div className="vltr-tq-track">
            <div className="vltr-tq-fill" style={{ width: `${trainProgress}%` }} />
          </div>
          <p className="vltr-tq-note">
            Estimated time remaining: <b>~{trainEta} minutes</b><br/>
            You can close this page — we&apos;ll notify you when your voice is ready.
          </p>
        </div>
      </div>

      <div className="vltr-tip">
        <span className="vltr-tip-ico">🔒</span>
        <span className="vltr-tip-txt">
          <b>Private by default:</b> Your voice model belongs to you. Nobody can use it unless you explicitly share it — and you can delete it permanently at any time.
        </span>
      </div>

      <style suppressHydrationWarning>{`
        .vltr-stage {
          background: #121225;
          border: 1px solid #1E1E3A;
          border-radius: 14px;
          padding: 44px 32px;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          position: relative;
          overflow: hidden;
          animation: vlFadeUp 0.3s ease;
        }
        @keyframes vlFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .vltr-stage::before {
          content: '';
          position: absolute;
          top: -100px; left: 50%; transform: translateX(-50%);
          width: 480px; height: 280px; border-radius: 50%;
          background: radial-gradient(ellipse, rgba(139,92,246,.14), transparent 70%);
          pointer-events: none;
        }
        .vltr-orb {
          width: 110px; height: 110px; border-radius: 50%;
          margin-bottom: 24px; position: relative;
          background: radial-gradient(circle, rgba(139,92,246,.4), rgba(236,72,153,.18) 55%, transparent 75%);
          animation: vltrOrb 3.2s ease-in-out infinite;
        }
        @keyframes vltrOrb { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }
        .vltr-orb::after {
          content: '🧬';
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 36px;
        }
        .vltr-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 20px; font-weight: 600; color: #F0F0FF;
          margin-bottom: 6px; position: relative;
        }
        .vltr-sub { font-size: 12px; color: #5A5A80; margin-bottom: 28px; position: relative; }
        .vltr-quality { width: 100%; max-width: 420px; position: relative; }
        .vltr-tq-row {
          display: flex; justify-content: space-between;
          font-size: 11px; color: #5A5A80; margin-bottom: 7px;
        }
        .vltr-tq-row b {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 15px;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
        }
        .vltr-tq-track { height: 6px; background: #1E1E3A; border-radius: 3px; overflow: hidden; }
        .vltr-tq-fill {
          height: 100%; border-radius: 3px;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          transition: width 0.8s ease;
        }
        .vltr-tq-note { font-size: 11px; color: #5A5A80; margin-top: 14px; line-height: 1.6; }
        .vltr-tq-note b { color: #C4C4E0; }
        .vltr-tip {
          display: flex; gap: 12px; align-items: flex-start;
          background: rgba(6,182,212,.04);
          border: 1px solid rgba(6,182,212,.15);
          border-radius: 12px; padding: 14px 16px;
        }
        .vltr-tip-ico { font-size: 18px; flex-shrink: 0; line-height: 1.4; }
        .vltr-tip-txt { font-size: 12px; color: #C4C4E0; line-height: 1.6; }
        .vltr-tip-txt b { color: #06B6D4; font-weight: 600; }

        @media (max-width: 900px) {
          .vltr-stage { padding: 32px 18px; }
        }
      `}</style>
    </>
  )
}
