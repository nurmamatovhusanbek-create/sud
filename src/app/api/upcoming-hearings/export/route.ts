import { NextRequest, NextResponse } from 'next/server'
import { upcomingHearingsSource } from '@/sources'
import { buildXlsx, xlsxResponse } from '@/lib/xlsx'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * GET /api/upcoming-hearings/export?tin=302678824
 *
 * v204 (P-C): hearings Excel export — same adapter the Majlislar section
 * renders (upcomingHearingsSource), built server-side so the client just
 * fires a download GET.
 *
 * Columns: Sana | Vaqt | Sud | Ish raqami | Sudya | Sud turi
 */

const HEADERS = ['Sana', 'Vaqt', 'Sud', 'Ish raqami', 'Sudya', 'Sud turi']
const COL_WIDTHS = [14, 10, 40, 22, 28, 14]

async function GET_impl(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tin = (searchParams.get('tin') || '').trim()

  if (!tin || !/^\d{9}$/.test(tin)) {
    return NextResponse.json(
      { ok: false, error: "STIR aynan 9 ta raqamdan iborat boʻlishi kerak" },
      { status: 400 },
    )
  }

  try {
    const data = await upcomingHearingsSource.run(tin)
    const hearings = (data.hearings || []) as Record<string, unknown>[]

    if (hearings.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Kelgusi 90 kun ichida majlis topilmadi' },
        { status: 404 },
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
    return xlsxResponse(buf, `majlislar-${tin}-${new Date().toISOString().slice(0, 10)}.xlsx`)
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Majlislarni olib boʻlmadi" },
      { status: 502 },
    )
  }
}

export const GET = guard(GET_impl)
