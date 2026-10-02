'use client'

import { useEffect, useRef, useState } from 'react'
import { coverGradient } from '@/lib/song-style'
import { formatMSS } from '@/lib/song-engine'

// Song Studio's fixed bottom player. One <audio> element for the whole page,
// so playback continues while the user scrolls, searches or edits the create
// panel. `playKey` changes on every Play click (even for the same track) so
// clicking a song in the list always (re)starts it.
export interface PlayerTrack {
  swapId: string
  url: string
  title: string
  subtitle: string
}

export function PlayerBar({ track, playKey }: { track: PlayerTrack | null; playKey: number }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)

  // A new Play click: load + start (the click is a user gesture, so play() is allowed).
  useEffect(() => {
    const a = audioRef.current
    if (!a || !track) return
    if (a.dataset.src !== track.url) {
      a.dataset.src = track.url
      a.src = track.url
      setTime(0)
      setDuration(0)
    } else {
      a.currentTime = 0
    }
    a.play().catch(() => setPlaying(false))
  }, [track, playKey])

  function toggle() {
    const a = audioRef.current
    if (!a || !track) return
    if (a.paused) a.play().catch(() => {})
    else a.pause()
  }

  return (
    <div className={`pb-bar${track ? '' : ' pb-bar--empty'}`} role="region" aria-label="Player">
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
      />
      <div className="pb-cover" style={{ background: track ? coverGradient(track.title) : '#1A1A33' }} aria-hidden="true" />
      <div className="pb-meta">
        <div className="pb-title">{track ? track.title : 'Nothing playing'}</div>
        <div className="pb-sub">{track ? track.subtitle : 'Pick a song from your list'}</div>
      </div>
      <button className="pb-play" onClick={toggle} disabled={!track} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="pb-seek">
        <span className="pb-time">{formatMSS(time)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          onChange={(e) => { const a = audioRef.current; if (a) { a.currentTime = Number(e.target.value); setTime(a.currentTime) } }}
          disabled={!track || !duration}
          aria-label="Seek"
          aria-valuetext={`${formatMSS(time)} of ${formatMSS(duration)}`}
        />
        <span className="pb-time">{formatMSS(duration)}</span>
      </div>

      <style>{`
        .pb-bar {
          position: fixed; left: 0; right: 0; bottom: 0; z-index: 50;
          display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px minmax(0, 2fr);
          align-items: center; gap: 14px;
          padding: 10px 20px; height: 68px;
          background: rgba(9,9,26,.96); backdrop-filter: blur(10px);
          border-top: 1px solid #2E2E56;
        }
        .pb-cover { width: 44px; height: 44px; border-radius: 8px; }
        .pb-meta { min-width: 0; }
        .pb-title {
          font-size: 13px; font-weight: 700; color: #F0F0FF;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .pb-sub {
          font-size: 11px; color: #8E8EB4; margin-top: 2px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .pb-play {
          width: 40px; height: 40px; border-radius: 50%; border: none;
          background: linear-gradient(135deg, #9D5CFF, #F9459E); color: #fff;
          font-size: 13px; cursor: pointer; display: grid; place-items: center;
        }
        .pb-play:disabled { opacity: .35; cursor: default; }
        .pb-seek { display: flex; align-items: center; gap: 10px; min-width: 0; }
        .pb-seek input { flex: 1; min-width: 0; accent-color: #9D5CFF; cursor: pointer; }
        .pb-time { font-size: 11px; color: #8E8EB4; font-variant-numeric: tabular-nums; min-width: 34px; text-align: center; }
        @media (max-width: 760px) {
          .pb-bar { grid-template-columns: 40px minmax(0, 1fr) 40px; grid-template-rows: auto auto; height: auto; padding: 8px 14px 10px; gap: 6px 12px; }
          .pb-cover { width: 40px; height: 40px; }
          .pb-seek { grid-column: 1 / -1; }
        }
      `}</style>
    </div>
  )
}
