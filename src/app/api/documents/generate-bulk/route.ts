import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/server/middleware'
import { generateBulkZip } from '@/lib/documents/bulk.server'
import { MAX_BULK_ROWS } from '@/lib/documents/bulk'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/documents/generate-bulk   body: { docId, rows: Record<string,string>[], letterhead?, blankLetterhead? }
 * One .docx per row (each row = the form's values with that row's cells over them), returned as one .zip.
 * The rows are read from the spreadsheet in the browser; the server only fills the template, as for one document.
 */
async function POST_impl(req: NextRequest) {
  let body: { docId?: unknown; rows?: unknown; letterhead?: unknown; blankLetterhead?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Notoʻgʻri soʻrov' }, { status: 400 })
  }
  const docId = typeof body.docId === 'string' ? body.docId : ''
  if (!docId) return NextResponse.json({ ok: false, error: 'Hujjat turi tanlanmadi' }, { status: 400 })
  if (!Array.isArray(body.rows) || !body.rows.length) return NextResponse.json({ ok: false, error: 'Qatorlar yoʻq' }, { status: 400 })
  if (body.rows.length > MAX_BULK_ROWS) return NextResponse.json({ ok: false, error: `Bir martada eng koʻpi bilan ${MAX_BULK_ROWS} ta qator` }, { status: 400 })

  const rows: Record<string, string>[] = body.rows.map((r) => {
    const o: Record<string, string> = {}
    if (r && typeof r === 'object') {
      for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
        if (typeof v === 'string') o[k] = v.slice(0, 5000)
        else if (typeof v === 'number' || typeof v === 'boolean') o[k] = String(v)
      }
    }
    return o
  })

  try {
    const out = await generateBulkZip(docId, rows, {
      letterhead: typeof body.letterhead === 'string' ? body.letterhead : undefined,
      blankIfNone: body.blankLetterhead === true,
    })
    return new NextResponse(new Uint8Array(out.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${out.filename}"`,
        'Content-Length': String(out.buffer.length),
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Hujjatlarni yaratib boʻlmadi' }, { status: 400 })
  }
}

export const POST = guard(POST_impl)
