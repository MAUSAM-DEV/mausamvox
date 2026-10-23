// Storage transfers that can't eat a whole function (2026-10-23). On Vercel (bom1) a download or
// upload to Supabase Storage sometimes stalls with no error: four "Wife (English)" dataset preps in a
// row sat at "downloading audio" until Vercel killed them at 60 s, while the same-size Hindi file
// downloaded in 4.3 s minutes earlier. The user then saw only a generic message. So: every transfer
// gets a time limit, downloads are retried with a fresh link, and callers return a clear error.

export class TransferTimeout extends Error {
  constructor(what: string, ms: number) { super(`${what} took longer than ${Math.round(ms / 1000)} s`) }
}

// Resolves like `p`, or rejects with TransferTimeout after `ms` (the transfer itself may go on in
// the background — the caller just stops waiting for it).
export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new TransferTimeout(what, ms)), ms) }),
  ]).finally(() => clearTimeout(timer))
}

// GET a file with a per-attempt time limit; each attempt asks `freshUrl` for a new signed link.
// Throws the last error when every attempt failed.
export async function downloadWithRetry(
  freshUrl: () => Promise<string | null>,
  { attempts, timeoutMs, logTag }: { attempts: number; timeoutMs: number; logTag: string },
): Promise<Buffer> {
  let last: unknown = null
  for (let i = 1; i <= attempts; i++) {
    const started = Date.now()
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(new TransferTimeout('download', timeoutMs)), timeoutMs)
    try {
      const url = await freshUrl()
      if (!url) throw new Error('could not sign a download link')
      const res = await fetch(url, { signal: ctl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      console.log(`${logTag} downloaded ${buf.length} bytes in ${Date.now() - started} ms (attempt ${i}/${attempts})`)
      return buf
    } catch (err) {
      last = ctl.signal.aborted ? ctl.signal.reason : err
      console.warn(`${logTag} download attempt ${i}/${attempts} failed after ${Date.now() - started} ms:`, last instanceof Error ? last.message : String(last))
    } finally {
      clearTimeout(timer)
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}
