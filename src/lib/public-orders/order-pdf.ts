import { parseMultipartFile } from '@/core/public-orders'
import { CaptchaRefusedError } from './order-file'

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

/**
 * public.sud.uz refused every captcha token we could mint, so this order has to be downloaded by the person (in their own
 * browser) and handed to `/api/public-orders/import`. Thrown at once, without spending more captchas, while the refusal
 * is fresh (see `autoPauseMs`).
 */
export class ManualDownloadRequired extends Error {
  constructor(detail = '') {
    super(`public.sud.uz endi qarorni faqat odam tasdiqlagandan keyin beradi${detail ? ` (${detail})` : ''}`)
    this.name = 'ManualDownloadRequired'
  }
}

export interface OrderPdfDeps {
  read: (id: string) => Promise<Uint8Array | null>
  write: (id: string, bytes: Uint8Array, meta?: { name?: string | null; via?: 'download' | 'import' }) => Promise<void>
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

/** A file the person downloaded by hand: either the plain PDF or the site's multipart envelope. Anything else is refused. */
export function pdfFromUpload(raw: Uint8Array): { bytes: Uint8Array; filename: string | null } {
  const part = parseMultipartFile(raw)
  const bytes = part?.bytes ?? raw
  if (!isPdf(bytes)) throw new NotPdfError()
  return { bytes, filename: part?.filename ?? null }
}

export function createOrderPdfLoader(deps: OrderPdfDeps, gapMs = 2000, autoPauseMs = 30 * 60_000) {
  const inflight = new Map<string, Promise<OrderPdf>>()
  let tail: Promise<unknown> = Promise.resolve()
  let lastStart = 0
  // after a captcha refusal the automatic download is switched off for a while: every further click would burn up to
  // three more captcha sessions on a door that is known to be shut. `retryAuto` (the person's «qayta urinish») reopens it.
  let pausedUntil = 0
  let pausedWhy = ''

  async function download(id: string): Promise<OrderPdf> {
    // another request may have stored it while this one waited in the queue
    const hit = await deps.read(id)
    if (hit) return { bytes: hit, filename: null, cached: true }
    if (deps.now() < pausedUntil) throw new ManualDownloadRequired(pausedWhy) // refused while this one waited in the queue
    const wait = lastStart + gapMs - deps.now()
    if (lastStart && wait > 0) await deps.sleep(wait)
    lastStart = deps.now()
    let raw: Uint8Array
    try {
      raw = await deps.fetch(id)
    } catch (e) {
      if (e instanceof CaptchaRefusedError) {
        pausedUntil = deps.now() + autoPauseMs
        pausedWhy = e.message.replace(/^public\.sud\.uz file: /, '')
        throw new ManualDownloadRequired(pausedWhy)
      }
      throw e
    }
    const { bytes, filename } = pdfFromUpload(raw) // some files may already be plain
    await deps.write(id, bytes, { name: filename, via: 'download' }).catch(() => {}) // a full disk must not lose the file the user just waited for
    return { bytes, filename, cached: false }
  }

  return async function load(id: string, opts: { retryAuto?: boolean } = {}): Promise<OrderPdf> {
    const hit = await deps.read(id)
    if (hit) return { bytes: hit, filename: null, cached: true }
    if (opts.retryAuto) pausedUntil = 0
    else if (deps.now() < pausedUntil) throw new ManualDownloadRequired(pausedWhy)
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
