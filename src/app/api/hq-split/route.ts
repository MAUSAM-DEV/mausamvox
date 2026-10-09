import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { persistStemFile } from '@/lib/stem-persist'
import { mvsepCreate, mvsepPoll, mvsepFile } from '@/lib/mvsep'

// Studio-quality vocals / music split for Voice Swap (2026-10-09): MVSEP
// BS-RoFormer "124 bands" (the best checkpoint listed: SDR vocals 12.33,
// instrumental 18.64). On Pehla Pyaar its instrumental matched the original's
// music-only parts to 40.7 dB, vs 18.7 dB for the four rebuilt Demucs stems.
// Runs NEXT TO Demucs (which still feeds the stem cards and is the fallback);
// the swap takes its vocals AND music from here so they line up exactly.
// Output: 16-bit FLAC (lossless, ~half a WAV — storage files are capped at 50 MB).
//
// POST {storagePath} → { hash }    GET ?hash=..&t=<ms since POST> → status/stems
// GET persists both files on success, so allow a minute like stem-split.
export const maxDuration = 60

const SEP_TYPE = '40'        // BS Roformer (vocals, instrumental)
const MODEL = '171'          // "124 bands" — highest SDR for both stems
const OVERLAP = '2'          // 50% (the setting the founder listened to)
const OUTPUT_FLAC_16 = '2'

async function signedInUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function POST(req: NextRequest) {
  try {
    const user = await signedInUser()
    if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    let body: { storagePath?: string }
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
    const { storagePath } = body
    if (!storagePath || storagePath.includes('..') || !storagePath.startsWith(`${user.id}/`)) {
      return NextResponse.json({ error: 'storagePath is required' }, { status: 400 })
    }
    const { data: signed, error } = await supabaseAdmin.storage.from('audio-uploads').createSignedUrl(storagePath, 21600)
    if (error || !signed?.signedUrl) return NextResponse.json({ error: 'Could not sign the upload' }, { status: 500 })

    const job = await mvsepCreate({ url: signed.signedUrl, sep_type: SEP_TYPE, add_opt1: MODEL, add_opt2: OVERLAP, output_format: OUTPUT_FLAC_16 })
    if ('error' in job) {
      console.error('[hq-split] create failed:', job.error)
      return NextResponse.json({ error: job.error }, { status: 502 })
    }
    console.log(`[hq-split] started MVSEP job ${job.hash}`)
    return NextResponse.json({ hash: job.hash })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[hq-split] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await signedInUser())) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    const hash = req.nextUrl.searchParams.get('hash') ?? ''
    if (!/^[A-Za-z0-9]{4,64}$/.test(hash)) return NextResponse.json({ error: 'hash is required' }, { status: 400 })
    const elapsedMs = Number(req.nextUrl.searchParams.get('t')) || 0

    const poll = await mvsepPoll(hash, elapsedMs)
    if (poll.state === 'processing') return NextResponse.json({ status: 'processing' })
    if (poll.state === 'failed') {
      console.error(`[hq-split] job ${hash} failed: ${poll.error}`)
      return NextResponse.json({ status: 'failed', error: poll.error })
    }
    const vocals = mvsepFile(poll.files, 'vocal')
    const instrumental = mvsepFile(poll.files, 'instrum')
    if (!vocals || !instrumental) return NextResponse.json({ status: 'failed', error: 'Could not find the vocals and instrumental in the MVSEP result' })

    const [v, i] = await Promise.all([
      persistStemFile('hq-split', `stems/hq-${hash}-vocals.flac`, vocals, 'audio/flac'),
      persistStemFile('hq-split', `stems/hq-${hash}-instrumental.flac`, instrumental, 'audio/flac'),
    ])
    console.log(`[hq-split] job ${hash} done in ${Math.round(elapsedMs / 1000)}s (stored: vocals ${!!v}, instrumental ${!!i})`)
    return NextResponse.json({
      status: 'succeeded',
      vocalsUrl: v?.url ?? vocals,
      instrumentalUrl: i?.url ?? instrumental,
      ...(v ? { vocalsPath: v.path } : {}),
      ...(i ? { instrumentalPath: i.path } : {}),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[hq-split] poll error:', msg)
    return NextResponse.json({ status: 'failed', error: msg })
  }
}
