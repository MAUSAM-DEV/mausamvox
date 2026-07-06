// Per-stage timing for Replicate-backed pipeline routes (instrumentation only —
// no behavior change). A completed Replicate prediction carries enough to split
// a run into the two parts we care about:
//   • cold-start / queue  = started_at − created_at  (waiting + container boot)
//   • compute             = metrics.predict_time      (actual model run time)
//   • total               = completed_at − created_at
//
// NOTE: delayTime / executionTime are RunPod's field names — Replicate does NOT
// return those. The values above are Replicate's equivalents (timestamps +
// metrics.predict_time), which is what these routes actually call.

// Structural subset of replicate's Prediction we read — keeps this decoupled
// from the SDK's exact type while still accepting a real prediction object.
interface PredictionTiming {
  id: string
  created_at?: string
  started_at?: string | null
  completed_at?: string | null
  metrics?: { predict_time?: number } | null
}

// Log a single TIMING line for a finished Replicate prediction. Safe on missing
// fields (logs "n/a"); never throws — this is best-effort instrumentation.
export function logReplicateTiming(tag: string, prediction: PredictionTiming): void {
  try {
    const created = prediction.created_at ? Date.parse(prediction.created_at) : NaN
    const started = prediction.started_at ? Date.parse(prediction.started_at) : NaN
    const completed = prediction.completed_at ? Date.parse(prediction.completed_at) : NaN

    const queueSec = Number.isFinite(created) && Number.isFinite(started)
      ? (started - created) / 1000 : null
    const predictSec = typeof prediction.metrics?.predict_time === 'number'
      ? prediction.metrics.predict_time : null
    // Prefer metrics.predict_time; fall back to (completed − started) if absent.
    const computeSec = predictSec ?? (Number.isFinite(started) && Number.isFinite(completed)
      ? (completed - started) / 1000 : null)
    const totalSec = Number.isFinite(created) && Number.isFinite(completed)
      ? (completed - created) / 1000 : null

    const fmt = (n: number | null) => (n == null ? 'n/a' : `${n.toFixed(1)}s`)
    console.log(
      `[${tag}] TIMING prediction=${prediction.id} ` +
      `cold-start/queue=${fmt(queueSec)} compute=${fmt(computeSec)} total=${fmt(totalSec)}`
    )
  } catch (err) {
    console.warn(`[${tag}] TIMING log failed:`, err instanceof Error ? err.message : String(err))
  }
}

// ── Unified per-stage timing (instrumentation only) ─────────────────────────
// A single greppable line per stage: `[timing] stage=<x> ms=<n> ...extra`.
// Grep Vercel logs for `[timing]` to read a whole swap at a glance. Emitted in
// ADDITION to the legacy `TIMING` lines above — nothing behavioural changes.
export function logStageTiming(stage: string, ms: number, extra?: Record<string, string | number | boolean>): void {
  try {
    const parts = [`stage=${stage}`, `ms=${Math.round(ms)}`]
    if (extra) for (const [k, v] of Object.entries(extra)) parts.push(`${k}=${v}`)
    console.log(`[timing] ${parts.join(' ')}`)
  } catch { /* best-effort instrumentation, never throws */ }
}

// Emit a `[timing]` line for a finished Replicate prediction, splitting the
// cold-start/queue wait from compute. `cold` = the container had to boot/queue
// longer than coldQueueSec (a warm pool queues ~0s). NOTE for RVC on the bare
// cog: the model re-downloads every run, so that download sits inside compute_ms
// regardless; `cold` here reflects container/pool cold-start (the queue), which
// is the only download-vs-warm signal Replicate actually exposes.
export function logReplicateStageTiming(stage: string, prediction: PredictionTiming, coldQueueSec = 10): void {
  try {
    const created = prediction.created_at ? Date.parse(prediction.created_at) : NaN
    const started = prediction.started_at ? Date.parse(prediction.started_at) : NaN
    const completed = prediction.completed_at ? Date.parse(prediction.completed_at) : NaN

    const queueSec = Number.isFinite(created) && Number.isFinite(started) ? (started - created) / 1000 : null
    const predictSec = typeof prediction.metrics?.predict_time === 'number' ? prediction.metrics.predict_time : null
    const computeSec = predictSec ?? (Number.isFinite(started) && Number.isFinite(completed) ? (completed - started) / 1000 : null)
    const totalSec = Number.isFinite(created) && Number.isFinite(completed)
      ? (completed - created) / 1000
      : (computeSec != null ? computeSec + (queueSec ?? 0) : null)

    logStageTiming(stage, (totalSec ?? computeSec ?? 0) * 1000, {
      cold: queueSec == null ? 'n/a' : String(queueSec > coldQueueSec),
      queue_ms: queueSec == null ? 'n/a' : Math.round(queueSec * 1000),
      compute_ms: computeSec == null ? 'n/a' : Math.round(computeSec * 1000),
    })
  } catch { /* best-effort instrumentation, never throws */ }
}
