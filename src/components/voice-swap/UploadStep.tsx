'use client'

import { useState, useRef, useEffect } from 'react'

type Phase = 'idle' | 'uploading' | 'splitting' | 'done' | 'error'
type UploadMode = 'full' | 'extracted-stems'
type StemCategory = 'vocals' | 'instrumental' | 'bass' | 'drums' | 'other' | 'unknown'
type ItemStatus = 'uploading' | 'done' | 'error'

const ACCEPTED_EXTS = ['mp3', 'wav', 'm4a']
const MAX_BYTES = 50 * 1024 * 1024 // 50 MB

function guessMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'mp3') return 'audio/mpeg'
  if (ext === 'm4a') return 'audio/mp4'
  if (ext === 'wav') return 'audio/wav'
  return 'audio/mpeg'
}

const CATEGORY_META: Record<StemCategory, { label: string; icon: string; required: boolean }> = {
  vocals:       { label: 'Vocals',       icon: '🎤', required: true },
  instrumental: { label: 'Instrumental', icon: '🎼', required: true },
  bass:         { label: 'Bass',         icon: '🎸', required: false },
  drums:        { label: 'Drums',        icon: '🥁', required: false },
  other:        { label: 'Other',        icon: '🎹', required: false },
  unknown:      { label: 'Unrecognized', icon: '❓', required: false },
}

// Filename → category, checked in this order so e.g. "instrumental" (which
// contains "inst") never gets miscategorized by a less specific rule.
const CATEGORY_RULES: { category: StemCategory; keywords: string[] }[] = [
  { category: 'vocals', keywords: ['vocal', 'voice', 'vox'] },
  { category: 'instrumental', keywords: ['instrumental', 'music', 'inst', 'karaoke', 'accompaniment'] },
  { category: 'bass', keywords: ['bass'] },
  { category: 'drums', keywords: ['drum', 'percussion', 'perc'] },
  { category: 'other', keywords: ['other', 'synth', 'melody', 'keys', 'keyboard', 'guitar', 'piano'] },
]

function detectCategory(filename: string): StemCategory {
  const lower = filename.toLowerCase()
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.category
  }
  return 'unknown'
}

interface DetectedItem {
  id: string
  file: File
  category: StemCategory
  status: ItemStatus
  url: string
  errorMsg: string
}

// Recursively reads a dropped FileSystemEntry (folder or file) into Files.
function readEntry(entry: FileSystemEntry): Promise<File[]> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file((file) => resolve([file]), () => resolve([]))
      return
    }
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      const collected: File[] = []
      const readBatch = () => {
        reader.readEntries(async (entries) => {
          if (entries.length === 0) { resolve(collected); return }
          for (const e of entries) collected.push(...(await readEntry(e)))
          readBatch() // directory readers page results — keep going until empty
        }, () => resolve(collected))
      }
      readBatch()
      return
    }
    resolve([])
  })
}

// Drag-and-drop of a folder needs the (non-standard but universally
// supported) webkitGetAsEntry API; a plain multi-file drop doesn't expose
// entries at all, so fall back to dataTransfer.files in that case.
async function getDroppedFiles(dt: DataTransfer): Promise<File[]> {
  const items = Array.from(dt.items ?? [])
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e)

  if (entries.length > 0) {
    const nested = await Promise.all(entries.map(readEntry))
    return nested.flat()
  }
  return Array.from(dt.files)
}

export interface StemResult {
  storagePath: string
  vocalsUrl: string
  // Lead/backing split of vocalsUrl, populated by /api/karaoke-split.
  // Optional: legacy cached results and the manual-stems path won't have them.
  // Every consumer falls back to vocalsUrl when leadVocalsUrl is empty.
  leadVocalsUrl?: string
  backingVocalsUrl?: string
  // Male/female split of vocalsUrl, populated by /api/gender-split (premium).
  // Optional, same as lead/backing: empty until a gender split runs; consumers
  // fall back to vocalsUrl. Nothing populates these yet (Layer 1 Step 1 adds the
  // fields only — the runner/trigger/UI come in later steps).
  maleVocalsUrl?: string
  femaleVocalsUrl?: string
  instrumentalUrl: string
  bassUrl: string
  drumsUrl: string
  otherUrl: string
  fileName: string
}

