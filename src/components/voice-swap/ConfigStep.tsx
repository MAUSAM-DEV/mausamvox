'use client'

import Link from 'next/link'

type VoiceTab = 'My Voices' | 'Library' | 'Ghost Singers'
type Gender = 'Male' | 'Female' | 'Neutral'
type AgeRange = 'Young' | 'Mid' | 'Mature'
type DuetSinger = 'male' | 'female'

// Exported so VoiceSwapPage can hold this state and pass it to handleProcess later.
export type DuetMode = 'one' | 'both-split' | 'both-same'

export interface VoiceOption {
  id: string
  name: string
  sub: string
  avatarBg: string
  modelUrl?: string
}

interface ConfigStepProps {
  voiceTab: VoiceTab
  setVoiceTab: (t: VoiceTab) => void
  voices: VoiceOption[]
  voicesLoading: boolean
  selectedVoiceId: string | null
  setSelectedVoiceId: (id: string) => void
  gender: Gender
  setGender: (g: Gender) => void
  ageRange: AgeRange
  setAgeRange: (a: AgeRange) => void
  accent: string
  setAccent: (a: string) => void
  language: string
  setLanguage: (l: string) => void
  styleIntensity: number
  setStyleIntensity: (v: number) => void
  pitchShift: number
  setPitchShift: (v: number) => void
  // Duet mode — only rendered when hasDuet is true (both male+female URLs present).
  hasDuet?: boolean
  duetMode?: DuetMode
  setDuetMode?: (m: DuetMode) => void
  duetSinger?: DuetSinger
  setDuetSinger?: (s: DuetSinger) => void
  selectedVoiceId2?: string | null
  setSelectedVoiceId2?: (id: string) => void
}

const VOICE_TABS: VoiceTab[] = ['My Voices', 'Library', 'Ghost Singers']

const ACCENTS = ['Neutral', 'American', 'British', 'Indian', 'Australian', 'Irish']
const LANGUAGES = ['Same as Source', 'Hindi', 'English', 'Spanish', 'French', 'Japanese', 'Korean']

function SegControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: T[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="vs-seg">
      {options.map((opt) => (
        <button
          key={opt}
          className={`vs-seg-btn ${value === opt ? 'vs-seg-btn--active' : ''}`}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  )
}

const DUET_MODES: { id: DuetMode; icon: string; label: string; sub: string }[] = [
  { id: 'one',        icon: '🎙️', label: 'One Singer',   sub: 'Swap one voice, keep the other' },
  { id: 'both-split', icon: '👥', label: 'Both · 2 Voices', sub: 'Each singer gets a different voice' },
  { id: 'both-same',  icon: '🔄', label: 'Both · Same Voice', sub: 'One voice replaces both singers' },
]

function VoiceGrid({
  voices, voicesLoading, selectedVoiceId, setSelectedVoiceId,
}: {
  voices: VoiceOption[]
  voicesLoading: boolean
  selectedVoiceId: string | null
  setSelectedVoiceId: (id: string) => void
}) {
  if (voicesLoading) return <div className="vs-voice-loading">Loading your voices…</div>
  return (
    <div className="vs-voice-grid">
      {voices.map((v) => (
        <div
          key={v.id}
          className={`vs-voice-card ${selectedVoiceId === v.id ? 'vs-voice-card--selected' : ''} ${!v.modelUrl ? 'vs-voice-card--sample' : ''}`}
          onClick={() => setSelectedVoiceId(v.id)}
          title={!v.modelUrl ? 'Sample-only voice — full voice conversion requires model training' : undefined}
        >
          {selectedVoiceId === v.id && <div className="vs-va-check">✓</div>}
          <div className="vs-va-avatar" style={{ background: v.avatarBg }}>🎤</div>
          <div className="vs-va-name">{v.name}</div>
          <div className="vs-va-sub">{v.sub}{!v.modelUrl ? ' · sample only' : ''}</div>
        </div>
      ))}
      <Link href="/voice-lab" className="vs-voice-card vs-voice-card--add">
        <div className="vs-va-add-icon">+</div>
        <div className="vs-va-name">Add Voice</div>
        <div className="vs-va-sub">Clone a new voice</div>
      </Link>
    </div>
  )
}

export function ConfigStep({
  voiceTab, setVoiceTab, voices, voicesLoading, selectedVoiceId, setSelectedVoiceId,
  gender, setGender, ageRange, setAgeRange,
  accent, setAccent, language, setLanguage,
  styleIntensity, setStyleIntensity, pitchShift, setPitchShift,
  hasDuet, duetMode, setDuetMode, duetSinger, setDuetSinger,
  selectedVoiceId2, setSelectedVoiceId2,
}: ConfigStepProps) {
  const activeDuetMode = duetMode ?? 'one'

  return (
    <>
      <div className="vs-panel">

        {/* ── Duet mode picker — only when both male+female URLs are present ── */}
        {hasDuet && setDuetMode && (
          <>
            <div className="vs-section-lbl">Duet Mode</div>
            <div className="vs-duet-modes">
              {DUET_MODES.map((m) => (
                <button
                  key={m.id}
                  className={`vs-duet-mode-card${activeDuetMode === m.id ? ' vs-duet-mode-card--active' : ''}`}
                  onClick={() => setDuetMode(m.id)}
                >
                  <span className="vs-dmcard-icon">{m.icon}</span>
                  <span className="vs-dmcard-label">{m.label}</span>
                  <span className="vs-dmcard-sub">{m.sub}</span>
                </button>
              ))}
            </div>

            {/* Mode 1 sub-picker: which singer to swap */}
            {activeDuetMode === 'one' && setDuetSinger && (
              <div className="vs-duet-sub">
                <span className="vs-duet-sub-lbl">Which singer?</span>
                <div className="vs-seg" style={{ maxWidth: 220 }}>
                  {(['male', 'female'] as DuetSinger[]).map((s) => (
                    <button
                      key={s}
                      className={`vs-seg-btn${(duetSinger ?? 'male') === s ? ' vs-seg-btn--active' : ''}`}
                      onClick={() => setDuetSinger(s)}
                    >
                      {s === 'male' ? '♂ Male Vocal' : '♀ Female Vocal'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Mode 3 warning */}
            {activeDuetMode === 'both-same' && (
              <div className="vs-duet-warn">
                ⚠ Same voice applied to both singers. Works best when your voice matches the
                original gender — cross-gender may sound off.
              </div>
            )}

            <div className="vs-divider" />
          </>
        )}

        {/* Voice Picker */}
        <div className="vs-section-lbl">
          {hasDuet && activeDuetMode === 'both-split' ? 'Voice for Male Singer' : 'Choose Target Voice'}
        </div>

        <div className="vs-vtabs">
          {VOICE_TABS.map((t) => (
            <button
              key={t}
              className={`vs-vtab ${voiceTab === t ? 'vs-vtab--active' : ''}`}
              onClick={() => setVoiceTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <VoiceGrid
          voices={voices}
          voicesLoading={voicesLoading}
          selectedVoiceId={selectedVoiceId}
          setSelectedVoiceId={setSelectedVoiceId}
        />

        {/* Second voice section — Mode 2 only */}
        {hasDuet && activeDuetMode === 'both-split' && setSelectedVoiceId2 && (
          <>
            <div className="vs-divider" />
            <div className="vs-section-lbl">Voice for Female Singer</div>
            <VoiceGrid
              voices={voices}
              voicesLoading={voicesLoading}
              selectedVoiceId={selectedVoiceId2 ?? null}
              setSelectedVoiceId={setSelectedVoiceId2}
            />
          </>
        )}

        {/* Swap Controls */}
        <div className="vs-divider" />
        <div className="vs-section-lbl">Swap Controls</div>

        <div className="vs-controls-grid">
          <div className="vs-ctrl-group">
            <label className="vs-ctrl-lbl">Gender Lock</label>
            <SegControl<Gender>
              options={['Male', 'Female', 'Neutral']}
              value={gender}
              onChange={setGender}
            />
          </div>

          <div className="vs-ctrl-group">
            <label className="vs-ctrl-lbl">Age Range</label>
            <SegControl<AgeRange>
              options={['Young', 'Mid', 'Mature']}
              value={ageRange}
              onChange={setAgeRange}
            />
          </div>

          <div className="vs-ctrl-group">
            <label className="vs-ctrl-lbl">Accent</label>
            <div className="vs-select-wrap">
              <select
                className="vs-select"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
              >
                {ACCENTS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <span className="vs-select-arrow">▾</span>
            </div>
          </div>

          <div className="vs-ctrl-group">
            <label className="vs-ctrl-lbl">Output Language</label>
            <div className="vs-select-wrap">
              <select
                className="vs-select"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <span className="vs-select-arrow">▾</span>
            </div>
          </div>

          <div className="vs-ctrl-group vs-ctrl-full">
            <label className="vs-ctrl-lbl">
              Style Intensity
              <span className="vs-ctrl-val">{styleIntensity}</span>
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={styleIntensity}
              onChange={(e) => setStyleIntensity(Number(e.target.value))}
              className="vs-range"
              style={{ '--pct': `${(styleIntensity - 1) / 9 * 100}%` } as React.CSSProperties}
            />
            <div className="vs-range-labels">
              <span>Subtle (1)</span>
              <span>Full replacement (10)</span>
            </div>
          </div>

          <div className="vs-ctrl-group vs-ctrl-full">
            <label className="vs-ctrl-lbl">
              Pitch Shift
              <span className="vs-ctrl-val">
                {pitchShift > 0 ? `+${pitchShift}` : pitchShift} st
              </span>
            </label>
            <div className="vs-pitch-row">
              <button
                className="vs-pitch-btn"
                onClick={() => setPitchShift(Math.max(-12, pitchShift - 1))}
              >
                –
              </button>
              <div className="vs-pitch-track">
                <div
                  className="vs-pitch-fill"
                  style={{
                    left: '50%',
                    width: `${Math.abs(pitchShift) / 12 * 50}%`,
                    transform: pitchShift < 0 ? 'translateX(-100%)' : 'none',
                    background: 'linear-gradient(135deg,#8B5CF6,#EC4899,#06B6D4)',
                  }}
                />
                <div
                  className="vs-pitch-thumb"
                  style={{ left: `calc(${(pitchShift + 12) / 24 * 100}% - 8px)` }}
                />
              </div>
              <button
                className="vs-pitch-btn"
                onClick={() => setPitchShift(Math.min(12, pitchShift + 1))}
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .vs-section-lbl {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #5A5A80;
          margin-bottom: 14px;
        }
        .vs-vtabs {
          display: flex;
          gap: 4px;
          margin-bottom: 16px;
          border-bottom: 1px solid #1E1E3A;
          padding-bottom: 0;
        }
        .vs-vtab {
          padding: 7px 14px;
          border-radius: 6px 6px 0 0;
          border: none;
          background: transparent;
          font-size: 12px;
          font-weight: 500;
          color: #5A5A80;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
          bottom: -1px;
        }
        .vs-vtab:hover { color: #F0F0FF; }
        .vs-vtab--active {
          color: #F0F0FF;
          border-bottom: 2px solid #8B5CF6;
        }
        .vs-voice-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
          margin-bottom: 24px;
        }
        .vs-voice-loading {
          font-size: 12px;
          color: #5A5A80;
          padding: 24px 0;
          margin-bottom: 24px;
          text-align: center;
        }
        .vs-voice-card {
          background: #0E0E20;
          border: 1.5px solid #1E1E3A;
          border-radius: 12px;
          padding: 14px 10px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
        }
        .vs-voice-card:hover { border-color: rgba(139,92,246,.35); background: #121225; }
        .vs-voice-card--selected {
          border-color: #8B5CF6;
          background: rgba(139,92,246,.06);
        }
        .vs-voice-card--sample { opacity: 0.75; }
        .vs-voice-card--sample .vs-va-sub { color: #F59E0B; }
        .vs-voice-card--add {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          border-style: dashed;
          border-color: #2A2A4A;
          color: #5A5A80;
          text-decoration: none;
        }
        .vs-voice-card--add:hover { border-color: rgba(139,92,246,.4); color: #8B5CF6; }
        .vs-va-check {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #8B5CF6;
          color: #fff;
          font-size: 9px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .vs-va-avatar {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          margin: 0 auto 8px;
        }
        .vs-va-add-icon {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          border: 1.5px dashed #2A2A4A;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          margin: 0 auto 8px;
          transition: border-color 0.2s;
        }
        .vs-voice-card--add:hover .vs-va-add-icon { border-color: rgba(139,92,246,.5); }
        .vs-va-name {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 12px;
          font-weight: 600;
          color: #F0F0FF;
          margin-bottom: 2px;
        }
        .vs-va-sub { font-size: 10px; color: #5A5A80; }
        .vs-divider {
          height: 1px;
          background: #1E1E3A;
          margin: 20px 0;
        }
        .vs-controls-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }
        .vs-ctrl-full { grid-column: 1 / -1; }
        .vs-ctrl-group { display: flex; flex-direction: column; gap: 8px; }
        .vs-ctrl-lbl {
          font-size: 12px;
          font-weight: 600;
          color: #8888AA;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .vs-ctrl-val { color: #C4C4E0; font-weight: 500; }
        .vs-seg {
          display: flex;
          background: #0E0E20;
          border: 1px solid #1E1E3A;
          border-radius: 8px;
          padding: 3px;
          gap: 2px;
        }
        .vs-seg-btn {
          flex: 1;
          padding: 5px 4px;
          border: none;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          background: transparent;
          color: #7878A0;
        }
        .vs-seg-btn:hover { color: #F0F0FF; background: #1E1E3A; }
        .vs-seg-btn--active {
          background: linear-gradient(135deg,#8B5CF6,#EC4899);
          color: #fff;
          font-weight: 600;
        }
        .vs-select-wrap {
          position: relative;
        }
        .vs-select {
          width: 100%;
          background: #0E0E20;
          border: 1px solid #1E1E3A;
          border-radius: 8px;
          padding: 8px 28px 8px 12px;
          font-size: 12px;
          color: #C4C4E0;
          outline: none;
          cursor: pointer;
          appearance: none;
          transition: border-color 0.2s;
        }
        .vs-select:focus { border-color: rgba(139,92,246,.5); }
        .vs-select-arrow {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          color: #5A5A80;
          pointer-events: none;
          font-size: 11px;
        }
        .vs-range {
          -webkit-appearance: none;
          width: 100%;
          height: 4px;
          border-radius: 2px;
          background: linear-gradient(to right, #8B5CF6 0%, #EC4899 var(--pct), #1E1E3A var(--pct), #1E1E3A 100%);
          outline: none;
          cursor: pointer;
        }
        .vs-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #fff;
          border: 2px solid #8B5CF6;
          box-shadow: 0 0 6px rgba(139,92,246,.5);
          cursor: pointer;
        }
        .vs-range-labels {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: #5A5A80;
          margin-top: 2px;
        }
        .vs-pitch-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .vs-pitch-btn {
          width: 28px;
          height: 28px;
          border-radius: 6px;
          border: 1px solid #2A2A4A;
          background: #0E0E20;
          color: #C4C4E0;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .vs-pitch-btn:hover { border-color: #8B5CF6; color: #8B5CF6; }
        .vs-pitch-track {
          flex: 1;
          height: 4px;
          background: #1E1E3A;
          border-radius: 2px;
          position: relative;
        }
        .vs-pitch-fill {
          position: absolute;
          top: 0;
          height: 100%;
          border-radius: 2px;
          transition: width 0.1s, left 0.1s;
        }
        .vs-pitch-thumb {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #fff;
          border: 2px solid #8B5CF6;
          box-shadow: 0 0 6px rgba(139,92,246,.5);
          transition: left 0.1s;
        }

        /* ── Duet mode picker ── */
        .vs-duet-modes {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 8px;
          margin-bottom: 16px;
        }
        .vs-duet-mode-card {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 4px;
          padding: 12px;
          border-radius: 10px;
          border: 1.5px solid #1E1E3A;
          background: #0E0E20;
          cursor: pointer;
          transition: all 0.2s;
          text-align: left;
        }
        .vs-duet-mode-card:hover { border-color: rgba(139,92,246,.35); background: #121225; }
        .vs-duet-mode-card--active {
          border-color: #8B5CF6;
          background: rgba(139,92,246,.07);
        }
        .vs-dmcard-icon { font-size: 18px; line-height: 1; }
        .vs-dmcard-label {
          font-size: 11px;
          font-weight: 700;
          color: #F0F0FF;
          line-height: 1.2;
        }
        .vs-dmcard-sub {
          font-size: 10px;
          color: #5A5A80;
          line-height: 1.4;
        }

        /* ── Duet sub-controls ── */
        .vs-duet-sub {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .vs-duet-sub-lbl {
          font-size: 11px;
          font-weight: 600;
          color: #8888AA;
          flex-shrink: 0;
        }
        .vs-duet-warn {
          font-size: 11px;
          color: #F59E0B;
          background: rgba(245,158,11,.08);
          border: 1px solid rgba(245,158,11,.2);
          border-radius: 8px;
          padding: 10px 12px;
          margin-bottom: 16px;
          line-height: 1.5;
        }

        @media (max-width: 600px) {
          .vs-voice-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .vs-controls-grid { grid-template-columns: 1fr !important; }
          .vs-duet-modes { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  )
}
