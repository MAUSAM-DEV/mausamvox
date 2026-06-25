'use client'

import { useState } from 'react'
import { AudioPlayer } from './AudioPlayer'

const HEIGHTS = [8, 13, 20, 15, 24, 17, 28, 21, 14, 22, 18, 24, 12, 20, 26, 18, 22, 16, 28, 20, 14, 18, 24, 16]

function MiniWave({ seed }: { seed: number }) {
  return (
    <div style={{ height: '22px', background: '#0E0E20', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '1.5px', padding: '3px 6px', overflow: 'hidden', flexShrink: 0 }}>
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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export interface VoiceSwap {
  id: string
  song_name: string
  voice_used: string
  quality_score: number | null
  result_url: string | null
  result_path: string | null
  created_at: string
}

interface RightPanelProps {
  onToast: (msg: string) => void
  onNewSwap: () => void
  swaps: VoiceSwap[]
  swapsLoading: boolean
  onDeleteSwap?: (id: string) => Promise<void>
}

export function RightPanel({ onToast, onNewSwap, swaps, swapsLoading, onDeleteSwap }: RightPanelProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)

  function handleToggleExpand(item: VoiceSwap) {
    const hasSrc = !!(item.result_path || item.result_url)
    if (!hasSrc) { onToast('No audio stored for this swap'); return }
    setExpandedId((prev) => (prev === item.id ? null : item.id))
  }

  async function handleConfirmDelete(id: string) {
    if (!onDeleteSwap) return
    setConfirmingId(null)
    if (expandedId === id) setExpandedId(null)
    setDeletingIds((prev) => { const s = new Set(prev); s.add(id); return s })
    try {
      await onDeleteSwap(id)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Delete failed — try again')
    } finally {
      setDeletingIds((prev) => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  return (
    <>
      <aside className="vs-rpanel">
        <div className="vs-rp-header">
          <span className="vs-rp-title">Recent Swaps</span>
          <button className="vs-rp-new" onClick={onNewSwap}>+ New</button>
        </div>

        <div className="vs-rp-list">
          {swapsLoading && <div className="vs-rp-empty">Loading…</div>}

          {!swapsLoading && swaps.length === 0 && (
            <div className="vs-rp-empty">No swaps yet — upload a track to get started</div>
          )}

          {!swapsLoading && swaps.map((item, i) => {
            const isConfirming = confirmingId === item.id
            const isDeleting = deletingIds.has(item.id)
            const isExpanded = expandedId === item.id
            const score = item.quality_score ?? null
            const hi = score !== null && score >= 80
            const seed = i * 3 + 2

            // Source for the inline player
            const playerSrc = item.result_path
              ? `/api/voice-swaps/${item.id}/result.mp3`
              : (item.result_url ?? null)

            // Replicate ephemeral URLs expire in ~1 hour. If result_path is null
            // (durable copy was never stored) and the swap is over an hour old, the
            // link is definitively gone — skip mounting AudioPlayer entirely.
            const isDefinitelyExpired = !item.result_path &&
              (Date.now() - new Date(item.created_at).getTime()) > 60 * 60 * 1000

            if (isConfirming) {
              return (
                <div key={item.id} className="vs-rp-item vs-rp-item--confirm">
                  <div className="vs-rp-confirm-msg">
                    Delete <b>&ldquo;{item.song_name}&rdquo;</b>?
                    <span className="vs-rp-confirm-sub">Removes the record and stored file. Cannot be undone.</span>
                  </div>
                  <div className="vs-rp-confirm-btns">
                    <button className="vs-rp-confirm-del" onClick={() => handleConfirmDelete(item.id)}>Delete</button>
                    <button className="vs-rp-confirm-cancel" onClick={() => setConfirmingId(null)}>Cancel</button>
                  </div>
                </div>
              )
            }

            return (
              <div
                key={item.id}
                className={`vs-rp-item${isDeleting ? ' vs-rp-item--deleting' : ''}${isExpanded ? ' vs-rp-item--expanded' : ''}`}
                onClick={() => { if (!isDeleting) handleToggleExpand(item) }}
              >
                <div className="vs-rp-item-top">
                  <span className="vs-rp-emoji">{isDeleting ? '⏳' : '🎵'}</span>
                  <div className="vs-rp-info">
                    <div className="vs-rp-name">{item.song_name}</div>
                    <div className="vs-rp-voice">{item.voice_used} · {formatDate(item.created_at)}</div>
                  </div>
                  {score !== null && !isExpanded && (
                    <span className={`vs-rp-score ${hi ? 'vs-rp-score--hi' : 'vs-rp-score--mid'}`}>{score}</span>
                  )}
                  {onDeleteSwap && !isDeleting && (
                    <button
                      className="vs-rp-del-btn"
                      title="Delete swap"
                      aria-label="Delete swap"
                      onClick={(e) => { e.stopPropagation(); setConfirmingId(item.id) }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4h6v2" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Collapsed: static mini waveform. Expanded: player or expired notice. */}
                {!isExpanded ? (
                  <MiniWave seed={seed} />
                ) : (
                  <div className="vs-rp-player" onClick={(e) => e.stopPropagation()}>
                    {isDefinitelyExpired ? (
                      <div className="vs-rp-expired">
                        Audio unavailable — Replicate link expired
                      </div>
                    ) : (
                      <>
                        {!item.result_path && item.result_url && (
                          <div className="vs-rp-ephem-warn">
                            ⚠ Ephemeral link — may expire after 1 hr
                          </div>
                        )}
                        <AudioPlayer src={playerSrc} />
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

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
          width: 252px; flex-shrink: 0;
          background: #09091A; border-left: 1px solid #1E1E3A;
          display: flex; flex-direction: column;
          height: 100vh; overflow: hidden;
        }
        .vs-rp-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 16px; border-bottom: 1px solid #1E1E3A; flex-shrink: 0;
        }
        .vs-rp-title {
          font-size: 11px; font-weight: 700; letter-spacing: 2px;
          text-transform: uppercase; color: #5A5A80;
        }
        .vs-rp-new {
          padding: 4px 12px; border-radius: 6px;
          border: 1px solid rgba(139,92,246,.3); background: rgba(139,92,246,.08);
          color: #8B5CF6; font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .vs-rp-new:hover { background: rgba(139,92,246,.16); }
        .vs-rp-list {
          flex: 1; overflow-y: auto; padding: 8px;
          scrollbar-width: thin; scrollbar-color: #2A2A4A transparent;
        }
        .vs-rp-list::-webkit-scrollbar { width: 4px; }
        .vs-rp-list::-webkit-scrollbar-thumb { background: #2A2A4A; border-radius: 2px; }
        .vs-rp-empty {
          font-size: 11px; color: #5A5A80; text-align: center; padding: 28px 12px; line-height: 1.6;
        }

        /* ── Swap card ── */
        .vs-rp-item {
          background: #0E0E20; border: 1px solid #1E1E3A; border-radius: 10px;
          padding: 10px; margin-bottom: 6px; cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
          display: flex; flex-direction: column; gap: 8px;
        }
        .vs-rp-item:hover { border-color: rgba(139,92,246,.28); background: #121225; }
        .vs-rp-item--deleting { opacity: 0.45; pointer-events: none; }
        .vs-rp-item--expanded { border-color: rgba(139,92,246,.4); background: #121225; cursor: default; }
        .vs-rp-item-top { display: flex; align-items: center; gap: 8px; }
        .vs-rp-emoji { font-size: 18px; flex-shrink: 0; }
        .vs-rp-info { flex: 1; min-width: 0; }
        .vs-rp-name {
          font-size: 12px; font-weight: 600; color: #F0F0FF;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .vs-rp-voice { font-size: 10px; color: #5A5A80; margin-top: 2px; }
        .vs-rp-score {
          font-size: 11px; font-weight: 700; padding: 2px 7px;
          border-radius: 99px; flex-shrink: 0;
        }
        .vs-rp-score--hi { background: rgba(16,185,129,.1); color: #10B981; }
        .vs-rp-score--mid { background: rgba(234,179,8,.1); color: #EAB308; }

        /* ── Delete button (visible on card hover) ── */
        .vs-rp-del-btn {
          width: 24px; height: 24px; flex-shrink: 0;
          border-radius: 5px; border: none;
          background: transparent; color: #5A5A80;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; padding: 0; margin-left: 2px;
          opacity: 0; transition: opacity 0.15s, color 0.15s, background 0.15s;
        }
        .vs-rp-item:hover .vs-rp-del-btn { opacity: 1; }
        .vs-rp-del-btn:hover { color: #EF4444; background: rgba(239,68,68,.1); }

        /* ── Confirm state ── */
        .vs-rp-item--confirm {
          background: #0E0E20; border: 1px solid rgba(239,68,68,.3);
          border-radius: 10px; padding: 12px; margin-bottom: 6px;
          display: flex; flex-direction: column; gap: 10px; cursor: default;
        }
        .vs-rp-confirm-msg { font-size: 12px; color: #C4C4E0; line-height: 1.5; }
        .vs-rp-confirm-msg b { color: #F0F0FF; }
        .vs-rp-confirm-sub { display: block; margin-top: 4px; font-size: 10px; color: #5A5A80; }
        .vs-rp-confirm-btns { display: flex; gap: 6px; }
        .vs-rp-confirm-del {
          flex: 1; padding: 5px 0; border-radius: 6px; border: none;
          background: rgba(239,68,68,.15); color: #EF4444;
          font-size: 11px; font-weight: 600; cursor: pointer; transition: background 0.15s;
        }
        .vs-rp-confirm-del:hover { background: rgba(239,68,68,.25); }
        .vs-rp-confirm-cancel {
          flex: 1; padding: 5px 0; border-radius: 6px;
          border: 1px solid #2A2A4A; background: transparent; color: #5A5A80;
          font-size: 11px; font-weight: 600; cursor: pointer; transition: color 0.15s;
        }
        .vs-rp-confirm-cancel:hover { color: #C4C4E0; }

        /* ── Expanded inline player wrapper ── */
        .vs-rp-player { display: flex; flex-direction: column; gap: 0; }
        .vs-rp-expired {
          font-size: 11px; color: #5A5A80;
          background: #0E0E20;
          border: 1px solid #1E1E3A;
          border-radius: 10px;
          padding: 14px;
          text-align: center;
          line-height: 1.5;
        }
        .vs-rp-ephem-warn {
          font-size: 10px; color: #F59E0B;
          background: rgba(245,158,11,.07);
          padding: 5px 10px;
          border-radius: 6px 6px 0 0;
          border: 1px solid rgba(245,158,11,.15);
          border-bottom: none;
          margin-bottom: -1px;
          position: relative;
          z-index: 1;
        }

        .vs-rp-storage {
          padding: 12px 16px; border-top: 1px solid #1E1E3A; flex-shrink: 0;
        }

        @media (max-width: 900px) {
          .vs-rpanel { width: 100% !important; height: auto !important; border-left: none !important; border-top: 1px solid #1E1E3A; }
          .vs-rp-list { max-height: 280px; }
        }
      `}</style>
    </>
  )
}
