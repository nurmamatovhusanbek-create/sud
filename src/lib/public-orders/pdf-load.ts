import 'server-only'
import { fetchOrderFile } from './source'
import { createOrderPdfLoader } from './order-pdf'
import { readPdf, writePdf } from './pdf-store'

/**
 * THE order-PDF loader of this server: disk cache, ONE captcha session at a time, and the pause after a captcha refusal. The `/file` route (a person's click) and the
 * bot link (a «Yuklash» pressed on a phone) share it, so a click and a request from the phone queue behind each other and a refusal rests both. Held on
 * `globalThis` because the route and the instrumentation hook are bundled separately and each would otherwise get its own queue and its own pause.
 */
type Loader = ReturnType<typeof createOrderPdfLoader>
const g = globalThis as unknown as { __sudOrderPdfLoader?: Loader }

export const loadOrderPdf: Loader = (id, opts) =>
  (g.__sudOrderPdfLoader ??= createOrderPdfLoader({
    read: readPdf,
    write: writePdf,
    fetch: fetchOrderFile,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
  }))(id, opts)
