'use client'

import { useState, useRef } from 'react'

const HEIGHTS = [8, 13, 20, 15, 24, 17, 28, 21, 14, 22, 18, 24, 12, 20, 26, 18, 22, 16, 28, 20, 14, 18, 24, 16]

function MiniWave({ seed, playing }: { seed: number; playing?: boolean }) {
  return (
    <div style={{ height: '22px', background: '#0E0E20', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '1.5px', padding: '3px 6px', overflow: 'hidden', flexShrink: 0 }}>
      {HEIGHTS.map((h, i) => (
        <div
          key={i}
          className={playing ? 'vs-rp-bar--anim' : undefined}
          style={{
            width: '2px',
            height: `${Math.min(16, (h + (seed + i * 3) % 7) * 0.75)}px`,
            borderRadius: '1px',
            background: 'linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4)',
            flexShrink: 0,
            animationDelay: playing ? `${(i % 6) * 55}ms` : undefined,
            transformOrigin: 'center bottom',
          }}
        />
      ))}
    </div>
  )
}

function fmt(s: number) {
  const m = Math.floor(s / 60)
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
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
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [audioError, setAudioError] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)

  function resetPlayer() {
    setPlaying(false)
    setProgress(0)
    setCurrentTime(0)
    setDuration(0)
    setAudioError(false)
  }

  function handleToggleExpand(item: VoiceSwap) {
    const src = item.result_path
      ? `/api/voice-swaps/${item.id}/result.mp3`
      : item.result_url
    if (!src) { onToast('No audio stored for this swap'); return }

    if (expandedId === item.id) {
      audioRef.current?.pause()
      setExpandedId(null)
      resetPlayer()
    } else {
      audioRef.current?.pause()
      resetPlayer()
      setExpandedId(item.id)
    }
  }

  async function handleConfirmDelete(id: string) {
    if (!onDeleteSwap) return
    setConfirmingId(null)
    if (expandedId === id) { audioRef.current?.pause(); setExpandedId(null); resetPlayer() }
    setDeletingIds((prev) => { const s = new Set(prev); s.add(id); return s })
    try {
      await onDeleteSwap(id)
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Delete failed — try again')
    } finally {
      setDeletingIds((prev) => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  const expandedItem = expandedId ? swaps.find((s) => s.id === expandedId) : null
  const expandedSrc = expandedItem?.result_path
    ? `/api/voice-swaps/${expandedItem.id}/result.mp3`
    : (expandedItem?.result_url ?? null)

  return (
    <>
      <aside className="vs-rpanel">
        <div className="vs-rp-header">
          <span className="vs-rp-title">Recent Swaps</span>
          <button className="vs-rp-new" onClick={onNewSwap}>+ New</button>
        </div>

        {/* Single audio element shared across all expanded cards. key=expandedId
            forces a clean mount (fresh buffering) each time a different swap opens. */}
        {expandedSrc && (
          <audio
            key={expandedId ?? ''}
            ref={audioRef}
            src={expandedSrc}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => { setPlaying(false); setProgress(1) }}
            onTimeUpdate={() => {
              const a = audioRef.current
              if (!a?.duration) return
              setCurrentTime(a.currentTime)
              setProgress(a.currentTime / a.duration)
            }}
            onLoadedMetadata={() => {
              const a = audioRef.current
              if (a && isFinite(a.duration)) setDuration(a.duration)
            }}
            onError={() => setAudioError(true)}
          />
        )}

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

                {!isExpanded ? (
                  <MiniWave seed={seed} />
                ) : (
                  /* Expanded inline player — stopPropagation so clicks inside
                     don't collapse the card. */
                  <div className="vs-rp-player" onClick={(e) => e.stopPropagation()}>
                    {audioError ? (
                      <div className="vs-rp-player-msg vs-rp-player-msg--err">
                        {item.result_path
                          ? 'Playback error — try again'
                          : 'Link expired — only durable swaps can be replayed'}
                      </div>
                    ) : (
                      <>
                        {!item.result_path && (
                          <div className="vs-rp-player-msg vs-rp-player-msg--warn">
                            ⚠ Ephemeral link — may expire after 1 hr
                          </div>
                        )}
                        <MiniWave seed={seed} playing={playing} />
                        <div
                          className="vs-rp-progress"
                          onClick={(e) => {
                            e.stopPropagation()
                            const rect = e.currentTarget.getBoundingClientRect()
                            const a = audioRef.current
                            if (a?.duration) a.currentTime = ((e.clientX - rect.left) / rect.width) * a.duration
                          }}
                        >
                          <div className="vs-rp-progress-fill" style={{ width: `${progress * 100}%` }} />
                        </div>
                        <div className="vs-rp-controls">
                          <span className="vs-rp-time">{fmt(currentTime)}</span>
                          <button
                            className="vs-rp-play-btn"
                            onClick={(e) => {
                              e.stopPropagation()
                              const a = audioRef.current
                              if (!a) return
                              if (a.paused) a.play().catch(() => setAudioError(true))
                              else a.pause()
                            }}
                          >
                            {playing ? '⏸' : '▶'}
                          </button>
                          <span className="vs-rp-time">{duration ? fmt(duration) : '—:—'}</span>
                        </div>
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

        /* ── Delete button (hidden until card hover) ── */
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
        .vs-rp-confirm-msg {
          font-size: 12px; color: #C4C4E0; line-height: 1.5;
        }
        .vs-rp-confirm-msg b { color: #F0F0FF; }
        .vs-rp-confirm-sub {
          display: block; margin-top: 4px; font-size: 10px; color: #5A5A80;
        }
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

        /* ── Inline player ── */
        .vs-rp-player { display: flex; flex-direction: column; gap: 6px; }
        .vs-rp-player-msg {
          font-size: 10px; border-radius: 4px; padding: 4px 6px; line-height: 1.4;
        }
        .vs-rp-player-msg--warn { color: #F59E0B; background: rgba(245,158,11,.07); }
        .vs-rp-player-msg--err  { color: #F87171; background: rgba(248,113,113,.07); }

        .vs-rp-progress {
          height: 3px; background: #1E1E3A; border-radius: 2px; overflow: hidden;
          cursor: pointer; flex-shrink: 0;
        }
        .vs-rp-progress:hover { height: 5px; margin-top: -1px; }
        .vs-rp-progress-fill {
          height: 100%; border-radius: 2px;
          background: linear-gradient(135deg,#8B5CF6,#EC4899,#06B6D4);
          transition: width 0.1s linear;
        }
        .vs-rp-controls {
          display: flex; align-items: center; justify-content: space-between;
        }
        .vs-rp-time { font-size: 10px; color: #5A5A80; font-variant-numeric: tabular-nums; }
        .vs-rp-play-btn {
          width: 28px; height: 28px; border-radius: 50%; border: none;
          background: linear-gradient(135deg,#8B5CF6,#EC4899);
          color: #fff; font-size: 10px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: transform 0.15s, box-shadow 0.15s;
          box-shadow: 0 2px 8px rgba(139,92,246,.4); flex-shrink: 0;
        }
        .vs-rp-play-btn:hover { transform: scale(1.1); box-shadow: 0 4px 14px rgba(139,92,246,.5); }

        /* Waveform bar animation when playing */
        @keyframes vs-rp-bounce {
          0%, 100% { transform: scaleY(1); }
          50%       { transform: scaleY(1.7); }
        }
        .vs-rp-bar--anim {
          animation: vs-rp-bounce 0.55s ease-in-out infinite;
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
