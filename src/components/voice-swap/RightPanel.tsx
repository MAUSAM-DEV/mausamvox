'use client'

const HEIGHTS = [8, 13, 20, 15, 24, 17, 28, 21, 14, 22, 18, 24, 12, 20, 26, 18, 22, 16, 28, 20, 14, 18, 24, 16]

function MiniWave({ seed }: { seed: number }) {
  return (
    <div
      style={{
        height: '22px',
        background: '#0E0E20',
        borderRadius: '4px',
        display: 'flex',
        alignItems: 'center',
        gap: '1.5px',
        padding: '3px 6px',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {HEIGHTS.map((h, i) => (
        <div
          key={i}
          style={{
            width: '2px',
            height: `${Math.min(16, (h + (seed + i * 3) % 7) * 0.75)}px`,
            borderRadius: '1px',
            background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)',
            flexShrink: 0,
          }}
        />
      ))}
    </div>
  )
}

const HISTORY = [
  { emoji: '🎵', name: 'Kesariya — Remix', voice: 'My Voice · Female', score: 88, seed: 2, hi: true },
  { emoji: '🎸', name: 'Tum Hi Ho — Cover', voice: 'My Voice · Neutral', score: 91, seed: 7, hi: true },
  { emoji: '🎹', name: 'Blinding Lights', voice: 'Voice 2 · Male', score: 61, seed: 3, hi: false },
  { emoji: '🎤', name: 'Channa Mereya', voice: 'My Voice · Female', score: 79, seed: 5, hi: true },
]

interface RightPanelProps {
  onToast: (msg: string) => void
}

export function RightPanel({ onToast }: RightPanelProps) {
  return (
    <>
      <aside className="vs-rpanel">
        <div className="vs-rp-header">
          <span className="vs-rp-title">Recent Swaps</span>
          <button
            className="vs-rp-new"
            onClick={() => onToast('Starting new swap…')}
          >
            + New
          </button>
        </div>

        <div className="vs-rp-list">
          {HISTORY.map((item, i) => (
            <div
              key={i}
              className="vs-rp-item"
              onClick={() => onToast(`Loading: ${item.name}`)}
            >
              <div className="vs-rp-item-top">
                <span className="vs-rp-emoji">{item.emoji}</span>
                <div className="vs-rp-info">
                  <div className="vs-rp-name">{item.name}</div>
                  <div className="vs-rp-voice">{item.voice}</div>
                </div>
                <span
                  className={`vs-rp-score ${item.hi ? 'vs-rp-score--hi' : 'vs-rp-score--mid'}`}
                >
                  {item.score}
                </span>
              </div>
              <MiniWave seed={item.seed} />
            </div>
          ))}
        </div>

        <div className="vs-rp-storage">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px' }}>
            <span style={{ color: '#5A5A80' }}>Storage</span>
            <span style={{ color: '#C4C4E0', fontWeight: 600 }}>1.2 GB / 5 GB</span>
          </div>
          <div style={{ height: '3px', background: '#1E1E3A', borderRadius: '2px', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: '24%',
                background: 'linear-gradient(135deg,#8B5CF6,#EC4899)',
                borderRadius: '2px',
              }}
            />
          </div>
        </div>
      </aside>

      <style suppressHydrationWarning>{`
        .vs-rpanel {
          width: 252px;
          flex-shrink: 0;
          background: #09091A;
          border-left: 1px solid #1E1E3A;
          display: flex;
          flex-direction: column;
          height: 100vh;
          overflow: hidden;
        }
        .vs-rp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px;
          border-bottom: 1px solid #1E1E3A;
          flex-shrink: 0;
        }
        .vs-rp-title {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #5A5A80;
        }
        .vs-rp-new {
          padding: 4px 12px;
          border-radius: 6px;
          border: 1px solid rgba(139,92,246,.3);
          background: rgba(139,92,246,.08);
          color: #8B5CF6;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }
        .vs-rp-new:hover { background: rgba(139,92,246,.16); }
        .vs-rp-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
          scrollbar-width: thin;
          scrollbar-color: #2A2A4A transparent;
        }
        .vs-rp-list::-webkit-scrollbar { width: 4px; }
        .vs-rp-list::-webkit-scrollbar-thumb { background: #2A2A4A; border-radius: 2px; }
        .vs-rp-item {
          background: #0E0E20;
          border: 1px solid #1E1E3A;
          border-radius: 10px;
          padding: 10px;
          margin-bottom: 6px;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .vs-rp-item:hover { border-color: rgba(139,92,246,.28); background: #121225; }
        .vs-rp-item-top {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .vs-rp-emoji { font-size: 18px; flex-shrink: 0; }
        .vs-rp-info { flex: 1; min-width: 0; }
        .vs-rp-name {
          font-size: 12px;
          font-weight: 600;
          color: #F0F0FF;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .vs-rp-voice { font-size: 10px; color: #5A5A80; margin-top: 2px; }
        .vs-rp-score {
          font-size: 11px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 99px;
          flex-shrink: 0;
        }
        .vs-rp-score--hi {
          background: rgba(16,185,129,.1);
          color: #10B981;
        }
        .vs-rp-score--mid {
          background: rgba(234,179,8,.1);
          color: #EAB308;
        }
        .vs-rp-storage {
          padding: 12px 16px;
          border-top: 1px solid #1E1E3A;
          flex-shrink: 0;
        }

        @media (max-width: 900px) {
          .vs-rpanel {
            width: 100% !important;
            height: auto !important;
            border-left: none !important;
            border-top: 1px solid #1E1E3A;
          }
          .vs-rp-list {
            max-height: 280px;
          }
        }
      `}</style>
    </>
  )
}
