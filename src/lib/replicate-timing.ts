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
