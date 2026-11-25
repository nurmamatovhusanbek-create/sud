import { guard } from '@/server/middleware'
import { jsonFail } from '@/server/envelope'
import { isOrderFileId, pdfFileName } from '@/core/public-orders'
import { ManualDownloadRequired, NotPdfError } from '@/lib/public-orders/order-pdf'
import { loadOrderPdf } from '@/lib/public-orders/pdf-load'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

// one loader for the whole server (`lib/public-orders/pdf-load`): disk cache, one captcha at a time, same order joins the running request
const loadPdf = loadOrderPdf

/**
 * GET /api/public-orders/file?id=<pdf id>[&name=…]  → the order as a PDF.
 * Served from disk when downloaded before (a published order never changes: one captcha per order, ever); otherwise
 * fetched through a queue. The upstream wraps it in a multipart envelope; we cut the PDF out and serve application/pdf.
 * Only a uuid reaches the upstream URL.
 *
 * public.sud.uz now accepts a download only with a human-verified captcha token. When it refuses ours the answer is
 * 409 `manual_required` (and the automatic route rests for 30 min instead of burning more captchas): the screen then
 * asks the person to download that one order in their own browser and hand it to POST /api/public-orders/import.
 * `&retry=1` («qayta urinish») tries the automatic route again at once.
 */
export const GET = guard(async (req) => {
  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  if (!isOrderFileId(id)) return jsonFail('Fayl identifikatori notoʻgʻri', 'bad_request', 400)
  try {
    const { bytes, filename, saved, saveError } = await loadPdf(id, { retryAuto: url.searchParams.get('retry') === '1' })
    if (!saved) console.error(`[orders-file] ${id}: PDF diskka saqlanmadi: ${saveError}`)
    const name = pdfFileName(filename ?? url.searchParams.get('name') ?? '', 'qaror')
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        // never kept by the browser: a cached copy would answer a later click without the server ever seeing it, so the file would
        // not be (re)saved and the Qarorlar page could not move the order to «Yuklangan». The server serves it from disk anyway.
        'Cache-Control': 'private, no-store',
        // did the server KEEP the file? (the Qarorlar page only counts a kept file as «Yuklangan»)
        'X-Order-Saved': saved ? '1' : '0',
        ...(saved ? {} : { 'X-Order-Save-Error': encodeURIComponent((saveError ?? '').slice(0, 160)) }),
      },
    })
  } catch (e) {
    if (e instanceof ManualDownloadRequired) return jsonFail(e.message, 'manual_required', 409)
    if (e instanceof NotPdfError) return jsonFail('Fayl PDF emas', 'upstream_error', 502)
    return jsonFail(e instanceof Error ? e.message : 'Faylni olib boʻlmadi', 'upstream_error', 502)
  }
})
