// Server-only — RunPod serverless HTTP client
// Used by voice training (/api/voice-lab/train) and voice inference (/api/voice-convert)
//
// Environment variables required (add in Vercel → Project Settings → Environment Variables):
//   RUNPOD_API_KEY              — from RunPod Settings → API Keys
//   RUNPOD_ENDPOINT_ID_INFER    — serverless endpoint running GPT-SoVITS inference worker
//   RUNPOD_ENDPOINT_ID_TRAIN    — serverless endpoint running GPT-SoVITS training worker
//                                 (can be the same endpoint ID as INFER if your worker handles both)

const RUNPOD_BASE = 'https://api.runpod.ai/v2'

export type RunPodStatus =
  | 'IN_QUEUE'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMED_OUT'

export interface RunPodJob<TOutput = unknown> {
  id: string
  status: RunPodStatus
  output?: TOutput
  error?: string
  delayTime?: number
  executionTime?: number
}

function apiKey(): string {
  const key = process.env.RUNPOD_API_KEY
  if (!key) throw new Error('RUNPOD_API_KEY is not set — add it to Vercel environment variables')
  return key
}

function endpointId(type: 'infer' | 'train'): string {
  const varName = type === 'infer' ? 'RUNPOD_ENDPOINT_ID_INFER' : 'RUNPOD_ENDPOINT_ID_TRAIN'
  const id = process.env[varName]
  if (!id) throw new Error(`${varName} is not set — add it to Vercel environment variables`)
  return id
}

// Submit a job to a RunPod serverless endpoint.
// Returns immediately with a job id; poll with getJob() to check status.
export async function submitJob<TInput>(
  type: 'infer' | 'train',
  input: TInput
): Promise<string> {
  const key = apiKey()
  const endpoint = endpointId(type)
  const url = `${RUNPOD_BASE}/${endpoint}/run`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ input }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`RunPod submit failed (${res.status}): ${body}`)
  }

  const data = (await res.json()) as { id: string }
  if (!data.id) throw new Error('RunPod returned no job id')
  return data.id
}

// Poll a RunPod job by id. Returns the current job state.
// Call this repeatedly until status is COMPLETED, FAILED, CANCELLED, or TIMED_OUT.
export async function getJob<TOutput = unknown>(
  type: 'infer' | 'train',
  jobId: string
): Promise<RunPodJob<TOutput>> {
  const key = apiKey()
  const endpoint = endpointId(type)
  const url = `${RUNPOD_BASE}/${endpoint}/status/${jobId}`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`RunPod status check failed (${res.status}): ${body}`)
  }

  return (await res.json()) as RunPodJob<TOutput>
}

// Synchronous shorthand: submit a job and poll until terminal state.
// maxWaitMs: how long to wait before giving up (default 10 min)
// pollIntervalMs: how often to check (default 3s)
// Use this in long-running API routes with maxDuration set appropriately.
export async function runJobSync<TInput, TOutput>(
  type: 'infer' | 'train',
  input: TInput,
  { maxWaitMs = 600_000, pollIntervalMs = 3_000 } = {}
): Promise<RunPodJob<TOutput>> {
  const jobId = await submitJob(type, input)
  const deadline = Date.now() + maxWaitMs

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollIntervalMs))
    const job = await getJob<TOutput>(type, jobId)

    if (
      job.status === 'COMPLETED' ||
      job.status === 'FAILED' ||
      job.status === 'CANCELLED' ||
      job.status === 'TIMED_OUT'
    ) {
      return job
    }
  }

  throw new Error(`RunPod job ${jobId} did not complete within ${maxWaitMs / 1000}s`)
}

// Check that both env vars are set. Call this at the top of routes that need RunPod
// to give a clear 500 immediately rather than a confusing error partway through.
export function assertRunPodConfigured(type: 'infer' | 'train' | 'both'): void {
  apiKey() // throws if missing
  if (type === 'infer' || type === 'both') endpointId('infer')
  if (type === 'train' || type === 'both') endpointId('train')
}
