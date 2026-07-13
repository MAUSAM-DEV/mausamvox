'use client'

import type { TrainPhase } from './useTraining'

type CloneType = 'express' | 'studio'

interface TrainingStepProps {
  cloneType: CloneType
  phase: TrainPhase
  error: string | null
  voiceName: string | null
  onRetry: () => void
}

// The visible stages, in order. Each maps to one or more real backend phases.
const STAGES: { key: string; label: string; phases: TrainPhase[] }[] = [
  { key: 'prepare',  label: 'Preparing your voice data', phases: ['preparing'] },
  { key: 'train',    label: 'Training your voice model',  phases: ['queued', 'training'] },
  { key: 'finalize', label: 'Almost ready',               phases: ['finalizing'] },
  { key: 'ready',    label: 'Ready',                       phases: ['ready'] },
]

// Index of the stage that the current phase belongs to (for done/active/pending).
function activeStageIndex(phase: TrainPhase): number {
  const i = STAGES.findIndex((s) => s.phases.includes(phase))
  return i === -1 ? 0 : i
}

export function TrainingStep({ cloneType, phase, error, voiceName, onRetry }: TrainingStepProps) {
  const failed = phase === 'failed'
  const activeIdx = activeStageIndex(phase)
  const inProgress = phase === 'preparing' || phase === 'queued' || phase === 'training' || phase === 'finalizing'
  const tierLabel = cloneType === 'studio' ? 'Studio Clone' : 'Express Clone'
  // Honest ETAs: Studio trains 50 epochs (~45 min), Express ~18 (~15 min).
  const etaLabel = cloneType === 'studio' ? 'about 45 minutes' : 'about 15 minutes'

  // A more specific sub-line for the long training phase.
  const subline =
    phase === 'queued'
      ? 'Queued on a GPU — this starts in a moment'
      : phase === 'finalizing'
      ? 'Finishing up your voice model'
      : 'Building your voice profile · Your audio never leaves encrypted storage'

  return (
    <>
      <div className="vltr-stage">
        <div className={`vltr-orb${failed ? ' vltr-orb--err' : ''}`} />
        <div className="vltr-tier">{tierLabel}</div>
        <div className="vltr-title">
          {failed
            ? 'Training hit a snag'
            : voiceName
            ? `Training "${voiceName}"`
            : `Training Your ${tierLabel}`}
        </div>
        <div className="vltr-sub">{failed ? 'Your sample is safe — nothing was lost.' : subline}</div>

        {failed ? (
          <div className="vltr-err-box">
            <p className="vltr-err-msg">{error ?? 'Something went wrong while training your voice.'}</p>
            <button className="vltr-retry" onClick={onRetry}>Try Again</button>
          </div>
        ) : (
          <div className="vltr-quality">
            <ol className="vltr-stages">
              {STAGES.map((s, i) => {
                const state = i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending'
                return (
                  <li key={s.key} className={`vltr-stg vltr-stg--${state}`}>
                    <span className="vltr-stg-dot">{state === 'done' ? '✓' : ''}</span>
                    <span className="vltr-stg-lbl">{s.label}</span>
                  </li>
                )
              })}
            </ol>

            {inProgress && (
              <div className="vltr-bar" aria-label="Training in progress">
                <div className="vltr-bar-ind" />
              </div>
            )}

            <p className="vltr-tq-note">
              This usually takes {etaLabel}. <b>You can leave this page and come back</b> —
              we&apos;ll pick up where it left off.
            </p>
          </div>
        )}
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
          border: 1px solid #2E2E56;
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
          background: radial-gradient(ellipse, rgba(157,92,255,.14), transparent 70%);
          pointer-events: none;
        }
        .vltr-orb {
          width: 110px; height: 110px; border-radius: 50%;
          margin-bottom: 20px; position: relative;
          background: radial-gradient(circle, rgba(157,92,255,.4), rgba(249,69,158,.18) 55%, transparent 75%);
          animation: vltrOrb 3.2s ease-in-out infinite;
        }
        .vltr-orb--err {
          background: radial-gradient(circle, rgba(239,68,68,.35), rgba(239,68,68,.12) 55%, transparent 75%);
          animation: none;
        }
        @keyframes vltrOrb { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.12); } }
        .vltr-orb::after {
          content: '🧬';
          position: absolute; inset: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 36px;
        }
        .vltr-orb--err::after { content: '⚠️'; }
        .vltr-tier {
          font-size: 10px; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase;
          color: #9D5CFF; background: rgba(157,92,255,.1);
          border: 1px solid rgba(157,92,255,.22);
          padding: 3px 10px; border-radius: 99px;
          margin-bottom: 12px; position: relative;
        }
        .vltr-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 20px; font-weight: 600; color: #F0F0FF;
          margin-bottom: 6px; position: relative;
        }
        .vltr-sub { font-size: 12px; color: #8E8EB4; margin-bottom: 28px; position: relative; }
        .vltr-quality { width: 100%; max-width: 420px; position: relative; }

        .vltr-stages {
          list-style: none; display: flex; flex-direction: column; gap: 12px;
          text-align: left; margin-bottom: 22px;
        }
        .vltr-stg { display: flex; align-items: center; gap: 11px; font-size: 13px; transition: color 0.3s; }
        .vltr-stg-dot {
          width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0;
          display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 700;
          border: 1px solid #383866; background: #2E2E56; color: #8E8EB4;
          transition: all 0.3s;
        }
        .vltr-stg--pending { color: #8E8EB4; }
        .vltr-stg--done { color: #C4C4E0; }
        .vltr-stg--done .vltr-stg-dot {
          background: rgba(16,185,129,.12); border-color: rgba(16,185,129,.35); color: #10B981;
        }
        .vltr-stg--active { color: #F0F0FF; font-weight: 600; }
        .vltr-stg--active .vltr-stg-dot {
          background: #9D5CFF; border-color: #9D5CFF; color: #fff;
          box-shadow: 0 0 0 0 rgba(157,92,255,.5);
          animation: vltrPulse 1.6s ease-in-out infinite;
        }
        @keyframes vltrPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(157,92,255,.5); }
          50%      { box-shadow: 0 0 0 6px rgba(157,92,255,0); }
        }

        .vltr-bar {
          height: 6px; background: #2E2E56; border-radius: 3px; overflow: hidden; position: relative;
        }
        .vltr-bar-ind {
          position: absolute; top: 0; left: 0; height: 100%; width: 40%; border-radius: 3px;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          animation: vltrSlide 1.4s ease-in-out infinite;
        }
        @keyframes vltrSlide {
          0%   { left: -40%; }
          100% { left: 100%; }
        }

        .vltr-tq-note { font-size: 11px; color: #8E8EB4; margin-top: 16px; line-height: 1.6; }
        .vltr-tq-note b { color: #C4C4E0; }

        .vltr-err-box { width: 100%; max-width: 420px; position: relative; }
        .vltr-err-msg {
          font-size: 12px; color: #F87171; line-height: 1.6;
          background: rgba(239,68,68,.06); border: 1px solid rgba(239,68,68,.2);
          border-radius: 10px; padding: 14px 16px; margin-bottom: 16px;
          word-break: break-word;
        }
        .vltr-retry {
          padding: 11px 28px; border-radius: 8px; border: none;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.25s;
        }
        .vltr-retry:hover { box-shadow: 0 8px 26px rgba(157,92,255,.4); transform: translateY(-1px); }

        .vltr-tip {
          display: flex; gap: 12px; align-items: flex-start;
          background: rgba(12,199,232,.04);
          border: 1px solid rgba(12,199,232,.15);
          border-radius: 12px; padding: 14px 16px;
        }
        .vltr-tip-ico { font-size: 18px; flex-shrink: 0; line-height: 1.4; }
        .vltr-tip-txt { font-size: 12px; color: #C4C4E0; line-height: 1.6; }
        .vltr-tip-txt b { color: #0CC7E8; font-weight: 600; }

        @media (max-width: 900px) {
          .vltr-stage { padding: 32px 18px; }
        }
      `}</style>
    </>
  )
}