interface UploadStepProps {
  userId: string | null
  result: StemResult | null
  onDone: (result: StemResult) => void
  onContinue: () => void
  onToast: (msg: string) => void
}

function UploadWaveCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = canvas.offsetWidth * dpr
      canvas.height = canvas.offsetHeight * dpr
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(dpr, dpr)
      const W = canvas.offsetWidth
      const H = canvas.offsetHeight
      const grd = ctx.createLinearGradient(0, 0, W, 0)
      grd.addColorStop(0, 'rgba(139,92,246,.7)')
      grd.addColorStop(0.5, 'rgba(236,72,153,.7)')
      grd.addColorStop(1, 'rgba(6,182,212,.7)')
      ctx.fillStyle = grd
      const step = 3.5
      for (let i = 0; i < W / step; i++) {
        const h =
          (Math.sin(i * 0.3) * 0.3 + Math.sin(i * 0.7) * 0.2 + 0.5) * H * 0.75 + H * 0.08
        ctx.fillRect(i * step, (H - h) / 2, 2, h)
      }
    }, 50)
    return () => clearTimeout(timer)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        display: 'block',
        width: '100%',
        height: '48px',
        borderRadius: '8px',
        background: '#0E0E20',
        border: '1px solid #1E1E3A',
      }}
    />
  )
}

function validateFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ACCEPTED_EXTS.includes(ext)) {
    return `Only MP3, WAV, and M4A files are supported (got .${ext || 'unknown'}).`
  }
  if (file.size > MAX_BYTES) {
    return `File must be 50 MB or smaller (yours is ${(file.size / 1024 / 1024).toFixed(1)} MB).`
  }
  return null
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function UploadStep({ userId, result, onDone, onContinue, onToast }: UploadStepProps) {
  const [phase, setPhase] = useState<Phase>(result ? 'done' : 'idle')

  // When VoiceSwapPage restores a result from localStorage after initial render,
  // the result prop changes but phase is already 'idle' (useState only uses the
  // initial value once). Sync phase here so the done state renders correctly.
  useEffect(() => {
    if (result && phase === 'idle') {
      console.log('[stem-cache] restored result detected — switching phase to done')
      setPhase('done')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])
  const [dragging, setDragging] = useState(false)
  const [currentFile, setCurrentFile] = useState<File | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [uploadMode, setUploadMode] = useState<UploadMode>('full')
  const [items, setItems] = useState<DetectedItem[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [stemsDragging, setStemsDragging] = useState(false)
  const [downloadingZip, setDownloadingZip] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stemsFileInputRef = useRef<HTMLInputElement>(null)
  const stemsFolderInputRef = useRef<HTMLInputElement>(null)
  const itemIdCounterRef = useRef(0)

  async function processFile(file: File) {
    const validationError = validateFile(file)
    if (validationError) {
      setErrorMsg(validationError)
      setPhase('error')
      return
    }

    setCurrentFile(file)
    setErrorMsg('')
    setPhase('uploading')

    try {
      // Upload via the server-side route so the admin client handles storage
      // access — avoids RLS issues with the browser Supabase client.
      const form = new FormData()
      form.append('file', file)
      const uploadRes = await fetch('/api/upload-stem', { method: 'POST', body: form })
      const uploadData = await uploadRes.json()
      if (!uploadRes.ok) throw new Error(uploadData.error ?? 'Upload failed')

      setPhase('splitting')

      const res = await fetch('/api/stem-split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: uploadData.path }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Stem split failed')

      const stemResult: StemResult = {
        storagePath: uploadData.path,
        vocalsUrl:        data.vocals,
        leadVocalsUrl:    '',
        backingVocalsUrl: '',
        maleVocalsUrl:    '',
        femaleVocalsUrl:  '',
        instrumentalUrl: '',
        bassUrl:         data.bass,
        drumsUrl:        data.drums,
        otherUrl:        data.other,
        fileName:        file.name,
      }

      onDone(stemResult)
      setPhase('done')
      onToast('Stems separated — vocals and instrumental ready!')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setErrorMsg(msg)
      setPhase('error')
    }
  }

  async function uploadDetectedItem(id: string, file: File) {
    try {
      const mime = file.type || guessMime(file.name)

      // Step 1 — get a presigned upload URL (no file bytes go through Vercel)
      const presignRes = await fetch('/api/upload-stem/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: mime }),
      })
      const presign = await presignRes.json()
      if (!presignRes.ok) throw new Error(presign.error ?? 'Failed to get upload URL')

      // Step 2 — PUT file DIRECTLY to Supabase Storage (bypasses Vercel body size limit)
      const putRes = await fetch(presign.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': mime, 'x-upsert': 'false' },
      })
      if (!putRes.ok) throw new Error(`Storage upload failed (${putRes.status})`)

      // Step 3 — get a signed download URL now that the file exists in storage
      const signRes = await fetch('/api/upload-stem/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: presign.path }),
      })
      const sign = await signRes.json()
      if (!signRes.ok) throw new Error(sign.error ?? 'Failed to get download URL')

      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'done', url: sign.url } : it)))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: 'error', errorMsg: msg } : it)))
    }
  }

  function handleStemFiles(rawFiles: File[]) {
    if (rawFiles.length === 0) return

    // Silently drop hidden system files (.DS_Store etc.) and non-audio files
    const audioExts = new Set(ACCEPTED_EXTS)
    const files = rawFiles.filter((f) => {
      if (f.name.startsWith('.')) return false
      const ext = f.name.split('.').pop()?.toLowerCase() ?? ''
      return audioExts.has(ext)
    })

    if (files.length === 0) return

    const newItems: DetectedItem[] = []
    for (const file of files) {
      const validationError = validateFile(file)
      itemIdCounterRef.current += 1
      const id = `${itemIdCounterRef.current}-${file.name}`
      newItems.push({
        id,
        file,
        category: detectCategory(file.name),
        status: validationError ? 'error' : 'uploading',
        url: '',
        errorMsg: validationError ?? '',
      })
    }

    setItems((prev) => [...prev, ...newItems])
    newItems.filter((it) => it.status === 'uploading').forEach((it) => uploadDetectedItem(it.id, it.file))
  }

  function handleStemsFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    handleStemFiles(Array.from(e.target.files ?? []))
    e.target.value = ''
  }

  async function handleStemsDrop(e: React.DragEvent) {
    e.preventDefault()
    setStemsDragging(false)
    const files = await getDroppedFiles(e.dataTransfer)
    handleStemFiles(files)
  }

  function setItemCategory(id: string, category: StemCategory) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, category } : it)))
    setEditingId(null)
  }

  function removeItem(id: string) {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  function urlFor(category: StemCategory): string {
    // Last matching item wins if more than one file shares a category.
    const match = [...items].reverse().find((it) => it.category === category && it.status === 'done')
    return match?.url ?? ''
  }

  const hasVocals = items.some((it) => it.category === 'vocals' && it.status === 'done')
  // Accept any backing track — instrumental OR at least one of bass / drums / other
  const hasBackingTrack = items.some(
    (it) => ['instrumental', 'bass', 'drums', 'other'].includes(it.category) && it.status === 'done'
  )
  const canContinueStems = hasVocals && hasBackingTrack

  async function downloadAllStems(stemResult: StemResult) {
    setDownloadingZip(true)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()

      const entries = [
        { url: stemResult.vocalsUrl,       file: 'vocals.mp3' },
        { url: stemResult.instrumentalUrl, file: 'instrumental.mp3' },
        { url: stemResult.bassUrl,         file: 'bass.mp3' },
        { url: stemResult.drumsUrl,        file: 'drums.mp3' },
        { url: stemResult.otherUrl,        file: 'other.mp3' },
      ].filter((s) => s.url)

      await Promise.all(
        entries.map(async ({ url, file }) => {
          const res = await fetch(url)
          zip.file(file, await res.blob())
        })
      )

      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${stemResult.fileName.replace(/\.[^.]+$/, '')}-stems.zip`
      a.click()
      URL.revokeObjectURL(a.href)
      onToast('All stems downloaded as ZIP!')
    } catch {
      onToast('ZIP download failed — try individual files.')
    } finally {
      setDownloadingZip(false)
    }
  }

  function handleContinueStems() {
    // If no explicit instrumental, fall back to the first available backing track
    const instUrl = urlFor('instrumental') || urlFor('bass') || urlFor('drums') || urlFor('other')
    const stemResult: StemResult = {
      storagePath: '',
      vocalsUrl: urlFor('vocals'),
      leadVocalsUrl: '',
      backingVocalsUrl: '',
      maleVocalsUrl: '',
      femaleVocalsUrl: '',
      instrumentalUrl: instUrl,
      bassUrl: urlFor('bass'),
      drumsUrl: urlFor('drums'),
      otherUrl: urlFor('other'),
      fileName: items.find((it) => it.category === 'vocals')?.file.name ?? 'Extracted stems',
    }
    onDone(stemResult)
    setPhase('done')
    onToast('Stems ready — vocals and backing track loaded!')
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    // Reset so the same file can be re-selected after a reset
    e.target.value = ''
  }

  function handleReset() {
    setPhase('idle')
    setCurrentFile(null)
    setErrorMsg('')
    setItems([])
    setEditingId(null)
  }

  const displayFile = currentFile ?? (result ? { name: result.fileName, size: 0 } : null)
  const displayResult = result

  return (
    <>
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a"
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />
      <input
        ref={stemsFileInputRef}
        type="file"
        multiple
        accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a"
        style={{ display: 'none' }}
        onChange={handleStemsFileInput}
      />
      <input
        ref={stemsFolderInputRef}
        type="file"
        // @ts-expect-error -- non-standard but universally supported attribute for folder picking
        webkitdirectory="true"
        multiple
        style={{ display: 'none' }}
        onChange={handleStemsFileInput}
      />

      <div className="vs-panel">
        <div className="vs-panel-title">Upload Your Track</div>
        <div className="vs-panel-sub">
          {uploadMode === 'full'
            ? 'MP3, WAV, M4A — up to 50 MB · Stems separated automatically'
            : 'MP3, WAV, M4A — up to 50 MB per stem · Vocals and instrumental required'}
        </div>

        {/* ── idle ─────────────────────────────────────────────── */}
        {phase === 'idle' && (
          <>
            <div className="vs-upload-mode">
              <button
                className={`vs-upload-mode-btn ${uploadMode === 'full' ? 'vs-upload-mode-btn--active' : ''}`}
                onClick={() => setUploadMode('full')}
              >
                Upload Full Track
              </button>
              <button
                className={`vs-upload-mode-btn ${uploadMode === 'extracted-stems' ? 'vs-upload-mode-btn--active' : ''}`}
                onClick={() => setUploadMode('extracted-stems')}
              >
                Upload Extracted Stems
              </button>
            </div>

            {uploadMode === 'full' && (
              <div
                className={`vs-upload-zone ${dragging ? 'vs-upload-zone--drag' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="vs-uz-icon">🎵</div>
                <div className="vs-uz-title">Drop your track here</div>
                <div className="vs-uz-sub">or click to browse files</div>
                <div className="vs-uz-formats">MP3 · WAV · M4A · max 50 MB</div>
              </div>
            )}

            {uploadMode === 'extracted-stems' && (
              <>
                <div
                  className={`vs-upload-zone ${stemsDragging ? 'vs-upload-zone--drag' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setStemsDragging(true) }}
                  onDragLeave={() => setStemsDragging(false)}
                  onDrop={handleStemsDrop}
                  onClick={() => stemsFileInputRef.current?.click()}
                >
                  <div className="vs-uz-icon">🎵</div>
                  <div className="vs-uz-title">Drop your stems folder or files here</div>
                  <div className="vs-uz-sub">
                    or click to browse files ·{' '}
                    <span
                      className="vs-uz-folder-link"
                      onClick={(e) => { e.stopPropagation(); stemsFolderInputRef.current?.click() }}
                    >
                      select a folder
                    </span>
                  </div>
                  <div className="vs-uz-formats">Vocals + Instrumental required · MP3 · WAV · M4A · max 50 MB each</div>
                </div>

                {items.length > 0 && (
                  <div className="vs-detected-card">
                    {(!hasVocals || !hasBackingTrack) && (
                      <div className="vs-detected-missing">
                        ⚠ Missing:{' '}
                        {[
                          !hasVocals && 'Vocals',
                          !hasBackingTrack && 'at least one of Instrumental / Bass / Drums / Other',
                        ].filter(Boolean).join(' and ')}{' '}
                        (required)
                      </div>
                    )}
                    <div className="vs-detected-list">
                      {items.map((it) => {
                        const meta = CATEGORY_META[it.category]
                        return (
                          <div key={it.id} className={`vs-detected-row vs-detected-row--${it.status}`}>
                            <span className="vs-detected-icon">{meta.icon}</span>
                            <div className="vs-detected-info">
                              <div className="vs-detected-name">{it.file.name}</div>
                              <div className="vs-detected-sub">
                                {it.status === 'uploading' && 'Uploading…'}
                                {it.status === 'error' && it.errorMsg}
                                {it.status === 'done' && formatSize(it.file.size)}
                              </div>
                            </div>

                            {editingId === it.id ? (
                              <select
                                className="vs-detected-select"
                                value={it.category}
                                autoFocus
                                onChange={(e) => setItemCategory(it.id, e.target.value as StemCategory)}
                                onBlur={() => setEditingId(null)}
                              >
                                {(Object.keys(CATEGORY_META) as StemCategory[]).map((cat) => (
                                  <option key={cat} value={cat}>{CATEGORY_META[cat].label}</option>
                                ))}
                              </select>
                            ) : (
                              <span className={`vs-detected-badge vs-detected-badge--${it.category}`}>
                                {meta.label}{meta.required && ' *'}
                              </span>
                            )}

                            <button
                              className="vs-detected-edit"
                              title="Re-categorize"
                              onClick={() => setEditingId(editingId === it.id ? null : it.id)}
                            >
                              ✎
                            </button>
                            <button
                              className="vs-detected-remove"
                              title="Remove"
                              onClick={() => removeItem(it.id)}
                            >
                              ✕
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                <button
                  className="vs-continue-btn"
                  disabled={!canContinueStems}
                  onClick={handleContinueStems}
                >
                  Continue to Voice Swap →
                </button>
              </>
            )}
          </>
        )}

        {/* ── uploading ────────────────────────────────────────── */}
        {phase === 'uploading' && displayFile && (
          <div className="vs-progress-zone">
            <div className="vs-prog-spinner" />
            <div className="vs-prog-file">{displayFile.name}</div>
            <div className="vs-prog-label">Uploading to storage…</div>
          </div>
        )}

        {/* ── splitting ────────────────────────────────────────── */}
        {phase === 'splitting' && displayFile && (
          <div className="vs-progress-zone">
            <div className="vs-prog-spinner vs-prog-spinner--purple" />
            <div className="vs-prog-file">{displayFile.name}</div>
            <div className="vs-prog-label">Separating vocals… this takes 1–2 minutes</div>
            <div className="vs-prog-sub">Powered by Demucs · running on GPU</div>
          </div>
        )}

        {/* ── done ─────────────────────────────────────────────── */}
        {phase === 'done' && displayFile && displayResult && (
          <div className="vs-loaded-zone">
            <div className="vs-file-header">
              <span className="vs-file-ico">🎵</span>
              <div>
                <div className="vs-file-name">{displayResult.fileName}</div>
                <div className="vs-file-meta">
                  {currentFile ? formatSize(currentFile.size) + ' · ' : ''}
                  {displayResult.bassUrl || displayResult.instrumentalUrl ? 'Stems ready' : 'Vocals ready'}
                </div>
              </div>
              <span className="vs-file-remove" onClick={handleReset} title="Remove file">✕</span>
            </div>

            <UploadWaveCanvas />

            {/* Stem download cards — only render entries that have a URL */}
            <div className="vs-stems">
              {([
                { url: displayResult.vocalsUrl,       icon: '🎤', name: 'Vocals',       hint: 'Isolated voice track',   file: 'vocals.mp3' },
                { url: displayResult.backingVocalsUrl, icon: '🎶', name: 'Backing Vocals', hint: 'Backing / harmony vocals', file: 'backing-vocals.mp3' },
                { url: displayResult.instrumentalUrl, icon: '🎼', name: 'Instrumental', hint: 'Full backing track',     file: 'instrumental.mp3' },
                { url: displayResult.bassUrl,          icon: '🎸', name: 'Bass',         hint: 'Low-end bass line',      file: 'bass.mp3'   },
                { url: displayResult.drumsUrl,         icon: '🥁', name: 'Drums',        hint: 'Percussion only',        file: 'drums.mp3'  },
                { url: displayResult.otherUrl,         icon: '🎹', name: 'Other',        hint: 'Melody / instruments',   file: 'other.mp3'  },
              ] as const).filter(({ url }) => url).map(({ url, icon, name, hint, file }) => (
                <a
                  key={name}
                  className="vs-stem-card"
                  href={url}
                  download={file}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => onToast(`Downloading ${name.toLowerCase()}…`)}
                >
                  <span className="vs-stem-icon">{icon}</span>
                  <div>
                    <div className="vs-stem-name">{name}</div>
                    <div className="vs-stem-hint">{hint}</div>
                  </div>
                  <span className="vs-stem-dl">↓</span>
                </a>
              ))}
            </div>

            <button
              className="vs-zip-btn"
              disabled={downloadingZip}
              onClick={() => downloadAllStems(displayResult)}
            >
              {downloadingZip ? 'Preparing ZIP…' : '↓ Download All Stems (ZIP)'}
            </button>

            <button className="vs-continue-btn" onClick={onContinue}>
              Continue to Voice Swap →
            </button>
          </div>
        )}

        {/* ── error ────────────────────────────────────────────── */}
        {phase === 'error' && (
          <div className="vs-error-zone">
            <div className="vs-error-msg">{errorMsg}</div>
            <button
              className="vs-error-retry"
              onClick={handleReset}
            >
              Try again
            </button>
          </div>
        )}

        <div className="vs-supported-row">
          {['MP3', 'WAV', 'M4A'].map((fmt) => (
            <span key={fmt} className="vs-fmt-chip">{fmt}</span>
          ))}
          <span className="vs-fmt-chip">MAX 50 MB</span>
        </div>
      </div>

      <style suppressHydrationWarning>{`
        .vs-panel {
          animation: vsFadeUp 0.35s ease forwards;
        }
        @keyframes vsFadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .vs-panel-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 20px; font-weight: 700; color: #F0F0FF;
          letter-spacing: -0.5px; margin-bottom: 4px;
        }
        .vs-panel-sub { font-size: 13px; color: #5A5A80; margin-bottom: 28px; }

        /* ── upload mode toggle ── */
        .vs-upload-mode {
          display: flex;
          background: #0E0E20;
          border: 1px solid #1E1E3A;
          border-radius: 8px;
          padding: 3px;
          gap: 2px;
          margin-bottom: 16px;
        }
        .vs-upload-mode-btn {
          flex: 1;
          padding: 8px 10px;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          background: transparent;
          color: #7878A0;
        }
        .vs-upload-mode-btn:hover { color: #F0F0FF; background: #1E1E3A; }
        .vs-upload-mode-btn--active {
          background: linear-gradient(135deg,#8B5CF6,#EC4899);
          color: #fff;
          font-weight: 600;
        }

        /* ── detected stems summary ── */
        .vs-uz-folder-link { color: #8B5CF6; text-decoration: underline; cursor: pointer; }
        .vs-detected-card {
          border: 1px solid #1E1E3A; border-radius: 12px;
          padding: 14px; margin: 14px 0; background: rgba(139,92,246,.02);
        }
        .vs-detected-missing {
          font-size: 12px; color: #F59E0B; margin-bottom: 10px;
        }
        .vs-detected-list { display: flex; flex-direction: column; gap: 8px; }
        .vs-detected-row {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 10px; border-radius: 8px;
          background: #0E0E20; border: 1px solid #1E1E3A;
        }
        .vs-detected-row--error { border-color: rgba(239,68,68,.35); }
        .vs-detected-icon { font-size: 16px; flex-shrink: 0; }
        .vs-detected-info { flex: 1; min-width: 0; }
        .vs-detected-name { font-size: 12px; font-weight: 600; color: #F0F0FF; overflow-wrap: anywhere; }
        .vs-detected-sub { font-size: 10px; color: #5A5A80; }
        .vs-detected-row--error .vs-detected-sub { color: #F87171; }
        .vs-detected-badge {
          padding: 3px 9px; border-radius: 99px;
          font-size: 10px; font-weight: 700; white-space: nowrap; flex-shrink: 0;
          background: #1E1E3A; color: #C4C4E0;
        }
        .vs-detected-badge--vocals,
        .vs-detected-badge--instrumental {
          background: rgba(139,92,246,.12); color: #8B5CF6;
        }
        .vs-detected-badge--unknown { background: rgba(239,68,68,.1); color: #F87171; }
        .vs-detected-select {
          background: #0E0E20; border: 1px solid rgba(139,92,246,.5); border-radius: 6px;
          padding: 4px 6px; font-size: 11px; color: #F0F0FF; flex-shrink: 0;
        }
        .vs-detected-edit, .vs-detected-remove {
          width: 22px; height: 22px; border-radius: 6px; border: 1px solid #2A2A4A;
          background: transparent; color: #7878A0; font-size: 11px; cursor: pointer;
          flex-shrink: 0; display: flex; align-items: center; justify-content: center;
          transition: all 0.2s;
        }
        .vs-detected-edit:hover, .vs-detected-remove:hover { border-color: #8B5CF6; color: #8B5CF6; }

        /* ── drop zone ── */
        .vs-upload-zone {
          border: 1.5px dashed #2A2A4A; border-radius: 14px;
          padding: 48px 24px; text-align: center; cursor: pointer;
          transition: all 0.2s; background: rgba(139,92,246,.02);
        }
        .vs-upload-zone:hover,
        .vs-upload-zone--drag {
          border-color: rgba(139,92,246,.5);
          background: rgba(139,92,246,.05);
        }
        .vs-uz-icon { font-size: 32px; margin-bottom: 12px; }
        .vs-uz-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 16px; font-weight: 600; color: #F0F0FF; margin-bottom: 6px;
        }
        .vs-uz-sub { font-size: 13px; color: #5A5A80; margin-bottom: 8px; }
        .vs-uz-formats { font-size: 11px; color: #3A3A60; letter-spacing: 0.5px; }

        /* ── progress zone ── */
        .vs-progress-zone {
          border: 1px solid #1E1E3A; border-radius: 14px;
          padding: 40px 24px; text-align: center; background: rgba(139,92,246,.02);
          display: flex; flex-direction: column; align-items: center; gap: 10px;
        }
        .vs-prog-spinner {
          width: 36px; height: 36px; border-radius: 50%;
          border: 3px solid #1E1E3A;
          border-top-color: #8B5CF6;
          animation: vsSpin 0.8s linear infinite;
        }
        .vs-prog-spinner--purple { border-top-color: #EC4899; }
        @keyframes vsSpin { to { transform: rotate(360deg); } }
        .vs-prog-file { font-size: 13px; font-weight: 600; color: #F0F0FF; margin-top: 4px; }
        .vs-prog-label { font-size: 13px; color: #8B5CF6; }
        .vs-prog-sub { font-size: 11px; color: #5A5A80; }

        /* ── loaded zone ── */
        .vs-loaded-zone {
          border: 1px solid #2A2A4A; border-radius: 14px;
          padding: 18px; background: rgba(139,92,246,.03);
          display: flex; flex-direction: column; gap: 14px;
        }
        .vs-file-header { display: flex; align-items: center; gap: 12px; }
        .vs-file-ico { font-size: 22px; flex-shrink: 0; }
        .vs-file-name { font-size: 14px; font-weight: 600; color: #F0F0FF; margin-bottom: 2px; }
        .vs-file-meta { font-size: 11px; color: #5A5A80; }
        .vs-file-remove {
          margin-left: auto; font-size: 13px; color: #5A5A80; cursor: pointer;
          padding: 4px 8px; border-radius: 4px; transition: all 0.2s;
        }
        .vs-file-remove:hover { color: #F0F0FF; background: #1E1E3A; }

        /* ── stem cards ── */
        .vs-stems { display: flex; flex-direction: column; gap: 8px; }
        .vs-stem-card {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 14px; border-radius: 10px;
          background: #0E0E20; border: 1px solid #1E1E3A;
          text-decoration: none; cursor: pointer;
          transition: border-color 0.2s, background 0.2s;
        }
        .vs-stem-card:hover { border-color: rgba(139,92,246,.4); background: rgba(139,92,246,.04); }
        .vs-stem-icon { font-size: 20px; flex-shrink: 0; }
        .vs-stem-name { font-size: 13px; font-weight: 600; color: #F0F0FF; margin-bottom: 1px; }
        .vs-stem-hint { font-size: 11px; color: #5A5A80; }
        .vs-stem-dl {
          margin-left: auto; font-size: 16px; color: #8B5CF6;
          width: 28px; height: 28px; border-radius: 6px;
          background: rgba(139,92,246,.1); display: flex;
          align-items: center; justify-content: center;
          flex-shrink: 0; transition: background 0.2s;
        }
        .vs-stem-card:hover .vs-stem-dl { background: rgba(139,92,246,.2); }

        /* ── zip download button ── */
        .vs-zip-btn {
          width: 100%; padding: 10px; border-radius: 10px;
          border: 1px solid #2A2A4A;
          background: #0E0E20; color: #8B5CF6;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer;
          transition: all 0.2s; letter-spacing: 0.2px;
        }
        .vs-zip-btn:hover:not(:disabled) {
          border-color: rgba(139,92,246,.5);
          background: rgba(139,92,246,.06);
        }
        .vs-zip-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        /* ── continue button ── */
        .vs-continue-btn {
          width: 100%; padding: 12px; border-radius: 10px; border: none;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4);
          color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 14px; font-weight: 600; cursor: pointer;
          transition: all 0.25s; letter-spacing: 0.2px;
        }
        .vs-continue-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 10px 30px rgba(139,92,246,.4);
        }
        .vs-continue-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        /* ── error zone ── */
        .vs-error-zone {
          border: 1px solid rgba(239,68,68,.25); border-radius: 14px;
          padding: 28px 24px; text-align: center;
          background: rgba(239,68,68,.04);
          display: flex; flex-direction: column; align-items: center; gap: 14px;
        }
        .vs-error-msg { font-size: 13px; color: #F87171; line-height: 1.5; }
        .vs-error-retry {
          padding: 8px 20px; border-radius: 8px; border: 1px solid rgba(239,68,68,.3);
          background: transparent; color: #F87171; font-size: 13px; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
        }
        .vs-error-retry:hover { background: rgba(239,68,68,.08); }

        /* ── format chips ── */
        .vs-supported-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 20px; }
        .vs-fmt-chip {
          padding: 4px 12px; border-radius: 99px;
          background: #121225; border: 1px solid #1E1E3A;
          font-size: 10px; font-weight: 700; letter-spacing: 1.5px; color: #5A5A80;
        }
      `}</style>
    </>
  )
}
