'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import Link from 'next/link'
import { LogoFull } from '@/components/ui/Logo'

// Voice Library — free community voices, browsable WITHOUT auth (this page is
// deliberately not middleware-gated; "Use in Voice Swap" links into
// /voice-swap which IS gated, so using a voice requires login). Data comes
// from the public /api/library route; previews stream through
// /api/library/preview (sign-on-read). Honest copy: it's free, sharing is
// owner-opt-in with consent, and paid licensing/creator earnings are stated
// as coming later — not faked.

type LibraryVoice = {
  id: string
  name: string
  type: string
  language: string
  bio: string | null
  publishedAt: string | null
  hasPreview: boolean
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
}

function langLabel(code: string) {
  return LANGUAGE_LABELS[code] ?? code
}

export function LibraryPage() {
  const [voices, setVoices] = useState<LibraryVoice[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [search, setSearch] = useState('')
  const [langFilter, setLangFilter] = useState('all')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    fetch('/api/library')
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.voices)) setVoices(d.voices)
        else setLoadError(true)
        setLoading(false)
      })
      .catch(() => { setLoadError(true); setLoading(false) })
    return () => { audioRef.current?.pause() }
  }, [])

  const languages = useMemo(
    () => Array.from(new Set(voices.map((v) => v.language))).sort(),
    [voices]
  )

  const shown = voices.filter((v) => {
    if (langFilter !== 'all' && v.language !== langFilter) return false
    const q = search.trim().toLowerCase()
    if (!q) return true
    return v.name.toLowerCase().includes(q) || (v.bio ?? '').toLowerCase().includes(q)
  })

  function togglePreview(v: LibraryVoice) {
    if (playingId === v.id) {
      audioRef.current?.pause()
      audioRef.current = null
      setPlayingId(null)
      return
    }
    audioRef.current?.pause()
    const audio = new Audio(`/api/library/preview?id=${v.id}`)
    audio.onended = () => setPlayingId((cur) => (cur === v.id ? null : cur))
    audio.onerror = () => setPlayingId((cur) => (cur === v.id ? null : cur))
    audio.play().catch(() => setPlayingId(null))
    audioRef.current = audio
    setPlayingId(v.id)
  }

  return (
    <>
      <div className="lib-shell">
        <header className="lib-head">
          <Link href="/" style={{ textDecoration: 'none' }}>
            <LogoFull size={30} />
          </Link>
          <Link href="/dashboard" className="lib-back">Dashboard →</Link>
        </header>

        <main className="lib-main">
          <h1 className="lib-title">Voice Library</h1>
          <p className="lib-sub">
            Community-shared AI voices, free to use in your own swaps. Every voice here was
            published by its owner, with consent to share. Paid licensing and creator
            earnings are coming later — today everything in the Library is free.
          </p>

          <div className="lib-filters">
            <input
              className="lib-search"
              placeholder="Search voices…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search voices"
            />
            <select
              className="lib-lang"
              value={langFilter}
              onChange={(e) => setLangFilter(e.target.value)}
              aria-label="Filter by language"
            >
              <option value="all">All languages</option>
              {languages.map((l) => (
                <option key={l} value={l}>{langLabel(l)}</option>
              ))}
            </select>
          </div>

          {loading && <div className="lib-note">Loading…</div>}
          {!loading && loadError && (
            <div className="lib-note">Couldn’t load the library — refresh to try again.</div>
          )}

          {!loading && !loadError && voices.length === 0 && (
            <div className="lib-empty">
              <div className="lib-empty-ico">🌐</div>
              <div className="lib-empty-title">No shared voices yet</div>
              <p className="lib-empty-txt">
                Voices show up here when their owners publish them from Voice Lab.
                Train a voice and be the first to share one.
              </p>
              <Link href="/voice-lab" className="lib-btn-solid">Open Voice Lab</Link>
            </div>
          )}

          {!loading && !loadError && voices.length > 0 && shown.length === 0 && (
            <div className="lib-note">No voices match your search.</div>
          )}

          <div className="lib-grid">
            {shown.map((v) => (
              <div key={v.id} className="lib-card">
                <div className="lib-card-top">
                  <div className="lib-card-av">🎤</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="lib-card-name">{v.name}</div>
                    <div className="lib-card-tags">
                      <span className="lib-tag">{langLabel(v.language)}</span>
                      <span className="lib-tag">{v.type === 'studio' ? 'Studio' : 'Express'}</span>
                    </div>
                  </div>
                </div>
                {v.bio && <p className="lib-card-bio">{v.bio}</p>}
                <div className="lib-card-actions">
                  {v.hasPreview && (
                    <button className="lib-btn-ghost" onClick={() => togglePreview(v)}>
                      {playingId === v.id ? '■ Stop' : '▶ Preview'}
                    </button>
                  )}
                  <Link
                    href={`/voice-swap?libVoice=${v.id}`}
                    className="lib-btn-use"
                    title="Sign in required"
                  >
                    Use in Voice Swap →
                  </Link>
                </div>
              </div>
            ))}
          </div>

          <p className="lib-foot-note">
            Sharing your own voice? Publish it from Voice Lab’s My Voices panel — you can
            unpublish anytime.
          </p>
        </main>
      </div>

      <style suppressHydrationWarning>{`
        body { background: #05050F; }
        .lib-shell { min-height: 100vh; display: flex; flex-direction: column; background: #05050F; }
        .lib-head {
          padding: 18px 40px; border-bottom: 1px solid #2E2E56;
          display: flex; align-items: center; justify-content: space-between;
        }
        .lib-back { font-size: 13px; font-weight: 600; color: #A0A0C8; text-decoration: none; transition: color 0.2s; }
        .lib-back:hover { color: #F0F0FF; }
        .lib-main { flex: 1; width: 100%; max-width: 860px; margin: 0 auto; padding: 48px 24px 72px; }
        .lib-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 24px; font-weight: 700; letter-spacing: -0.5px; color: #F0F0FF; margin: 0 0 6px;
        }
        .lib-sub { font-size: 13px; color: #A0A0C8; line-height: 1.7; margin: 0 0 24px; max-width: 640px; }
        .lib-filters { display: flex; gap: 10px; margin-bottom: 22px; }
        .lib-search {
          flex: 1; min-width: 0;
          background: #0D0D22; border: 1px solid #3C3C6A; border-radius: 9px;
          padding: 11px 14px; color: #F0F0FF; font-size: 13px;
          font-family: Inter, sans-serif; outline: none; transition: border-color 0.2s;
        }
        .lib-search:focus { border-color: #9D5CFF; }
        .lib-search::placeholder { color: #6E6E96; }
        .lib-lang {
          background: #0D0D22; border: 1px solid #3C3C6A; border-radius: 9px;
          padding: 11px 14px; color: #F0F0FF; font-size: 13px;
          font-family: Inter, sans-serif; outline: none; cursor: pointer;
        }
        .lib-note { text-align: center; padding: 48px 0; font-size: 13px; color: #8E8EB4; }
        .lib-empty {
          background: #09091A; border: 1px solid #2E2E56;
          border-radius: 16px; padding: 48px 32px; text-align: center;
        }
        .lib-empty-ico { font-size: 34px; margin-bottom: 14px; }
        .lib-empty-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 18px; font-weight: 700; color: #F0F0FF; margin-bottom: 8px;
        }
        .lib-empty-txt { font-size: 13px; color: #A0A0C8; line-height: 1.7; max-width: 380px; margin: 0 auto 22px; }
        .lib-btn-solid {
          display: inline-block; padding: 11px 22px; border-radius: 9px; border: none;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          color: #fff; text-decoration: none;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.25s;
        }
        .lib-btn-solid:hover { box-shadow: 0 8px 24px rgba(157,92,255,.4); transform: translateY(-1px); }
        .lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
        .lib-card {
          background: #09091A; border: 1px solid #2E2E56; border-radius: 14px;
          padding: 18px; display: flex; flex-direction: column; gap: 10px;
          transition: border-color 0.2s;
        }
        .lib-card:hover { border-color: rgba(157,92,255,.35); }
        .lib-card-top { display: flex; align-items: center; gap: 11px; }
        .lib-card-av {
          width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
          background: linear-gradient(135deg, rgba(157,92,255,.3), rgba(249,69,158,.2));
          border: 1px solid rgba(157,92,255,.25);
          display: flex; align-items: center; justify-content: center; font-size: 17px;
        }
        .lib-card-name {
          font-size: 14px; font-weight: 600; color: #F0F0FF;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .lib-card-tags { display: flex; gap: 6px; margin-top: 4px; }
        .lib-tag {
          padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 700;
          letter-spacing: 0.5px; text-transform: uppercase;
          background: rgba(12,199,232,.08); color: #0CC7E8; border: 1px solid rgba(12,199,232,.18);
        }
        .lib-card-bio { font-size: 12px; color: #A0A0C8; line-height: 1.6; margin: 0; }
        .lib-card-actions { display: flex; gap: 8px; margin-top: auto; align-items: center; }
        .lib-btn-ghost {
          padding: 8px 14px; border-radius: 8px;
          border: 1px solid #3C3C6A; background: transparent; color: #C4C4E0;
          font-family: Inter, sans-serif; font-size: 12px; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
        }
        .lib-btn-ghost:hover { border-color: #9D5CFF; color: #9D5CFF; }
        .lib-btn-use {
          margin-left: auto; font-size: 12px; font-weight: 600; color: #9D5CFF;
          text-decoration: none; transition: color 0.2s;
        }
        .lib-btn-use:hover { color: #F9459E; }
        .lib-foot-note { font-size: 12px; color: #8E8EB4; line-height: 1.6; margin-top: 28px; text-align: center; }
        @media (max-width: 640px) {
          .lib-head { padding: 14px 20px; }
          .lib-main { padding-top: 28px; }
          .lib-filters { flex-direction: column; }
        }
      `}</style>
    </>
  )
}
