import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import ffmpegPath from 'ffmpeg-static'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

// "Share as Video" — renders a branded vertical (9:16) MP4 of a saved track
// for Reels / Shorts / WhatsApp / TikTok. Server-side ffmpeg only (bundled
// binary, no model, no API cost, no credit charge — growth feature).
//
// POST { swapId }  → owner's own track (session auth + ownership check), or
// POST { token }   → any track behind a valid public share token (/s/<token>).
//
// The audio is fetched via a FRESH signed URL (sign-on-read, never stored),
// the first CLIP_SECONDS are rendered with an animated-gradient background,
// showwaves waveform and drawtext overlays (bundled Noto Sans TTF — drawtext
// needs a real font file; shipped via outputFileTracingIncludes), and the MP4
// bytes are returned directly — rendered on demand, nothing stored, no DB
// changes. Render time is logged (`[share-video] render ms=`) for tuning.
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// ── Tunable render settings ──────────────────────────────────────────────────
// Clip length: caps render time and upload size. A FULL-length render of a
// 4-min song would blow the 60 s function budget on a slow lambda, so the
// video is deliberately a teaser of the track's first CLIP_SECONDS.
const CLIP_SECONDS = 25
// 1080x1920 measured at ~4 s locally (~2.6 MB out); even 5× slower on a
// lambda fits the budget comfortably, so full Reels/Shorts resolution it is.
const VIDEO_W = 1080
const VIDEO_H = 1920
const FPS = 30
// Brand palette (matches the app's gradient: purple/pink on near-black).
const BG_TOP = '0x2A0F45'
const BG_BOTTOM = '0x05050F'
const WAVE_COLORS = '0x8B5CF6|0xEC4899'
const TITLE_COLOR = '0xF0F0FF'
const SUB_COLOR = '0xC4C4E0'
const TAG_COLOR = '0xA78BFA'
const TAG_TEXT = 'Made with MausamVox'
// Overlay text caps — keeps drawtext on one line at these font sizes.
const MAX_TITLE_CHARS = 30
const MAX_SUB_CHARS = 44
const FFMPEG_TIMEOUT_MS = 50000 // leave headroom inside maxDuration

const execFileAsync = promisify(execFile)

function truncate(s: string, max: number): string {
  const t = s.trim()
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…'
}

