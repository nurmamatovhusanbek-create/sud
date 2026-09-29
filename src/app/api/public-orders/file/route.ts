import { guard } from '@/server/middleware'
import { jsonFail } from '@/server/envelope'
import { fetchOrderFile } from '@/lib/public-orders/source'
import { isOrderFileId, parseMultipartFile, pdfFileName } from '@/core/public-orders'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/public-orders/file?id=<pdf id>[&name=…]  → the order as a PDF.
 * The upstream wraps it in a multipart envelope; we cut the PDF out and serve it as application/pdf.
 * Only a uuid reaches the upstream URL.
 */
export const GET = guard(async (req) => {
  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  if (!isOrderFileId(id)) return jsonFail('Fayl identifikatori notoʻgʻri', 'bad_request', 400)
  try {
    const raw = await fetchOrderFile(id)
    const part = parseMultipartFile(raw)
    const bytes = part?.bytes ?? raw // some files may already be plain
    if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') return jsonFail('Fayl PDF emas', 'upstream_error', 502)
    const name = pdfFileName(part?.filename ?? url.searchParams.get('name') ?? '', 'qaror')
    return new Response(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.length),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (e) {
    return jsonFail(e instanceof Error ? e.message : 'Faylni olib boʻlmadi', 'upstream_error', 502)
  }
})
