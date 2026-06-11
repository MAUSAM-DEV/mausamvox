'use client'

interface VLRightPanelProps {
  onToast: (m: string) => void
}

const VOICES = [
  { emoji: '👤', name: 'My Voice',  date: 'Trained May 28', badge: 'studio',  score: 91, used: 14, langs: 'Hindi + English' },
  { emoji: '🎤', name: 'Voice 2',   date: 'Trained Jun 2',  badge: 'express', score: 72, used: 3,  langs: 'English' },
  { emoji: '🧑‍🎤', name: 'Voice 3', date: 'Trained Jun 7',  badge: 'studio',  score: 88, used: 9,  langs: 'Hindi' },
]

export function VLRightPanel({ onToast }: VLRightPanelProps) {
  return (
    <>
      <div className="vlrp">
        <div className="vlrp-head">
          <span className="vlrp-title">My Voices</span>
          <span style={{ fontSize: 11, color: '#5A5A80' }}>3 of 3 slots</span>
        </div>

        <div className="vlrp-body">
          {VOICES.map((v) => (
            <div
              key={v.name}
              className="vlrp-item"
              onClick={() => onToast(`${v.name} — ${v.date.toLowerCase()}, used in ${v.used} swaps`)}
            >
              <div className="vlrp-vi-top">
                <div className="vlrp-vi-av">{v.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="vlrp-vi-name">{v.name}</div>
                  <div className="vlrp-vi-type">{v.date}</div>
                </div>
                <span className={`vlrp-vi-badge vlrp-vi-badge--${v.badge}`}>
                  {v.badge === 'studio' ? 'Studio' : 'Express'}
                </span>
              </div>
              <div className="vlrp-vi-meta">
                <span>Score <b>{v.score}</b></span>
                <span>Used <b>{v.used}×</b></span>
                <span>{v.langs}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="vlrp-foot">
          <div className="vlrp-note">
            Slots reset on <b>Jul 1</b> · Retrain any voice to improve it with new audio
          </div>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .vlrp {
          background: #09091A;
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
        }
        .vlrp-head {
          padding: 14px 16px;
          border-bottom: 1px solid #1E1E3A;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }
        .vlrp-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; color: #F0F0FF;
        }
        .vlrp-body {
          flex: 1; overflow-y: auto; padding: 10px;
          scrollbar-width: thin; scrollbar-color: #2A2A4A transparent;
        }
        .vlrp-body::-webkit-scrollbar { width: 4px; }
        .vlrp-body::-webkit-scrollbar-thumb { background: #2A2A4A; border-radius: 2px; }
        .vlrp-item {
          background: #121225;
          border: 1px solid #1E1E3A;
          border-radius: 10px; padding: 12px;
          margin-bottom: 8px; cursor: pointer;
          transition: all 0.25s;
        }
        .vlrp-item:hover { border-color: rgba(139,92,246,.28); transform: translateX(-2px); }
        .vlrp-vi-top { display: flex; align-items: center; gap: 9px; margin-bottom: 8px; }
        .vlrp-vi-av {
          width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0;
          background: linear-gradient(135deg, rgba(139,92,246,.3), rgba(236,72,153,.2));
          border: 1px solid rgba(139,92,246,.25);
          display: flex; align-items: center; justify-content: center; font-size: 14px;
        }
        .vlrp-vi-name { font-size: 12px; font-weight: 600; color: #F0F0FF; }
        .vlrp-vi-type { font-size: 10px; color: #5A5A80; margin-top: 1px; }
        .vlrp-vi-badge {
          padding: 2px 8px; border-radius: 4px;
          font-size: 9px; font-weight: 700; letter-spacing: 0.5px;
          text-transform: uppercase; flex-shrink: 0;
        }
        .vlrp-vi-badge--studio {
          background: rgba(139,92,246,.1); color: #8B5CF6;
          border: 1px solid rgba(139,92,246,.2);
        }
        .vlrp-vi-badge--express {
          background: rgba(6,182,212,.08); color: #06B6D4;
          border: 1px solid rgba(6,182,212,.18);
        }
        .vlrp-vi-meta { font-size: 10px; color: #5A5A80; display: flex; gap: 10px; }
        .vlrp-vi-meta b { color: #C4C4E0; font-weight: 600; }
        .vlrp-foot { border-top: 1px solid #1E1E3A; padding: 10px; flex-shrink: 0; }
        .vlrp-note { font-size: 10px; color: #5A5A80; text-align: center; line-height: 1.6; padding: 4px; }
        .vlrp-note b { color: #8B5CF6; }

        @media (max-width: 900px) {
          .vlrp {
            width: 100% !important;
            height: auto !important;
            border-top: 1px solid #1E1E3A;
          }
          .vlrp-body { max-height: 300px; }
        }
      `}</style>
    </>
  )
}