export async function POST(req: NextRequest) {
  try {
    if (!adminConfigured) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }
    if (!ffmpegPath) {
      return NextResponse.json({ error: 'Video rendering unavailable on this platform' }, { status: 500 })
    }

    let body: { swapId?: string; token?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // ── Resolve the track: owner (swapId) or public share token ─────────────
    let swap: { song_name: string; voice_used: string; result_path: string | null } | null = null
    if (body.swapId) {
      if (!UUID_RE.test(body.swapId)) {
        return NextResponse.json({ error: 'Invalid track id' }, { status: 400 })
      }
      const sessionClient = await createClient()
      const { data: { user } } = await sessionClient.auth.getUser()
      if (!user) {
        return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
      }
      const { data } = await supabaseAdmin
        .from('voice_swaps')
        .select('song_name, voice_used, result_path')
        .eq('id', body.swapId)
        .eq('user_id', user.id)
        .maybeSingle()
      swap = data
    } else if (body.token) {
      if (!UUID_RE.test(body.token)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 })
      }
      const { data } = await supabaseAdmin
        .from('voice_swaps')
        .select('song_name, voice_used, result_path')
        .eq('share_token', body.token)
        .maybeSingle()
      swap = data
    } else {
      return NextResponse.json({ error: 'swapId or token is required' }, { status: 400 })
    }

    if (!swap?.result_path) {
      return NextResponse.json({ error: 'Track not found' }, { status: 404 })
    }

    // ── Fetch the audio via a fresh signed URL (never a stored one) ──────────
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from('voice-swaps')
      .createSignedUrl(swap.result_path, 300)
    if (signErr || !signed?.signedUrl) {
      return NextResponse.json({ error: 'Could not load the track audio' }, { status: 500 })
    }
    const audioRes = await fetch(signed.signedUrl)
    if (!audioRes.ok) {
      return NextResponse.json({ error: `Audio download failed (http ${audioRes.status})` }, { status: 502 })
    }
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer())

    // ── Render ───────────────────────────────────────────────────────────────
    const fontFile = path.join(process.cwd(), 'assets', 'fonts', 'NotoSans-Regular.ttf')
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvox-sharevideo-'))
    try {
      const inFile = path.join(workDir, 'in.audio')
      const outFile = path.join(workDir, 'out.mp4')
      // User strings go via textfile= with expansion=none — fully literal, no
      // drawtext escaping pitfalls (quotes/colons/percent in song names).
      const titleFile = path.join(workDir, 'title.txt')
      const subFile = path.join(workDir, 'sub.txt')
      const tagFile = path.join(workDir, 'tag.txt')
      await Promise.all([
        fs.writeFile(inFile, audioBuffer),
        fs.writeFile(titleFile, truncate(swap.song_name || 'My track', MAX_TITLE_CHARS)),
        fs.writeFile(subFile, truncate(swap.voice_used || 'AI voice', MAX_SUB_CHARS)),
        fs.writeFile(tagFile, TAG_TEXT),
      ])

      const W = VIDEO_W
      const H = VIDEO_H
      const waveW = Math.round((W * 8) / 10)
      const waveH = Math.round((H * 28) / 100)
      const filter = [
        // Slowly-animated brand gradient background.
        `gradients=s=${W}x${H}:d=${CLIP_SECONDS}:speed=0.03:c0=${BG_TOP}:c1=${BG_BOTTOM}:x0=${W / 2}:y0=0:x1=${W / 2}:y1=${H}[bg]`,
        // Animated waveform of the actual audio.
        `[0:a]showwaves=s=${waveW}x${waveH}:mode=cline:rate=${FPS}:colors=${WAVE_COLORS}[wv]`,
        `[bg][wv]overlay=(W-w)/2:(H-h)/2:shortest=1[v1]`,
        `[v1]drawtext=fontfile=${fontFile}:textfile=${titleFile}:expansion=none:fontcolor=${TITLE_COLOR}:fontsize=${Math.round(W * 0.075)}:x=(w-text_w)/2:y=${Math.round(H * 0.22)}[v2]`,
        `[v2]drawtext=fontfile=${fontFile}:textfile=${subFile}:expansion=none:fontcolor=${SUB_COLOR}:fontsize=${Math.round(W * 0.042)}:x=(w-text_w)/2:y=${Math.round(H * 0.29)}[v3]`,
        `[v3]drawtext=fontfile=${fontFile}:textfile=${tagFile}:expansion=none:fontcolor=${TAG_COLOR}:fontsize=${Math.round(W * 0.05)}:x=(w-text_w)/2:y=${Math.round(H * 0.88)}[vout]`,
      ].join(';')

      const renderStart = Date.now()
      await execFileAsync(ffmpegPath, [
        '-v', 'error', '-y',
        '-t', String(CLIP_SECONDS), '-i', inFile,
        '-filter_complex', filter,
        '-map', '[vout]', '-map', '0:a',
        '-t', String(CLIP_SECONDS),
        '-r', String(FPS),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart',
        outFile,
      ], { timeout: FFMPEG_TIMEOUT_MS })

      const video = await fs.readFile(outFile)
      if (video.length === 0) throw new Error('Render produced an empty file')
      console.log(`[share-video] render ms=${Date.now() - renderStart} bytes=${video.length} clip=${CLIP_SECONDS}s res=${W}x${H}`)

      const safeName = (swap.song_name || 'track').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'track'
      return new NextResponse(new Uint8Array(video), {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${safeName} - MausamVox.mp4"`,
          'Cache-Control': 'no-store',
        },
      })
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {})
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[share-video] render failed:', msg)
    return NextResponse.json({ error: `Video render failed: ${msg}` }, { status: 500 })
  }
}
