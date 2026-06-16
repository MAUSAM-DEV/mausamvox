'use client'

import { useState } from 'react'
import { QuickRecordPanel } from './QuickRecordPanel'
import { ProRecordPanel } from './ProRecordPanel'
import { UploadRecordingPanel } from './UploadRecordingPanel'
import { MIN_DURATION_SEC, extFromMimeType } from './audioUtils'

type Mode = 'quick' | 'pro' | 'upload'
type CloneType = 'express' | 'studio'

export interface SavedVoice {
  id: string
  name: string
  type: string
  status: string
  model_url: string | null
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
      const form = new FormData()
      form.append('audio', captured.blob, `sample.${extFromMimeType(captured.mimeType)}`)
      form.append('name', name.trim())
      form.append('cloneType', cloneType)

      const res = await fetch('/api/voice-lab/upload-sample', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Could not save voice sample')

      onSaved(data.voice as SavedVoice)
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
