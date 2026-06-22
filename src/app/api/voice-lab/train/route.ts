import { NextRequest, NextResponse } from 'next/server'
import Replicate from 'replicate'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin, adminConfigured } from '@/lib/supabase/admin'

// 60s (not 30) because the GET completion-poll now also persists the trained
// model durably: it downloads the ~116 MB model zip from replicate.delivery and
// re-uploads it to the voice-models bucket before returning. That buffer-through
// can take tens of seconds.
export const maxDuration = 60

// replicate/train-rvc-model — pinned version (verified against the live
// OpenAPI schema). Despite the name it runs as a normal prediction: it takes
// a dataset zip and returns a single URI to the trained RVC model zip, which
// is exactly what /api/voice-convert consumes as custom_rvc_model_download_url.
const TRAIN_RVC_VERSION = '0397d5e28c9b54665e1e5d29d5cf4f722a7b89ec20e9dbf31487235305b1a101'

// Sensible Studio-tier defaults. epoch is overridable per request for tuning.
const DEFAULT_EPOCH = 50
const SAMPLE_RATE = '48k'
const RVC_MODEL_VERSION = 'v2'
const F0_METHOD = 'rmvpe_gpu'
const BATCH_SIZE = '7' // schema types batch_size as a string

// Durable home for trained models. PRIVATE bucket, no RLS policies — every access
// path is service-role or signed-URL (see migration 20260621000000). Path scheme:
// voice-models/<user_id>/<clone_id>.zip.
const VOICE_MODELS_BUCKET = 'voice-models'

// Replicate SDK v1 wraps file outputs in a FileOutput object whose .url()
// returns a URL — JSON.stringify shows {} because the value is non-enumerable.
function toUrlString(v: unknown): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.url === 'function') {
      try { return String((o.url as () => unknown)()) } catch { return '' }
    }
    if (typeof o.url === 'string') return o.url
  }
  return ''
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

// Buffer the trained model zip from its ephemeral replicate.delivery URL into the
// durable, private voice-models bucket and persist its path on the clone row.
// Best-effort: returns the stored path on success, or null on any failure (which
// is logged, never thrown). Callers MUST treat a null return as "no durable copy
// yet" and fall back to model_url — never let this break the training result.
async function persistModelDurably(
  userId: string,
  voiceCloneId: string,
  modelUrl: string,
): Promise<string | null> {
  const modelPath = `${userId}/${voiceCloneId}.zip`
  try {
    // 1. Download the model zip from replicate.delivery.
    const res = await fetch(modelUrl)
    if (!res.ok) {
      console.error(`[voice-lab/train] durable copy: download failed HTTP ${res.status} for ${voiceCloneId}`)
      return null
    }
    const zipBuffer = Buffer.from(await res.arrayBuffer())
    console.log('[voice-lab/train] durable copy: downloaded', zipBuffer.length, 'bytes for', voiceCloneId)

    // 2. Upload into the private voice-models bucket (upsert: a re-run overwrites
    //    rather than erroring on a stale partial object).
    const { error: uploadError } = await supabaseAdmin.storage
      .from(VOICE_MODELS_BUCKET)
      .upload(modelPath, zipBuffer, { contentType: 'application/zip', upsert: true })
    if (uploadError) {
      console.error('[voice-lab/train] durable copy: upload failed:', uploadError.message)
      return null
    }
    console.log('[voice-lab/train] durable copy: uploaded to', `${VOICE_MODELS_BUCKET}/${modelPath}`)

    // 3. Record the durable path — a SEPARATE update so a rejected write here
    //    (e.g. the column not yet live in the REST schema) can't touch the
    //    already-committed status/model_url row.
    const { error: pathError } = await supabaseAdmin
      .from('voice_clones')
      .update({ model_path: modelPath })
      .eq('id', voiceCloneId)
    if (pathError) {
      console.error('[voice-lab/train] durable copy: model_path update failed:', pathError.message)
      return null
    }

    console.log('[voice-lab/train] durable copy: model_path persisted for', voiceCloneId)
    return modelPath
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-lab/train] durable copy: unexpected error:', msg)
    return null
  }
}

