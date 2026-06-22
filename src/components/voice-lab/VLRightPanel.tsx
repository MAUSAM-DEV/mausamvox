'use client'

import type { SavedVoice } from './RecordStep'

interface VLRightPanelProps {
  onToast: (m: string) => void
  voices: SavedVoice[]
  voicesLoading: boolean
  onOpenVoice?: (v: SavedVoice) => void
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  training: 'Training',
  ready: 'Ready',
  failed: 'Failed',
}

export function VLRightPanel({ onToast, voices, voicesLoading, onOpenVoice }: VLRightPanelProps) {
  return (
    <>
      <div className="vlrp">
        <div className="vlrp-head">
          <span className="vlrp-title">My Voices</span>
          <span style={{ fontSize: 11, color: '#5A5A80' }}>{voices.length} saved</span>
        </div>

        <div className="vlrp-body">
          {voicesLoading && <div className="vlrp-empty">Loading…</div>}

          {!voicesLoading && voices.length === 0 && (
            <div className="vlrp-empty">No voices yet — record or upload one to get started.</div>
          )}

          {!voicesLoading && voices.map((v) => (
            <div
              key={v.id}
              className="vlrp-item"
              onClick={() => {
                if (onOpenVoice) onOpenVoice(v)
                else onToast(`${v.name} — ${STATUS_LABEL[v.status] ?? v.status}, saved ${formatDate(v.created_at)}`)
              }}
            >
              <div className="vlrp-vi-top">
                <div className="vlrp-vi-av">🎤</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="vlrp-vi-name">{v.name}</div>
                  <div className="vlrp-vi-type">Saved {formatDate(v.created_at)}</div>
                </div>
                <span className={`vlrp-vi-badge vlrp-vi-badge--${v.type === 'studio' ? 'studio' : 'express'}`}>
                  {v.type === 'studio' ? 'Studio' : 'Express'}
                </span>
              </div>
              <div className="vlrp-vi-meta">
                <span className={`vlrp-vi-status vlrp-vi-status--${v.status}`}>
                  {STATUS_LABEL[v.status] ?? v.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="vlrp-foot">
          <div className="vlrp-note">
            Retrain any voice to improve it with new audio
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
        .vlrp-vi-status { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .vlrp-vi-status--pending { color: #F59E0B; }
        .vlrp-vi-status--training { color: #06B6D4; }
        .vlrp-vi-status--ready { color: #10B981; }
        .vlrp-vi-status--failed { color: #EF4444; }
        .vlrp-empty { font-size: 11px; color: #5A5A80; text-align: center; padding: 24px 8px; line-height: 1.6; }
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
