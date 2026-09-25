import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/server/middleware'
import { generateDocx } from '@/lib/documents/fill.server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST /api/documents/generate   body: { docId: string, values: Record<string,string> }
 *
 * Fills the requested .docx template (src/lib/documents/templates) with the
 * posted form values and streams it back as an editable Word download.
 * See src/lib/documents/registry.ts for the doc/field definitions.
 */
async function POST_impl(req: NextRequest) {
  let body: { docId?: string; values?: Record<string, unknown>; letterhead?: unknown; blankLetterhead?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Notoʻgʻri soʻrov' }, { status: 400 })
  }

  const docId = typeof body.docId === 'string' ? body.docId : ''
  if (!docId) return NextResponse.json({ ok: false, error: 'Hujjat turi tanlanmadi' }, { status: 400 })

  // coerce every value to a string; ignore non-string junk
  const values: Record<string, string> = {}
  if (body.values && typeof body.values === 'object') {
    for (const [k, v] of Object.entries(body.values)) {
      if (typeof v === 'string') values[k] = v
      else if (typeof v === 'number' || typeof v === 'boolean') values[k] = String(v)
    }
  }

  const letterhead = typeof body.letterhead === 'string' ? body.letterhead : undefined
  const blankIfNone = body.blankLetterhead === true

  let out
  try {
    out = await generateDocx(docId, values, { letterhead, blankIfNone })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Hujjatni yaratib boʻlmadi' },
      { status: 400 },
    )
  }

  return new NextResponse(new Uint8Array(out.buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${out.filename}"`,
      'Content-Length': String(out.buffer.length),
      'Cache-Control': 'no-store',
    },
  })
}

export const POST = guard(POST_impl)
