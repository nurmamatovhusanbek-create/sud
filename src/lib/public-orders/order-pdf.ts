import { parseMultipartFile } from '@/core/public-orders'

/**
 * One order's PDF, the cheap way (pure: disk, network and clock are injected, so it is tested without any of them).
 *
 *  1. On disk already → served at once. A published order never changes, so each file costs ONE captcha, ever.
 *  2. Otherwise it is fetched through a single queue: one captcha session at a time with a gap between them (a burst of
 *     clicks must not look like a bot to the captcha, nor burn the VLM key's free quota), and a second request for the
 *     same order joins the one already running instead of spending another token.
 *  3. Only a real PDF is stored (an error page or a half answer never lands on disk).
 */

export class NotPdfError extends Error {
  constructor() {
    super('Fayl PDF emas')
  }
}

export interface OrderPdfDeps {
  read: (id: string) => Promise<Uint8Array | null>
  write: (id: string, bytes: Uint8Array) => Promise<void>
  /** the raw (multipart-wrapped) file from public.sud.uz, captcha included */
  fetch: (id: string) => Promise<Uint8Array>
  sleep: (ms: number) => Promise<void>
  now: () => number
}

export interface OrderPdf {
  bytes: Uint8Array
  /** the upstream's own file name (only on a fresh download) */
  filename: string | null
  cached: boolean
}

const isPdf = (b: Uint8Array): boolean => Buffer.from(b.subarray(0, 5)).toString('latin1') === '%PDF-'

export function createOrderPdfLoader(deps: OrderPdfDeps, gapMs = 2000) {
  const inflight = new Map<string, Promise<OrderPdf>>()
  let tail: Promise<unknown> = Promise.resolve()
  let lastStart = 0

  async function download(id: string): Promise<OrderPdf> {
    // another request may have stored it while this one waited in the queue
    const hit = await deps.read(id)
    if (hit) return { bytes: hit, filename: null, cached: true }
    const wait = lastStart + gapMs - deps.now()
    if (lastStart && wait > 0) await deps.sleep(wait)
    lastStart = deps.now()
    const raw = await deps.fetch(id)
    const part = parseMultipartFile(raw)
    const bytes = part?.bytes ?? raw // some files may already be plain
    if (!isPdf(bytes)) throw new NotPdfError()
    await deps.write(id, bytes).catch(() => {}) // a full disk must not lose the file the user just waited for
    return { bytes, filename: part?.filename ?? null, cached: false }
  }

  return async function load(id: string): Promise<OrderPdf> {
    const hit = await deps.read(id)
    if (hit) return { bytes: hit, filename: null, cached: true }
    const running = inflight.get(id)
    if (running) return running
    const job = tail.then(() => download(id))
    tail = job.catch(() => {}) // one failure never blocks the queue
    inflight.set(id, job)
    try {
      return await job
    } finally {
      inflight.delete(id)
    }
  }
}
