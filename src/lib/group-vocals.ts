// Group / backing-vocals check for Voice Swap.
//
// A voice swap converts ONE voice. Where a group (or loud backing harmonies)
// sings along with the lead, the separator can't pull the lead out cleanly,
// so every engine gets several voices blended together and the swap sounds
// rough or unclear there (found 2026-10-03: a group chorus garbled RVC and
// Seed-VC alike, while the same song's solo verse converted fine).
//
// Uses the lead/backing split the app already runs (karaoke-split) — no extra
// model, no cost. Rule: in each 5 s window where the lead is singing, flag it
// when the backing stem is within 6 dB of the lead. Warn when flagged windows
// cover at least 10% of the sung time (and at least 10 s). Prototype on 11 songs (2026-10-03):
// the group-chorus test song 35% (warn); 9 of 10 real uploads 0–4% (no warn).
// It is an estimate: unison singers that the separator leaves inside the lead
// stem are not seen, so the copy says it can miss some parts.

export const GV_WINDOW_SECONDS = 5
export const GV_BACKING_WITHIN_DB = -6      // backing louder than lead −6 dB → flagged
export const GV_MIN_LEAD_DBFS = -45         // quieter windows don't count as singing
export const GV_LEAD_ACTIVE_PERCENTILE = 30 // …nor do the song's quietest 30% of windows
export const GV_WARN_SHARE = 0.1            // warn when ≥10% of sung windows are flagged
export const GV_MIN_FLAGGED_WINDOWS = 2     // …and at least 10 s are flagged (one 5 s blip in a short clip isn't enough)

export interface GroupVocalsResult {
  warn: boolean
  flaggedShare: number                 // 0–1, flagged share of sung windows
  ranges: Array<[number, number]>      // flagged stretches in seconds [start, end)
}

function windowRms(x: Float32Array, size: number): number[] {
  const out: number[] = []
  for (let off = 0; off + size <= x.length; off += size) {
    let sum = 0
    for (let i = off; i < off + size; i++) sum += x[i] * x[i]
    out.push(Math.sqrt(sum / size))
  }
  return out
}

const toDb = (v: number) => 20 * Math.log10(v + 1e-9)

// Pure function: mono lead + backing samples at the same sample rate.
export function detectGroupVocals(lead: Float32Array, backing: Float32Array, sampleRate: number): GroupVocalsResult {
  const size = Math.round(GV_WINDOW_SECONDS * sampleRate)
  const n = Math.min(lead.length, backing.length)
  const rl = windowRms(lead.subarray(0, n), size)
  const rb = windowRms(backing.subarray(0, n), size)
  if (rl.length === 0) return { warn: false, flaggedShare: 0, ranges: [] }

  const sorted = [...rl].sort((a, b) => a - b)
  const pct = sorted[Math.min(sorted.length - 1, Math.floor((GV_LEAD_ACTIVE_PERCENTILE / 100) * (sorted.length - 1)))]
  const singingFloor = Math.max(GV_MIN_LEAD_DBFS, toDb(pct))

  let sung = 0
  const flagged: boolean[] = rl.map((l, i) => {
    const singing = toDb(l) > singingFloor
    if (singing) sung++
    return singing && toDb(rb[i]) - toDb(l) >= GV_BACKING_WITHIN_DB
  })

  const ranges: Array<[number, number]> = []
  let start = -1
  for (let i = 0; i <= flagged.length; i++) {
    if (i < flagged.length && flagged[i]) { if (start < 0) start = i }
    else if (start >= 0) { ranges.push([start * GV_WINDOW_SECONDS, i * GV_WINDOW_SECONDS]); start = -1 }
  }
  const flaggedCount = flagged.filter(Boolean).length
  const flaggedShare = sung > 0 ? flaggedCount / sung : 0
  return { warn: flaggedShare >= GV_WARN_SHARE && flaggedCount >= GV_MIN_FLAGGED_WINDOWS, flaggedShare, ranges }
}

const mss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

// "1:00–1:10, 1:30–1:40 and 2 more parts"
export function formatGroupVocalRanges(ranges: Array<[number, number]>, max = 4): string {
  const shown = ranges.slice(0, max).map(([a, b]) => `${mss(a)}–${mss(b)}`)
  const rest = ranges.length - shown.length
  if (rest > 0) return `${shown.join(', ')} and ${rest} more part${rest === 1 ? '' : 's'}`
  if (shown.length <= 1) return shown.join('')
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
}
