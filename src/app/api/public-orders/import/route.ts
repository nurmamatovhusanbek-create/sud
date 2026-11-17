import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { isOrderFileId } from '@/core/public-orders'
import { NotPdfError, pdfFromUpload } from '@/lib/public-orders/order-pdf'
import { writePdf } from '@/lib/public-orders/pdf-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** A court order is a few hundred KB; even a long judgment with scans stays far below this. */
export const MAX_ORDER_BYTES = 100 * 1024 * 1024

/**
 * POST /api/public-orders/import?id=<pdf id>   body: the PDF itself (application/pdf or application/octet-stream)
 *
 * The hand-over for public.sud.uz's human captcha: the person opens the order on the site in their own browser, saves
 * the PDF and gives it to the app here, for the order card they picked (so the id is theirs, not guessed from the file).
 * Stored exactly like an automatic download (`pdf-store`), so every later click is served from disk. Only a real PDF is
 * kept (an HTML error page or a wrong file never lands on disk); a site-wrapped multipart file is unwrapped.
 */
export const POST = guard(
  async (req) => {
    const id = new URL(req.url).searchParams.get('id') ?? ''
    if (!isOrderFileId(id)) return jsonFail('Fayl identifikatori notoʻgʻri', 'bad_request', 400)
    const raw = new Uint8Array(await req.arrayBuffer())
    if (!raw.length) return jsonFail('Fayl boʻsh', 'bad_request', 400)
    if (raw.length > MAX_ORDER_BYTES) return jsonFail('Fayl juda katta', 'too_large', 413)
    try {
      const { bytes, filename } = pdfFromUpload(raw)
      await writePdf(id, bytes)
      return jsonOk({ id, size: bytes.length, filename })
    } catch (e) {
      if (e instanceof NotPdfError) return jsonFail('Bu PDF fayl emas — public.sud.uz dan saqlangan qaror faylini tanlang', 'not_pdf', 422)
      return jsonFail('Faylni saqlab boʻlmadi', 'write_failed', 500)
    }
  },
  { maxBodyBytes: MAX_ORDER_BYTES + 1024 * 1024 },
)
