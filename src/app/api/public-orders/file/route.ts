import { guard } from '@/server/middleware'
import { jsonFail } from '@/server/envelope'
import { fetchOrderFile } from '@/lib/public-orders/source'
import { isOrderFileId, pdfFileName } from '@/core/public-orders'
import { createOrderPdfLoader, NotPdfError } from '@/lib/public-orders/order-pdf'
import { readPdf, writePdf } from '@/lib/public-orders/pdf-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// one loader for the whole server: disk cache, one captcha at a time, same order joins the running request
const loadPdf = createOrderPdfLoader({
  read: readPdf,
  write: writePdf,
  fetch: fetchOrderFile,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: Date.now,
})

/**
 * GET /api/public-orders/file?id=<pdf id>[&name=…]  → the order as a PDF.
 * Served from disk when downloaded before (a published order never changes: one captcha per order, ever); otherwise
 * fetched through a queue. The upstream wraps it in a multipart envelope; we cut the PDF out and serve application/pdf.
 * Only a uuid reaches the upstream URL.
 */
export const GET = guard(async (req) => {
  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  if (!isOrderFileId(id)) return jsonFail('Fayl identifikatori notoʻgʻri', 'bad_request', 400)
  try {
    const { bytes, filename } = await loadPdf(id)
    const name = pdfFileName(filename ?? url.searchParams.get('name') ?? '', 'qaror')
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (e) {
    if (e instanceof NotPdfError) return jsonFail('Fayl PDF emas', 'upstream_error', 502)
    return jsonFail(e instanceof Error ? e.message : 'Faylni olib boʻlmadi', 'upstream_error', 502)
  }
})
