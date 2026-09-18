import { NextRequest, NextResponse } from 'next/server'
import { upcomingHearingsSource } from '@/sources'
import { buildXlsx, xlsxResponse } from '@/lib/xlsx'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * v204 (P-C): GET /api/upcoming-hearings/export?tin=302678824
 *
 * Server re-fetches the upcoming-hearings source (same adapter the section
 * uses — its result is coalesce-cached, so an export right after viewing the
 * tab costs no extra scraping) and builds the .xlsx.
 *
 * Columns: Sana | Vaqt | Sud | Ish raqami | Sudya | Sud turi
 */

const HEADERS = ['Sana', 'Vaqt', 'Sud', 'Ish raqami', 'Sudya', 'Sud turi']
const COL_WIDTHS = [14, 10, 40, 22, 32, 12]

async function GET_impl(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tin = (searchParams.get('tin') || '').trim()

  if (!tin || !/^\d{9}$/.test(tin)) {
    return NextResponse.json(
      { ok: false, error: "STIR aynan 9 ta raqamdan iborat boʻlishi kerak" },
      { status: 400 },
    )
  }

  let data
  try {
    data = await upcomingHearingsSource.run(tin)
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Majlislarni olib boʻlmadi" },
      { status: 502 },
    )
  }

  const hearings = (data?.hearings ?? []) as Array<Record<string, unknown>>
  if (hearings.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Kelgusi majlislar topilmadi" },
      { status: 404 },
    )
  }

  const rows = hearings.map((h) => ({
    Sana: (h.isoDate as string) || '-',
    Vaqt: (h.hearingTime as string) || '-',
    Sud: (h.courtName as string) || (h.courtTypeLabel as string) || '-',
    'Ish raqami': (h.caseNumber as string) || '-',
    Sudya: (h.judge as string) || '-',
    'Sud turi': (h.courtTypeLabel as string) || '-',
  }))

  const buf = await buildXlsx('Kelgusi majlislar', HEADERS, rows, COL_WIDTHS)
  const filename = `majlislar-${tin}-${new Date().toISOString().slice(0, 10)}.xlsx`
  return xlsxResponse(buf, filename)
}

export const GET = guard(GET_impl)
