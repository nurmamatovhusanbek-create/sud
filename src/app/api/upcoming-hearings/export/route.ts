import { NextRequest, NextResponse } from 'next/server'
import { buildXlsx, xlsxResponse } from '@/lib/xlsx'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST /api/upcoming-hearings/export   body: { tin, hearings: [...] }
 *
 * The Majlislar section already has the hearings loaded, so the export builds
 * the workbook from the posted rows instead of re-scraping sud.uz server-side
 * (the old GET re-scrape timed out / returned empty, so the button "did
 * nothing"). Mirrors the stats/bills exports, which also pass their data.
 *
 * Columns: Sana | Vaqt | Sud | Ish raqami | Sudya | Sud turi
 */

const HEADERS = ['Sana', 'Vaqt', 'Sud', 'Ish raqami', 'Sudya', 'Sud turi']
const COL_WIDTHS = [14, 10, 40, 22, 28, 14]

async function POST_impl(req: NextRequest) {
  let body: { tin?: string; hearings?: Record<string, unknown>[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Notoʻgʻri soʻrov' }, { status: 400 })
  }

  const tin = (body.tin || '').trim()
  const hearings = Array.isArray(body.hearings) ? body.hearings : []

  if (hearings.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Eksport qilish uchun majlis yoʻq' },
      { status: 400 },
    )
  }

  const rows = hearings.map((h) => [
    String(h.isoDate ?? '-'),
    String(h.hearingTime ?? '-'),
    String(h.courtName ?? h.courtTypeLabel ?? '-'),
    String(h.caseNumber ?? '-'),
    String(h.judge ?? '-'),
    String(h.courtTypeLabel ?? h.courtType ?? '-'),
  ])

  const buf = await buildXlsx('Majlislar', HEADERS, rows, COL_WIDTHS)
  return xlsxResponse(buf, `majlislar-${tin || 'export'}-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export const POST = guard(POST_impl)
