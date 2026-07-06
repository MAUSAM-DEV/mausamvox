'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { formatTime, pickRecorderMimeType, extFromMimeType } from '@/components/voice-lab/audioUtils'
import { encodeMp3, encodeWav } from '@/components/voice-swap/audioClip'
import { AudioPlayer } from '@/components/voice-swap/AudioPlayer'
import { LyricsPane } from './LyricsPane'

// Karaoke v1.5: sing over a backing track and download your take, now WITH
// the shared synced-lyrics pane (LyricsPane — same load/generate/edit/
// regenerate experience as Performance Mode). While recording, the pane
// follows the hidden backing element's clock; lines are deliberately NOT
// tappable here because seeking the backing mid-take would silently misalign
// the recording. Recording itself runs client-side: the backing mix, the mic
// recording (same MediaRecorder + mime negotiation as Voice Lab), and the
// final duet mix (decode → offline WebAudio sum → MP3, the mixStems pattern).
//
// Alignment is BEST-EFFORT: we timestamp the gap between recorder start and
// backing playback start and place the backing at that offset in the duet mix.
// Output/mic latency (tens of ms) is not compensated — hence the raw take is
// always offered alongside the mix, so an imperfect mix never eats a good take.

interface KaraokePanelProps {
  // One or more audio URLs summed into the backing track. Stem Studio passes
  // [bass, drums, other] (instrumental, no vocals); the saved-swap page passes
  // its single full-mix URL (duet with the clone vocal).
  backingUrls: string[]
  trackName: string
  // Short description of what the backing is, e.g. "the instrumental" or
  // "your saved track" — used in the copy.
  backingLabel: string
  // Durable vocal-stem path (track_lyrics.source_key) for the lyrics pane.
  // Null/absent = no lyrics UI (legacy swaps, manual-stems uploads).
  lyricsSourceKey?: string | null
  onToast: (msg: string) => void
}

type PrepState = 'preparing' | 'ready' | 'error'
type RecState = 'idle' | 'recording' | 'done'

// Sum decoded buffers into one stereo 44.1 kHz buffer (mono inputs feed both
// channels). Exported for PerformanceMode, which builds the same instrumental.
export async function sumBuffers(bufs: AudioBuffer[]): Promise<AudioBuffer> {
  const SR = 44100
  const duration = Math.max(...bufs.map((b) => b.duration))
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR), SR)
  bufs.forEach((buf) => {
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0)
  })
  return ctx.startRendering()
}