// ── POST: kick off training ───────────────────────────────────────────────────
// Does NOT wait for training to finish (it takes minutes). Starts the Replicate
// prediction, stores its id on the voice_clones row, flips status to 'training',
// and returns immediately. The client polls GET below to learn when it's ready.
export async function POST(req: NextRequest) {
  console.log('[voice-lab/train] handler entered')
  try {
    if (!adminConfigured) {
      console.error('[voice-lab/train] SUPABASE_SERVICE_ROLE_KEY is not configured')
      return NextResponse.json(
        { error: 'Server configuration error: service role key is missing.' },
        { status: 500 }
      )
    }
    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    // ── 1. Authenticate ──────────────────────────────────────────────────────
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) {
      return NextResponse.json({ error: 'Auth error: ' + authError.message }, { status: 401 })
    }
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    // ── 2. Parse body ────────────────────────────────────────────────────────
    let body: { voiceCloneId?: string; epoch?: number }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { voiceCloneId } = body
    if (!voiceCloneId) {
      return NextResponse.json({ error: 'voiceCloneId is required' }, { status: 400 })
    }

    // Clamp epoch to a sane range; fall back to the default if not a number.
    const epoch =
      typeof body.epoch === 'number' && Number.isFinite(body.epoch)
        ? Math.min(1000, Math.max(1, Math.round(body.epoch)))
        : DEFAULT_EPOCH

    // ── 3. Load the clone, verify ownership, ensure the dataset exists ────────
    const { data: clone, error: cloneError } = await supabaseAdmin
      .from('voice_clones')
      .select('id, user_id, status, dataset_zip_url, training_prediction_id')
      .eq('id', voiceCloneId)
      .eq('user_id', user.id)
      .single()

    if (cloneError || !clone) {
      console.error('[voice-lab/train] clone not found:', cloneError?.message)
      return NextResponse.json({ error: 'Voice clone not found' }, { status: 404 })
    }
    if (!clone.dataset_zip_url) {
      return NextResponse.json(
        { error: 'No dataset prepared. Run dataset preparation before training.' },
        { status: 400 }
      )
    }
    // Idempotency guard: don't double-spend on a job that's already running.
    if (clone.status === 'training' && clone.training_prediction_id) {
      console.log('[voice-lab/train] already training:', clone.training_prediction_id)
      return NextResponse.json({
        predictionId: clone.training_prediction_id,
        status: 'training',
        alreadyRunning: true,
      })
    }

    // ── 4. Start the Replicate training prediction ───────────────────────────
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const prediction = await replicate.predictions.create({
      version: TRAIN_RVC_VERSION,
      input: {
        dataset_zip: clone.dataset_zip_url,
        sample_rate: SAMPLE_RATE,
        version: RVC_MODEL_VERSION,
        f0method: F0_METHOD,
        epoch,
        batch_size: BATCH_SIZE,
      },
    })
    console.log(`[voice-lab/train] started prediction ${prediction.id} (clone=${voiceCloneId}, epoch=${epoch}, status=${prediction.status})`)

    // ── 5. Persist prediction id + flip status to 'training' ─────────────────
    const { error: updateError } = await supabaseAdmin
      .from('voice_clones')
      .update({ status: 'training', training_prediction_id: prediction.id })
      .eq('id', voiceCloneId)

    if (updateError) {
      console.error('[voice-lab/train] DB update failed:', updateError.message)
      // The prediction is already running on Replicate; surface the id anyway so
      // the caller can still poll, but report that the row wasn't updated.
      return NextResponse.json(
        { error: `Training started but DB update failed: ${updateError.message}`, predictionId: prediction.id },
        { status: 500 }
      )
    }

    return NextResponse.json({ predictionId: prediction.id, status: prediction.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-lab/train] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ── GET: reconcile training status ─────────────────────────────────────────────
// Polled by the client with ?id=<voiceCloneId>. Self-healing: it reads the
// prediction id off the row, asks Replicate for the latest status, and on
// completion writes model_url + status='ready' back to the row. Because it
// reconciles from Replicate every call, the row converges to the correct state
// even if the user navigated away while training ran.
export async function GET(req: NextRequest) {
  try {
    if (!adminConfigured) {
      return NextResponse.json({ error: 'Service role key is missing.' }, { status: 500 })
    }
    if (!process.env.REPLICATE_API_TOKEN) {
      return NextResponse.json({ error: 'Replicate API token not configured' }, { status: 500 })
    }

    const voiceCloneId = req.nextUrl.searchParams.get('id')
    if (!voiceCloneId) {
      return NextResponse.json({ error: 'id (voiceCloneId) is required' }, { status: 400 })
    }

    // Authenticate and scope to the caller's own clone.
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    const { data: clone, error: cloneError } = await supabaseAdmin
      .from('voice_clones')
      .select('id, user_id, status, model_url, training_prediction_id')
      .eq('id', voiceCloneId)
      .eq('user_id', user.id)
      .single()

    if (cloneError || !clone) {
      return NextResponse.json({ error: 'Voice clone not found' }, { status: 404 })
    }

    // Already finished in a prior poll — return the stored result, no API call.
    if (clone.status === 'ready' && clone.model_url) {
      return NextResponse.json({ status: 'ready', modelUrl: clone.model_url })
    }
    if (!clone.training_prediction_id) {
      return NextResponse.json({ status: clone.status ?? 'pending', modelUrl: clone.model_url ?? null })
    }

    // Ask Replicate for the live status.
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN })
    const prediction = await replicate.predictions.get(clone.training_prediction_id)

    if (prediction.status === 'succeeded') {
      const modelUrl = toUrlString(prediction.output)
      if (!modelUrl) {
        return NextResponse.json(
          { status: 'failed', error: `Could not parse trained model URL. Output: ${safeStringify(prediction.output)}` },
          { status: 502 }
        )
      }
      // Persist the trained model URL — this is what /api/voice-convert consumes.
      const { error: upErr } = await supabaseAdmin
        .from('voice_clones')
        .update({ status: 'ready', model_url: modelUrl })
        .eq('id', voiceCloneId)
      if (upErr) {
        console.error('[voice-lab/train] failed to save model_url:', upErr.message)
        return NextResponse.json({ error: `Training succeeded but DB update failed: ${upErr.message}`, modelUrl }, { status: 500 })
      }
      console.log('[voice-lab/train] clone ready:', voiceCloneId, '->', modelUrl)

      // ── Durability (best-effort) ─────────────────────────────────────────────
      // model_url above points at replicate.delivery, which expires. Buffer the
      // model zip into our private voice-models bucket and record its durable
      // path. This is deliberately a SEPARATE update from the status/model_url
      // write above and is fully fault-isolated: any failure here (including the
      // model_path column not yet existing on the DB) is logged and swallowed, so
      // it can never regress the already-committed 'ready' + model_url result that
      // /api/voice-convert relies on. Swap-time consumption (Step 3) prefers
      // model_path and falls back to model_url, so a miss here is non-fatal.
      const modelPath = await persistModelDurably(clone.user_id, voiceCloneId, modelUrl)

      return NextResponse.json({ status: 'ready', modelUrl, modelPath })
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      await supabaseAdmin
        .from('voice_clones')
        .update({ status: 'failed' })
        .eq('id', voiceCloneId)
      return NextResponse.json({ status: 'failed', error: safeStringify(prediction.error) })
    }

    // starting | processing — still training.
    return NextResponse.json({ status: 'training', replicateStatus: prediction.status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[voice-lab/train] poll error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
