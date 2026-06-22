'use client'

import { useState, useCallback } from 'react'
import type { SavedVoice } from './RecordStep'

interface VLRightPanelProps {
  onToast: (m: string) => void
  voices: SavedVoice[]
  voicesLoading: boolean
  onOpenVoice?: (v: SavedVoice) => void
  onDeleteVoice?: (id: string) => Promise<void>
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

export function VLRightPanel({ onToast, voices, voicesLoading, onOpenVoice, onDeleteVoice }: VLRightPanelProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set())

  const handleConfirmDelete = useCallback(async (id: string) => {
    if (!onDeleteVoice) return
    setConfirmingId(null)
    setDeletingIds((prev) => new Set(Array.from(prev).concat(id)))
    try {
      await onDeleteVoice(id)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Delete failed — try again')
    } finally {
      setDeletingIds((prev) => { const s = new Set(Array.from(prev)); s.delete(id); return s })
    }
  }, [onDeleteVoice, onToast])

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

          {!voicesLoading && voices.map((v) => {
            const isConfirming = confirmingId === v.id
            const isDeleting = deletingIds.has(v.id)

            if (isConfirming) {
              return (
                <div key={v.id} className="vlrp-item vlrp-item--confirm">
                  <div className="vlrp-confirm-msg">
                    Delete <b>&ldquo;{v.name}&rdquo;</b>?
                    <span className="vlrp-confirm-sub">Removes the voice and all its files. Cannot be undone.</span>
                  </div>
                  <div className="vlrp-confirm-btns">
                    <button className="vlrp-confirm-del" onClick={() => handleConfirmDelete(v.id)}>
                      Delete
                    </button>
                    <button className="vlrp-confirm-cancel" onClick={() => setConfirmingId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )
            }

            return (
              <div
                key={v.id}
                className={`vlrp-item${isDeleting ? ' vlrp-item--deleting' : ''}`}
                onClick={() => {
                  if (isDeleting) return
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
                  {onDeleteVoice && !isDeleting && (
                    <button
                      className="vlrp-del-btn"
                      title="Delete voice"
                      aria-label="Delete voice"
                      onClick={(e) => { e.stopPropagation(); setConfirmingId(v.id) }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4h6v2" />
                      </svg>
                    </button>
                  )}
                </div>
                <div className="vlrp-vi-meta">
                  <span className={`vlrp-vi-status vlrp-vi-status--${isDeleting ? 'pending' : v.status}`}>
                    {isDeleting ? 'Deleting…' : (STATUS_LABEL[v.status] ?? v.status)}
                  </span>
                </div>
              </div>
            )
          })}
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
          position: relative;
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

        /* ── Delete button ── */
        .vlrp-del-btn {
          width: 26px; height: 26px; flex-shrink: 0;
          border-radius: 6px; border: none;
          background: transparent; color: #5A5A80;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; padding: 0; margin-left: 2px;
          opacity: 0; transition: opacity 0.15s, color 0.15s, background 0.15s;
        }
        .vlrp-item:hover .vlrp-del-btn { opacity: 1; }
        .vlrp-del-btn:hover { color: #EF4444; background: rgba(239,68,68,.1); }

        /* ── Confirm state ── */
        .vlrp-item--confirm {
          cursor: default;
          border-color: rgba(239,68,68,.25);
          background: rgba(239,68,68,.04);
        }
        .vlrp-item--confirm:hover { transform: none; border-color: rgba(239,68,68,.3); }
        .vlrp-confirm-msg {
          font-size: 12px; color: #C4C4E0; line-height: 1.5;
          margin-bottom: 12px;
          display: flex; flex-direction: column; gap: 4px;
        }
        .vlrp-confirm-sub { font-size: 10px; color: #5A5A80; }
        .vlrp-confirm-btns { display: flex; gap: 8px; }
        .vlrp-confirm-del {
          padding: 7px 16px; border-radius: 6px; border: none;
          background: #EF4444; color: #fff;
          font-size: 12px; font-weight: 600; cursor: pointer;
          transition: background 0.2s;
        }
        .vlrp-confirm-del:hover { background: #DC2626; }
        .vlrp-confirm-cancel {
          padding: 7px 14px; border-radius: 6px;
          border: 1px solid #272745; background: transparent;
          color: #C4C4E0; font-size: 12px; font-weight: 500; cursor: pointer;
          transition: border-color 0.2s, color 0.2s;
        }
        .vlrp-confirm-cancel:hover { border-color: #5A5A80; color: #F0F0FF; }

        /* ── Deleting state ── */
        .vlrp-item--deleting { opacity: 0.45; cursor: default; pointer-events: none; }
        .vlrp-item--deleting:hover { border-color: #1E1E3A; transform: none; }

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
