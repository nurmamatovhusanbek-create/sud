import { NextRequest, NextResponse } from 'next/server'
import { getCompanyCases } from '@/lib/court-aggregate'
import { buildXlsx, xlsxResponse } from '@/lib/xlsx'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/court-cases/export?tin=302678824
 *
 * v204 (P-C): cases-list Excel export — server re-fetches so the client just
 * fires a download GET.
 * v205 (§6): now exports the MERGED list (live TIN + name-discovered rows when
 * the docket index is configured) and adds the "Manba" column
 * (source==='name' ? 'Nomdan' : 'STIR').
 *
 * Columns: Sud | Ish raqami | Daʼvogar | Javobgar | Sana | Holat | Sud turi | Manba
 */

const HEADERS = ['Sud', 'Ish raqami', "Daʼvogar", 'Javobgar', 'Sana', 'Holat', 'Sud turi', 'Manba']
const COL_WIDTHS = [40, 22, 35, 35, 12, 16, 12, 10]

const SUD_TURI = (t: string): string =>
  t === 'economic' ? 'Iqtisodiy' : t === 'civil' ? 'Fuqarolik' : "Maʼmuriy"

async function GET_impl(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tin = (searchParams.get('tin') || '').trim()

  if (!tin || !/^\d{9}$/.test(tin)) {
    return NextResponse.json(
      { ok: false, error: "STIR aynan 9 ta raqamdan iborat boʻlishi kerak" },
      { status: 400 },
    )
  }

  let cases
  try {
    cases = (await getCompanyCases(tin)).cases
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Sud ishlarini olib boʻlmadi" },
      { status: 502 },
    )
  }

  if (cases.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Sud ishlari topilmadi" },
      { status: 404 },
    )
  }

  const rows = cases.map((c) => ({
    Sud: c.courtName || '-',
    'Ish raqami': c.caseNumber || '-',
    "Daʼvogar": c.plaintiff || '-',
    Javobgar: c.defendant || '-',
    Sana: c.dateFiled || '-',
    Holat: c.caseStatus || '-',
    'Sud turi': SUD_TURI(c.courtType),
    Manba: c.source === 'name' ? 'Nomdan' : 'STIR',
  }))

  const buf = await buildXlsx('Sud ishlari', HEADERS, rows, COL_WIDTHS)
  const filename = `sud-ishlari-${tin}-${new Date().toISOString().slice(0, 10)}.xlsx`
  return xlsxResponse(buf, filename)
}

export const GET = guard(GET_impl)