export function KaraokePanel({ backingUrls, trackName, backingLabel, lyricsSourceKey, onToast }: KaraokePanelProps) {
  const [prep, setPrep] = useState<PrepState>('preparing')
  const [recState, setRecState] = useState<RecState>('idle')
  const [seconds, setSeconds] = useState(0)
  // Backing playback position — drives the lyrics pane. Fed by BOTH the hidden
  // element (while recording) AND the idle "Backing track" AudioPlayer (while
  // previewing/singing along), so the lyrics follow in either mode.
  const [backTime, setBackTime] = useState(0)
  // True while the idle backing preview is playing (recording has its own gate
  // via recState). Either one makes the lyrics pane follow + word-highlight.
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [takeUrl, setTakeUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState<'' | 'take' | 'duet'>('')

  // The element LyricsPane's word-highlight rAF reads currentTime from — points
  // at whichever backing element is actually playing (idle preview player, or
  // the hidden recording element). The preview player exposes its element here.
  const previewElRef = useRef<HTMLAudioElement | null>(null)
  const lyricsClockRef = useRef<HTMLAudioElement | null>(null)
  const capturePreviewEl = useCallback((el: HTMLAudioElement | null) => {
    previewElRef.current = el
  }, [])

  const backingBufRef = useRef<AudioBuffer | null>(null)
  const backingUrlRef = useRef<string | null>(null) // object URL for playback
  const [backingReadyUrl, setBackingReadyUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const takeBlobRef = useRef<Blob | null>(null)
  const takeMimeRef = useRef<string>('')
  const offsetMsRef = useRef(0) // backing start delay relative to recorder start
  const timerRef = useRef<ReturnType<typeof setInterval>>()
  const mountedRef = useRef(true)

  // ── Prepare the backing track once ─────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true
    let cancelled = false
    async function prepare() {
      try {
        const ctx = new AudioContext()
        const bufs = await Promise.all(
          backingUrls.map(async (url) => {
            const res = await fetch(url)
            if (!res.ok) throw new Error(`backing fetch failed (${res.status})`)
            return ctx.decodeAudioData(await res.arrayBuffer())
          }),
        )
        await ctx.close()
        const mixed = bufs.length === 1 ? bufs[0] : await sumBuffers(bufs)
        if (cancelled) return
        backingBufRef.current = mixed
        // WAV object URL for the <audio> element — instant to encode, local only.
        const url = URL.createObjectURL(encodeWav(mixed))
        backingUrlRef.current = url
        setBackingReadyUrl(url)
        setPrep('ready')
      } catch (err) {
        console.error('[karaoke] backing prep failed:', err)
        if (!cancelled) setPrep('error')
      }
    }
    void prepare()
    return () => {
      cancelled = true
      mountedRef.current = false
      stopEverything()
      if (backingUrlRef.current) URL.revokeObjectURL(backingUrlRef.current)
      setTakeUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stopEverything = useCallback(() => {
    clearInterval(timerRef.current)
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop() } catch { /* already stopped */ }
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    audioRef.current?.pause()
  }, [])

  // ── Record ──────────────────────────────────────────────────────────────────
  async function startRecording() {
    if (prep !== 'ready' || recState === 'recording') return
    try {
      // Raw, unprocessed mic — echo cancellation would fight the backing track
      // and duck the vocal (same reasoning as Voice Lab's Pro Record).
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      streamRef.current = stream
      const mime = pickRecorderMimeType()
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      takeMimeRef.current = recorder.mimeType
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }

      recorder.onstart = () => {
        const t0 = performance.now()
        const audio = audioRef.current
        if (!audio) return
        audio.currentTime = 0
        void audio.play().then(() => {
          // Mic started at t0; backing audibly started ~now. Best-effort offset
          // for the duet mix (output latency not compensated).
          offsetMsRef.current = performance.now() - t0
        })
      }

      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        audioRef.current?.pause()
        clearInterval(timerRef.current)
        if (!mountedRef.current) return
        const blob = new Blob(chunksRef.current, { type: takeMimeRef.current || 'audio/webm' })
        takeBlobRef.current = blob
        setTakeUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
        setRecState('done')
      }

      // Recording plays the backing through the hidden element — point the
      // lyrics word-clock at it before we flip `playing` on (below). Clear the
      // preview flag: the idle player unmounts without firing onPause.
      lyricsClockRef.current = audioRef.current
      setPreviewPlaying(false)
      setSeconds(0)
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
      setRecState('recording')
      recorder.start()
    } catch (err) {
      console.error('[karaoke] mic failed:', err)
      onToast('Could not access your microphone — check browser permissions')
      setRecState('idle')
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
  }

  function recordAgain() {
    setTakeUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null })
    takeBlobRef.current = null
    setRecState('idle')
  }

  // ── Downloads ───────────────────────────────────────────────────────────────
  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function decodeTake(): Promise<AudioBuffer | null> {
    const blob = takeBlobRef.current
    if (!blob) return null
    try {
      const ctx = new AudioContext()
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
      await ctx.close()
      return buf
    } catch {
      return null
    }
  }

  async function downloadTake() {
    if (!takeBlobRef.current || busy) return
    setBusy('take')
    try {
      const decoded = await decodeTake()
      if (decoded) {
        saveBlob(encodeMp3(decoded), `${trackName} - my take.mp3`)
      } else {
        // Browser can't re-decode its own recording format — save it as-is.
        const ext = extFromMimeType(takeMimeRef.current)
        saveBlob(takeBlobRef.current, `${trackName} - my take.${ext}`)
        onToast(`Saved in your browser's recording format (.${ext})`)
      }
    } finally {
      setBusy('')
    }
  }

  async function downloadDuet() {
    if (!takeBlobRef.current || !backingBufRef.current || busy) return
    setBusy('duet')
    try {
      const take = await decodeTake()
      if (!take) {
        onToast("Couldn't decode your recording for mixing — the raw take download still works")
        return
      }
      const backing = backingBufRef.current
      const offsetS = Math.max(0, offsetMsRef.current) / 1000
      const SR = 44100
      const duration = Math.max(take.duration, offsetS + backing.duration)
      const ctx = new OfflineAudioContext(2, Math.ceil(duration * SR), SR)
      const takeSrc = ctx.createBufferSource()
      takeSrc.buffer = take
      takeSrc.connect(ctx.destination)
      takeSrc.start(0)
      const backSrc = ctx.createBufferSource()
      backSrc.buffer = backing
      backSrc.connect(ctx.destination)
      backSrc.start(offsetS)
      const mixed = await ctx.startRendering()
      saveBlob(encodeMp3(mixed), `${trackName} - duet.mp3`)
    } catch (err) {
      console.error('[karaoke] duet mix failed:', err)
      onToast('Mixing failed — the raw take download still works')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="kp-card">
      <div className="kp-head">
        <span className="kp-title">🎤 Sing over it</span>
      </div>
      <p className="kp-sub">
        Sing over {backingLabel} and download your take.
      </p>
      <p className="kp-hint">🎧 Use headphones — otherwise your mic also records the backing track from your speakers.</p>

      {/* Synced lyrics: generate/edit before you record, follow along during
          the take. No onSeek — jumping the backing mid-take would misalign
          the recording. */}
      <LyricsPane
        sourceKey={lyricsSourceKey}
        time={backTime}
        compact
        audioRef={lyricsClockRef}
        playing={recState === 'recording' || previewPlaying}
      />

      {prep === 'preparing' && <div className="kp-note">Preparing the backing track…</div>}
      {prep === 'error' && <div className="kp-note kp-note--err">Couldn&rsquo;t load the backing track — try re-opening this panel.</div>}

      {prep === 'ready' && (
        <>
          {/* Hidden element drives backing playback while recording. */}
          <audio
            ref={audioRef}
            src={backingReadyUrl ?? undefined}
            preload="auto"
            onEnded={stopRecording}
            onTimeUpdate={(e) => setBackTime(e.currentTarget.currentTime)}
          />

          {recState === 'idle' && (
            <>
              {/* Previewing/singing along here plays THIS element (not the hidden
                  recording one), so it drives the lyrics clock + word highlight. */}
              <AudioPlayer
                src={backingReadyUrl}
                label="Backing track"
                mediaRef={capturePreviewEl}
                onTimeUpdate={setBackTime}
                onPlayingChange={(p) => {
                  if (p) lyricsClockRef.current = previewElRef.current
                  setPreviewPlaying(p)
                }}
              />
              <div className="kp-actions">
                <button className="kp-btn-rec" onClick={startRecording}>● Record my take</button>
              </div>
            </>
          )}

          {recState === 'recording' && (
            <div className="kp-recording">
              <span className="kp-rec-dot" />
              <span className="kp-rec-time">{formatTime(seconds)}</span>
              <span className="kp-rec-lbl">Recording — backing track is playing</span>
              <button className="kp-btn-stop" onClick={stopRecording}>■ Stop</button>
            </div>
          )}

          {recState === 'done' && (
            <>
              <AudioPlayer src={takeUrl} label="My take (raw mic)" />
              <div className="kp-actions">
                <button className="kp-btn-solid" onClick={downloadTake} disabled={!!busy}>
                  {busy === 'take' ? 'Preparing…' : '⬇ My take'}
                </button>
                <button className="kp-btn-solid" onClick={downloadDuet} disabled={!!busy}>
                  {busy === 'duet' ? 'Mixing…' : '⬇ Duet mix'}
                </button>
                <button className="kp-btn-ghost" onClick={recordAgain} disabled={!!busy}>Record again</button>
              </div>
              <p className="kp-fine">
                Duet mix aligns your take with the backing as closely as the browser allows — if it
                sounds a touch off, the raw take is untouched and can be mixed properly in any editor.
              </p>
            </>
          )}
        </>
      )}

      <style suppressHydrationWarning>{`
        .kp-card {
          background: #09091A;
          border: 1px solid #1E1E3A;
          border-radius: 14px;
          padding: 18px;
          margin-top: 16px;
        }
        .kp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
        .kp-title {
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 15px; font-weight: 700; color: #F0F0FF;
        }
        .kp-tag {
          font-size: 10px; font-weight: 700; letter-spacing: 0.5px;
          color: #06B6D4; padding: 3px 10px; border-radius: 99px;
          background: rgba(6,182,212,.1); border: 1px solid rgba(6,182,212,.25);
        }
        .kp-sub { font-size: 12px; color: #7878A0; margin: 8px 0 4px; line-height: 1.6; }
        .kp-hint { font-size: 11px; color: #5A5A80; margin: 0 0 14px; }
        .kp-note { font-size: 12px; color: #5A5A80; padding: 14px 0; }
        .kp-note--err { color: #F87171; }
        .kp-actions { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
        .kp-btn-rec {
          padding: 10px 20px; border-radius: 9px; border: 1px solid rgba(239,68,68,.35);
          background: rgba(239,68,68,.1); color: #F87171;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .kp-btn-rec:hover { background: rgba(239,68,68,.18); }
        .kp-recording {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
          background: #0E0E20; border: 1px solid rgba(239,68,68,.25);
          border-radius: 10px; padding: 14px 16px;
        }
        .kp-rec-dot {
          width: 10px; height: 10px; border-radius: 50%; background: #EF4444;
          animation: kpPulse 1.1s ease-in-out infinite;
        }
        @keyframes kpPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
        .kp-rec-time {
          font-size: 14px; font-weight: 700; color: #F0F0FF;
          font-variant-numeric: tabular-nums;
        }
        .kp-rec-lbl { font-size: 11px; color: #7878A0; flex: 1; }
        .kp-btn-stop {
          padding: 8px 16px; border-radius: 8px; border: none;
          background: #EF4444; color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 12px; font-weight: 700; cursor: pointer;
        }
        .kp-btn-solid {
          padding: 9px 18px; border-radius: 8px; border: none;
          background: linear-gradient(135deg, #8B5CF6, #EC4899, #06B6D4); color: #fff;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.25s;
        }
        .kp-btn-solid:hover:not(:disabled) { box-shadow: 0 8px 24px rgba(139,92,246,.4); }
        .kp-btn-solid:disabled { opacity: 0.5; cursor: not-allowed; }
        .kp-btn-ghost {
          padding: 9px 18px; border-radius: 8px;
          border: 1px solid #2A2A4A; background: transparent; color: #C4C4E0;
          font-family: var(--font-grotesk), 'Space Grotesk', sans-serif;
          font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;
        }
        .kp-btn-ghost:hover:not(:disabled) { border-color: #8B5CF6; color: #8B5CF6; }
        .kp-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
        .kp-fine { font-size: 11px; color: #5A5A80; line-height: 1.6; margin: 12px 0 0; }
      `}</style>
    </div>
  )
}
