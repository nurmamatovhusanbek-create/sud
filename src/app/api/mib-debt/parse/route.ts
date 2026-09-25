import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/server/middleware'
import { parseMibHtml } from '@/lib/mib'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 15

/**
 * POST /api/mib-debt/parse   body: { tin, html }
 *
 * The operator runs the mib.uz debt check in their own (UZ) browser and pastes
 * the result page here; we parse it into structured debts. No outbound request
 * is made (mib.uz geo-blocks non-UZ IPs), the HTML is never rendered or stored,
 * and the route is auth-guarded + rate-limited like the rest of the API.
 */
const MAX_HTML = 4 * 1024 * 1024 // 4 MB — a mib.uz result page is far smaller

async function POST_impl(req: NextRequest) {
  let body: { tin?: string; html?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Notoʻgʻri soʻrov' }, { status: 400 })
  }

  const tin = (body.tin || '').trim()
  const html = typeof body.html === 'string' ? body.html : ''

  if (!/^\d{9}$/.test(tin)) {
    return NextResponse.json({ ok: false, error: 'STIR 9 xonali boʻlishi kerak' }, { status: 400 })
  }
  if (!html.trim()) {
    return NextResponse.json({ ok: false, error: 'MIB natijasi (sahifa mazmuni) joylanmadi' }, { status: 400 })
  }
  if (html.length > MAX_HTML) {
    return NextResponse.json({ ok: false, error: 'Sahifa hajmi juda katta' }, { status: 413 })
  }

  const result = parseMibHtml(html, tin)
  return NextResponse.json({ ok: true, ...result })
}

export const POST = guard(POST_impl)
