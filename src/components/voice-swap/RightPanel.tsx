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

export interface VoiceSwap {
  id: string
  song_name: string
  voice_used: string
  quality_score: number | null
  result_url: string | null
  created_at: string
}

interface RightPanelProps {
  onToast: (msg: string) => void
  swaps: VoiceSwap[]
  swapsLoading: boolean
}

export function RightPanel({ onToast, swaps, swapsLoading }: RightPanelProps) {
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
          {swapsLoading && (
            <div className="vs-rp-empty">Loading…</div>
          )}

          {!swapsLoading && swaps.length === 0 && (
            <div className="vs-rp-empty">
              No swaps yet — upload a track to get started
            </div>
          )}

          {!swapsLoading && swaps.map((item, i) => {
            const score = item.quality_score ?? null
            const hi = score !== null && score >= 80
            const seed = i * 3 + 2
            return (
              <div
                key={item.id}
                className="vs-rp-item"
                onClick={() => item.result_url
                  ? window.open(item.result_url, '_blank')
                  : onToast(item.song_name)
                }
              >
                <div className="vs-rp-item-top">
                  <span className="vs-rp-emoji">🎵</span>
                  <div className="vs-rp-info">
                    <div className="vs-rp-name">{item.song_name}</div>
                    <div className="vs-rp-voice">{item.voice_used}</div>
                  </div>
                  {score !== null && (
                    <span className={`vs-rp-score ${hi ? 'vs-rp-score--hi' : 'vs-rp-score--mid'}`}>
                      {score}
                    </span>
                  )}
                </div>
                <MiniWave seed={seed} />
              </div>
            )
          })}
        </div>

        {/* Storage usage isn't tracked yet — show an honest placeholder with an
            empty bar rather than a fabricated figure. */}
        <div className="vs-rp-storage">
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px' }}>
            <span style={{ color: '#5A5A80' }}>Storage</span>
            <span style={{ color: '#5A5A80', fontWeight: 600 }}>—</span>
          </div>
          <div style={{ height: '3px', background: '#1E1E3A', borderRadius: '2px', overflow: 'hidden' }} />
          <div style={{ fontSize: '10px', color: '#5A5A80', marginTop: '6px' }}>
            Storage tracking coming soon · Pro
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
        .vs-rp-empty {
          font-size: 11px;
          color: #5A5A80;
          text-align: center;
          padding: 28px 12px;
          line-height: 1.6;
        }
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
