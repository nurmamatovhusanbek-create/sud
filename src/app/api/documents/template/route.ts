import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/server/middleware'
import { readTemplate } from '@/lib/documents/fill.server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/documents/template?id=<docId>
 *
 * Streams the raw .docx TEMPLATE (placeholders intact) so the browser can fill
 * and render it live next to the form. The unfilled template holds no user
 * data — only the boilerplate — and the id is validated against the registry.
 */
async function GET_impl(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ ok: false, error: 'Hujjat turi tanlanmadi' }, { status: 400 })

  let buf: Buffer
  try {
    buf = await readTemplate(id)
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Shablon topilmadi' },
      { status: 404 },
    )
  }

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store',
    },
  })
}

export const GET = guard(GET_impl)
