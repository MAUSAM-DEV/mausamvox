'use client'

import { useState } from 'react'
import { QuickRecordPanel } from './QuickRecordPanel'
import { ProRecordPanel } from './ProRecordPanel'
import { UploadRecordingPanel } from './UploadRecordingPanel'
import { MIN_DURATION_SEC, extFromMimeType } from './audioUtils'
import { RECORDING_SCRIPTS, nextScript } from './recordingScripts'

type Mode = 'quick' | 'pro' | 'upload'
type CloneType = 'express' | 'studio'

export interface SavedVoice {
  id: string
  name: string
  type: string
  status: string
  model_url: string | null
  sample_url: string | null
  created_at: string
}

interface RecordStepProps {
  cloneType: CloneType
  onToast: (msg: string) => void
  onSaved: (voice: SavedVoice) => void
}

interface Captured {
  blob: Blob
  mimeType: string
  durationSec: number
}

const MODES: { id: Mode; label: string; desc: string }[] = [
  { id: 'quick', label: 'Quick Record', desc: 'Record with your browser mic' },
  { id: 'pro', label: 'Pro Record', desc: 'Use an audio interface or condenser mic' },
  { id: 'upload', label: 'Upload Recording', desc: 'Already have a file? Upload it' },
]

export function RecordStep({ cloneType, onToast, onSaved }: RecordStepProps) {
  const [mode, setMode] = useState<Mode>('quick')
  const [captured, setCaptured] = useState<Captured | null>(null)
  const [name, setName] = useState('My Voice')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  // Read-aloud passage shown above Quick/Pro capture. Starts on the first script;
  // the "New script" button advances through the list.
  const [script, setScript] = useState(RECORDING_SCRIPTS[0])

  function handleModeChange(next: Mode) {
    setMode(next)
    setCaptured(null)
    setSaveError('')
  }

  function handleReset() {
    setCaptured(null)
    setSaveError('')
  }

  const canSave = captured && captured.durationSec >= MIN_DURATION_SEC && name.trim().length > 0

  async function handleSave() {
    if (!captured) return
    setSaving(true)
    setSaveError('')

    try {
      // Step 1: get a presigned upload URL (avoids Vercel's 4.5 MB body limit)
      const presignRes = await fetch('/api/voice-lab/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentType: captured.mimeType }),
      })
      const presign = await presignRes.json()
      if (!presignRes.ok) throw new Error(presign.error ?? 'Could not get upload URL')

      // Step 2: PUT the audio blob directly to Supabase Storage
      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': presign.mime },
        body: captured.blob,
      })
      if (!putRes.ok) throw new Error(`Storage upload failed (${putRes.status})`)

      // Step 3: create the voice_clones row (small JSON body — no Vercel limit concern)
      const createRes = await fetch('/api/voice-lab/create-clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), cloneType, path: presign.path, mime: presign.mime }),
      })
      const createData = await createRes.json()
      if (!createRes.ok) throw new Error(createData.error ?? 'Could not save voice')

      onSaved(createData.voice as SavedVoice)
      onToast('Voice sample saved — it now shows up in My Voices')
      setCaptured(null)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save voice sample')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="vlrec-card">
        <div className="vlrec-tabs">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={`vlrec-tab ${mode === m.id ? 'vlrec-tab--active' : ''}`}
              onClick={() => handleModeChange(m.id)}
            >
              <span className="vlrec-tab-label">{m.label}</span>
              <span className="vlrec-tab-desc">{m.desc}</span>
            </button>
          ))}
        </div>

        <div className="vlrec-body">
          {/* Read-aloud script — guidance on what to say. Shown for the two live
              capture modes (Quick/Pro); the Upload mode has no live recording. */}
          {(mode === 'quick' || mode === 'pro') && (
            <div className="vlrec-script">
              <div className="vlrec-script-head">
                <span className="vlrec-script-label">Read this aloud (or sing across your range):</span>
                {RECORDING_SCRIPTS.length > 1 && (
                  <button
                    type="button"
                    className="vlrec-script-shuffle"
                    onClick={() => setScript((s) => nextScript(s.id))}
                  >
                    ↻ New script
                  </button>
                )}
              </div>
              <p className="vlrec-script-text">{script.text}</p>
              <p className="vlrec-script-tip">
                🎤 For singing clones, don&apos;t read flatly — go <strong>low and high</strong>, and
                <strong> soft and loud</strong>, so the clone captures your full range.
              </p>
            </div>
          )}

          {mode === 'quick' && <QuickRecordPanel onCaptured={(blob, mimeType, durationSec) => setCaptured({ blob, mimeType, durationSec })} onReset={handleReset} />}
          {mode === 'pro' && <ProRecordPanel onCaptured={(blob, mimeType, durationSec) => setCaptured({ blob, mimeType, durationSec })} onReset={handleReset} />}
          {mode === 'upload' && <UploadRecordingPanel onCaptured={(blob, mimeType, durationSec) => setCaptured({ blob, mimeType, durationSec })} onReset={handleReset} />}
        </div>

        {captured && captured.durationSec >= MIN_DURATION_SEC && (
          <div className="vlrec-save-row">
            <input
              className="vlrec-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name this voice"
              maxLength={60}
            />
            <button className="vlrec-save-btn" onClick={handleSave} disabled={!canSave || saving}>
              {saving ? 'Saving…' : 'Save to My Voices'}
            </button>
          </div>
        )}

        {saveError && <div className="vlrec-save-error">{saveError}</div>}
      </div>

      <style suppressHydrationWarning>{`
        .vlrec-card {
          background: #121225;
          border: 1px solid #1E1E3A;
          border-radius: 14px;
          overflow: hidden;
          animation: vlFadeUp 0.3s ease;
          /* Don't let the flex column workspace compress the card below its
             content height — without this it shrinks and overflow:hidden clips
             the record button at the bottom instead of letting the workspace
             scroll. */
          flex-shrink: 0;
        }
        @keyframes vlFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .vlrec-tabs {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          border-bottom: 1px solid #1E1E3A;
        }
        .vlrec-tab {
          padding: 16px 14px;
          border: none;
          background: transparent;
          cursor: pointer;
          transition: all 0.2s;
          display: flex;
          flex-direction: column;
          gap: 3px;
          text-align: left;
          border-bottom: 2px solid transparent;
        }
        .vlrec-tab:hover { background: rgba(139,92,246,.04); }
        .vlrec-tab--active { background: rgba(139,92,246,.06); border-bottom-color: #8B5CF6; }
        .vlrec-tab-label {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; color: #F0F0FF;
        }
        .vlrec-tab-desc { font-size: 11px; color: #5A5A80; }
        .vlrec-body { padding: 32px 24px; }
        .vlrec-script {
          margin: 0 auto 16px; max-width: 560px;
          background: #0E0E20; border: 1px solid #1E1E3A; border-radius: 12px;
          padding: 12px 14px;
        }
        .vlrec-script-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px; margin-bottom: 7px; flex-wrap: wrap;
        }
        .vlrec-script-label {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 12px; font-weight: 600; color: #A78BFA; letter-spacing: 0.2px;
        }
        .vlrec-script-shuffle {
          border: 1px solid #2A2A4A; background: transparent; color: #8B5CF6;
          font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 7px;
          cursor: pointer; transition: all 0.2s; white-space: nowrap;
        }
        .vlrec-script-shuffle:hover { background: rgba(139,92,246,.1); border-color: rgba(139,92,246,.5); }
        .vlrec-script-text {
          margin: 0 0 8px; font-size: 13px; line-height: 1.55; color: #E2E2F5;
        }
        .vlrec-script-tip {
          margin: 0; font-size: 11.5px; line-height: 1.45; color: #8585A8;
          border-top: 1px solid #1A1A30; padding-top: 8px;
        }
        .vlrec-script-tip strong { color: #C4B5FD; font-weight: 600; }
        .vlrec-save-row {
          display: flex; gap: 10px; padding: 16px 24px;
          border-top: 1px solid #1E1E3A; background: rgba(139,92,246,.02);
          flex-wrap: wrap;
        }
        .vlrec-name-input {
          flex: 1; min-width: 160px;
          background: #0E0E20; border: 1px solid #1E1E3A; border-radius: 8px;
          padding: 10px 12px; font-size: 13px; color: #F0F0FF; outline: none;
          transition: border-color 0.2s;
        }
        .vlrec-name-input:focus { border-color: rgba(139,92,246,.5); }
        .vlrec-save-btn {
          padding: 10px 22px; border-radius: 8px; border: none;
          background: linear-gradient(135deg,#8B5CF6,#EC4899,#06B6D4);
          color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
          white-space: nowrap;
        }
        .vlrec-save-btn:hover:not(:disabled) { box-shadow: 0 8px 24px rgba(139,92,246,.4); transform: translateY(-1px); }
        .vlrec-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .vlrec-save-error { padding: 0 24px 16px; font-size: 12px; color: #F87171; }

        @media (max-width: 700px) {
          .vlrec-tabs { grid-template-columns: 1fr; }
          .vlrec-body { padding: 24px 16px; }
        }
      `}</style>
    </>
  )
}
