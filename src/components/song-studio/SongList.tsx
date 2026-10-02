'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ShareControl } from '@/components/share/ShareControl'
import { ShareVideoButton } from '@/components/share/ShareVideoButton'
import { coverGradient, parseSavedStyle } from '@/lib/song-style'
import { formatMSS } from '@/lib/song-engine'

// "My songs" — the signed-in user's Song Studio songs, newest first. Songs
// still being created show as progress rows at the top. Rows: cover tile
// (gradient from the title — no image model), title, style, length, and
// Play (bottom player) · Reuse style · Share · Share as Video.
export interface SongRow {
  id: string
  song_name: string
  voice_used: string | null
  duration_seconds: number | null
  created_at: string
  share_token: string | null
}
export interface GeneratingRow { key: string; title: string }

export function songStyleText(voiceUsed: string | null): string {
  return (voiceUsed ?? '').replace(/^AI generated\s*·?\s*/i, '').trim()
}

export function SongList({
  songs, generating, loading, currentId, playing, onPlay, onReuse, onToast,
}: {
  songs: SongRow[]
  generating: GeneratingRow[]
  loading: boolean
  currentId: string | null
  playing: boolean
  onPlay: (song: SongRow) => void
  onReuse: (song: SongRow) => void
  onToast: (msg: string) => void
}) {
  const [query, setQuery] = useState('')
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return songs
    return songs.filter((s) => s.song_name.toLowerCase().includes(q) || songStyleText(s.voice_used).toLowerCase().includes(q))
  }, [songs, query])

  return (
    <section className="sl-panel" aria-label="My songs">
      <div className="sl-head">
        <h2 className="sl-h2">My songs</h2>
        {songs.length > 0 && <span className="sl-count">{songs.length}</span>}
      </div>
      {songs.length > 3 && (
        <input
          className="sl-search"
          type="search"
          placeholder="Search by title or style"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search my songs"
        />
      )}

      <div className="sl-list">
        {generating.map((g) => (
          <div className="sl-row sl-row--gen" key={g.key} aria-live="polite">
            <div className="sl-cover sl-cover--gen" style={{ background: coverGradient(g.title) }} aria-hidden="true">
              <span className="sl-spin" />
            </div>
            <div className="sl-meta">
              <div className="sl-title">{g.title}</div>
              <div className="sl-style">Creating your song… usually under a minute</div>
              <div className="sl-bar"><span /></div>
            </div>
          </div>
        ))}

        {loading && songs.length === 0 && generating.length === 0 && (
          <div className="sl-empty">Loading your songs…</div>
        )}
        {!loading && songs.length === 0 && generating.length === 0 && (
          <div className="sl-empty">
            Your songs will appear here. Describe a song on the left and press Generate.
          </div>
        )}
        {songs.length > 0 && shown.length === 0 && <div className="sl-empty">No songs match &ldquo;{query}&rdquo;.</div>}

        {shown.map((s) => {
          const isCurrent = currentId === s.id
          const style = songStyleText(s.voice_used)
          const reusable = parseSavedStyle(s.voice_used).style.length > 0
          return (
            <div className={`sl-row${isCurrent ? ' sl-row--current' : ''}`} key={s.id}>
              <button
                className="sl-cover"
                style={{ background: coverGradient(s.song_name) }}
                onClick={() => onPlay(s)}
                aria-label={`Play ${s.song_name}`}
              >
                <span className="sl-cover-ico">{isCurrent && playing ? '❚❚' : '▶'}</span>
              </button>
              <div className="sl-meta">
                <div className="sl-title-row">
                  <Link href={`/swaps/${s.id}`} className="sl-title">{s.song_name}</Link>
                  {s.duration_seconds ? <span className="sl-len">{formatMSS(Number(s.duration_seconds))}</span> : null}
                </div>
                {style && <div className="sl-style" title={style}>{style}</div>}
                <div className="sl-actions">
                  <button className="sl-btn" onClick={() => onPlay(s)}>{isCurrent && playing ? 'Playing' : 'Play'}</button>
                  {reusable && <button className="sl-btn" onClick={() => onReuse(s)}>Reuse style</button>}
                  <ShareControl swapId={s.id} initialToken={s.share_token} onToast={onToast} />
                  <ShareVideoButton swapId={s.id} songName={s.song_name} onToast={onToast} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <style>{`
        .sl-panel { min-width: 0; }
        .sl-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        .sl-h2 {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 18px; font-weight: 700; color: #F0F0FF; margin: 0;
        }
        .sl-count {
          font-size: 11px; font-weight: 700; color: #C4B5FD;
          background: rgba(157,92,255,.12); border: 1px solid rgba(157,92,255,.3);
          border-radius: 999px; padding: 2px 8px;
        }
        .sl-search {
          width: 100%; background: #0E0E20; border: 1px solid #2E2E56; border-radius: 8px;
          padding: 9px 12px; font-size: 13px; color: #F0F0FF; outline: none; margin-bottom: 12px;
          font-family: inherit;
        }
        .sl-search:focus { border-color: rgba(157,92,255,.5); }
        .sl-list { display: flex; flex-direction: column; gap: 8px; }
        .sl-row {
          display: flex; gap: 12px; padding: 10px; border-radius: 12px;
          background: #09091A; border: 1px solid #1E1E3C; transition: border-color .2s;
        }
        .sl-row:hover { border-color: #2E2E56; }
        .sl-row--current { border-color: rgba(157,92,255,.5); background: rgba(157,92,255,.06); }
        .sl-cover {
          flex: 0 0 56px; width: 56px; height: 56px; border-radius: 10px; border: none;
          display: grid; place-items: center; cursor: pointer; position: relative;
        }
        .sl-cover-ico {
          width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
          background: rgba(5,5,15,.55); color: #fff; font-size: 10px;
        }
        .sl-cover--gen { cursor: default; opacity: .75; }
        .sl-spin {
          width: 20px; height: 20px; border-radius: 50%;
          border: 2px solid rgba(255,255,255,.35); border-top-color: #fff;
          animation: sl-rot .9s linear infinite;
        }
        @keyframes sl-rot { to { transform: rotate(360deg) } }
        .sl-meta { flex: 1; min-width: 0; }
        .sl-title-row { display: flex; align-items: baseline; gap: 8px; }
        .sl-title {
          font-size: 13px; font-weight: 700; color: #F0F0FF; text-decoration: none;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0;
        }
        a.sl-title:hover { color: #C4B5FD; }
        .sl-len { flex: 0 0 auto; font-size: 11px; color: #8E8EB4; font-variant-numeric: tabular-nums; }
        .sl-style {
          font-size: 11px; color: #8E8EB4; margin-top: 3px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .sl-bar { height: 3px; border-radius: 3px; background: #1E1E3C; overflow: hidden; margin-top: 10px; }
        .sl-bar span {
          display: block; height: 100%; width: 40%;
          background: linear-gradient(90deg, #9D5CFF, #F9459E);
          animation: sl-slide 1.6s ease-in-out infinite;
        }
        @keyframes sl-slide { 0% { transform: translateX(-100%) } 100% { transform: translateX(260%) } }
        .sl-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center; }
        .sl-btn,
        .sl-actions .shc-btn,
        .sl-actions .svb-btn {
          padding: 5px 10px !important; border-radius: 7px !important;
          font-size: 11px !important; font-weight: 600;
        }
        .sl-btn {
          border: 1px solid #2E2E56; background: #0E0E20; color: #C4C4E0; cursor: pointer;
          font-family: inherit; transition: all .2s;
        }
        .sl-btn:hover { color: #F0F0FF; border-color: rgba(157,92,255,.45); }
        .sl-empty {
          font-size: 12px; color: #8E8EB4; line-height: 1.6; text-align: center;
          padding: 28px 16px; border: 1px dashed #2E2E56; border-radius: 12px;
        }
      `}</style>
    </section>
  )
}
