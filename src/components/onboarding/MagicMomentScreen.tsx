'use client'

import type { Persona } from './OnboardingPage'

// ─── content ─────────────────────────────────────────────────────────────────
// This screen shows a clearly-labelled PREVIEW of what the user's first result
// card will look like. It deliberately has no play button, no duration, and no
// score: an earlier version simulated playback (animated bars + a timer) with
// no audio behind it, which made new users believe they'd heard a real AI demo.
const RESULT_META = {
  artist: {
    eyebrow: 'The magic moment',
    sub:     'Clone your voice once, then swap it onto any song. Your first result card will look like this:',
    cover:   '🎵',
    track:   'Golden Hour — Demo',
    byLabel: 'Now singing:',
    byValue: 'Your voice clone',
  },
  producer: {
    eyebrow: 'The magic moment',
    sub:     'Upload your track, pick a voice, and get the full swapped song back. Your first result card will look like this:',
    cover:   '🔥',
    track:   'Midnight Trap — Your Mix',
    byLabel: 'Vocals:',
    byValue: 'Your chosen voice',
  },
  creator: {
    eyebrow: 'The magic moment',
    sub:     'Swap the voice on your clip and download the result. Your first result card will look like this:',
    cover:   '😤',
    track:   'Hype Intro — Your Clip',
    byLabel: 'Style:',
    byValue: 'Your chosen voice',
  },
}

// Static decorative waveform for the preview card. Deterministic heights so
// server and client render identically; no animation, no controls.
const PREVIEW_BAR_HEIGHTS = Array.from({ length: 56 }, (_, i) =>
  Math.max(4, (Math.sin(i * 0.3) * 0.4 + 0.55) * 30 + 4),
)

function PreviewBars() {
  return (
    <div className="obm-bars" aria-hidden="true">
      {PREVIEW_BAR_HEIGHTS.map((h, i) => (
        <div key={i} className="obm-bar" style={{ height: `${h}px` }} />
      ))}
    </div>
  )
}

// ─── component ────────────────────────────────────────────────────────────────
interface MagicMomentScreenProps {
  persona: Persona
  onNext: () => void
}

export function MagicMomentScreen({ persona, onNext }: MagicMomentScreenProps) {
  const meta = RESULT_META[persona]

  return (
    <>
      <div className="ob-screen ob-sc-center">
        <div className="ob-eyebrow">{meta.eyebrow}</div>

        {persona === 'artist' && (
          <h1 className="ob-h1">
            <span className="ob-gt">Your voice</span>,<br />on any track.
          </h1>
        )}
        {persona === 'producer' && (
          <h1 className="ob-h1">
            Your beat.<br /><span className="ob-gt">Pro vocals.</span>
          </h1>
        )}
        {persona === 'creator' && (
          <h1 className="ob-h1">
            Ready for<br /><span className="ob-gt">Reels &amp; Shorts.</span>
          </h1>
        )}

        <p className="ob-sub">{meta.sub}</p>

        <div className="obm-result-stage">
          <span className="obm-preview-tag">Preview</span>
          <div className="obm-result-head">
            <div className="obm-cover">{meta.cover}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="obm-track">{meta.track}</div>
              <div className="obm-by">
                {meta.byLabel} <b>{meta.byValue}</b>
              </div>
            </div>
          </div>

          <PreviewBars />
        </div>

        <div className="ob-btn-row">
          <button className="ob-btn-big" onClick={onNext}>
            Let&apos;s make mine →
          </button>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .obm-result-stage {
          max-width: 560px; margin: 0 auto 28px;
          background: #121225; border: 1px solid #2E2E56; border-radius: 16px;
          padding: 30px 28px; position: relative; overflow: hidden;
        }
        .obm-result-stage::before {
          content: ''; position: absolute; top: -90px; left: 50%; transform: translateX(-50%);
          width: 400px; height: 220px; border-radius: 50%;
          background: radial-gradient(ellipse, rgba(157,92,255,.14), transparent 70%);
          pointer-events: none;
        }
        .obm-preview-tag {
          position: absolute; top: 12px; right: 12px;
          font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
          padding: 3px 9px; border-radius: 99px;
          background: rgba(142,142,180,.15); color: #A0A0C8;
          border: 1px solid rgba(142,142,180,.3);
        }
        .obm-result-head {
          display: flex; align-items: center; gap: 12px; margin-bottom: 18px; position: relative;
        }
        .obm-cover {
          width: 52px; height: 52px; border-radius: 12px; flex-shrink: 0;
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          display: flex; align-items: center; justify-content: center; font-size: 22px;
        }
        .obm-track {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 16px; font-weight: 600; text-align: left; color: #F0F0FF;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .obm-by { font-size: 11px; color: #8E8EB4; text-align: left; margin-top: 2px; }
        .obm-by b {
          background: linear-gradient(135deg, #9D5CFF, #F9459E, #0CC7E8);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
          font-weight: 600;
        }
        .obm-bars {
          display: flex; align-items: center; gap: 2px;
          height: 38px; position: relative; overflow: hidden;
        }
        .obm-bar {
          width: 2.5px; flex-shrink: 0; border-radius: 1px;
          background: linear-gradient(180deg, rgba(157,92,255,.85), rgba(249,69,158,.85));
        }
        @media (max-width: 760px) { .obm-result-stage { padding: 22px 16px; } }
      `}</style>
    </>
  )
}
