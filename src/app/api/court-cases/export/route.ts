import { NextRequest, NextResponse } from 'next/server'
import { searchCourtCasesDetailed } from '@/lib/court-case'
import { CASE_STATUSES, type CourtType } from '@/lib/court-case-types'
import { buildXlsx, xlsxResponse } from '@/lib/xlsx'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/court-cases/export?tin=302678824&courtTypes=economic,civil
 *
 * v204 (P-C): cases-list Excel export. The server re-fetches the case lists
 * for the requested court types (same adapters the on-screen list uses), so
 * the client doesn't need to hold the merged list — the section just fires a
 * download GET.
 *
 * Columns: Sud | Ish raqami | Daʼvogar | Javobgar | Sana | Holat | Sud turi
 */

const HEADERS = ['Sud', 'Ish raqami', "Daʼvogar", 'Javobgar', 'Sana', 'Holat', 'Sud turi']
const COL_WIDTHS = [40, 22, 35, 35, 12, 16, 12]

const VALID: CourtType[] = ['economic', 'civil', 'administrative']

const STATUS = (s: string | null | undefined): string => (s ? CASE_STATUSES[s]?.en ?? s : '-')

async function GET_impl(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tin = (searchParams.get('tin') || '').trim()
  const courtTypesParam = searchParams.get('courtTypes') || 'economic,civil,administrative'
  const courtTypes = courtTypesParam
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is CourtType => (VALID as string[]).includes(s))

  if (!tin || !/^\d{9}$/.test(tin)) {
    return NextResponse.json(
      { ok: false, error: "STIR aynan 9 ta raqamdan iborat boʻlishi kerak" },
      { status: 400 },
    )
  }
  if (courtTypes.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'courtTypes economic, civil yoki administrative boʻlishi kerak' },
      { status: 400 },
    )
  }

  // Fetch the requested court types in parallel (mirrors the stats GET path).
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 45_000))
  const searches = Promise.allSettled(
    courtTypes.map((ct) => searchCourtCasesDetailed(ct, 'tin', tin)),
  )

  const raced = await Promise.race([searches, timeout])
  if (raced === 'timeout') {
    return NextResponse.json(
      { ok: false, error: "Soʻrov vaqti tugadi (45s). Qayta urinib koʻring." },
      { status: 504 },
    )
  }

  const rows: string[][] = []
  const typeLabel = (ct: CourtType) =>
    ct === 'economic' ? 'Iqtisodiy' : ct === 'civil' ? 'Fuqarolik' : "Maʼmuriy"
  const dash = (v: string | null | undefined) => (!v || v === '—' || v === '-' ? '-' : v)

  let succeeded = 0
  raced.forEach((res, i) => {
    const ct = courtTypes[i]
    if (res.status === 'fulfilled') {
      const cases = res.value.cases || []
      if (cases.length > 0) succeeded++
      for (const c of cases) {
        if (!c?.caseNumber || c.caseNumber === '—' || c.caseNumber === '-') continue
        rows.push([
          dash(c.courtName) || '-',
          c.caseNumber,
          dash(c.plaintiff),
          dash(c.defendant),
          dash(c.dateFiled),
          STATUS(c.caseStatus),
          typeLabel(ct),
        ])
      }
    }
  })

  if (rows.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Tanlangan sud turlarida ishlar topilmadi' },
      { status: 404 },
    )
  }

  console.log(`[court-cases/export] tin=${tin} types=${courtTypes.join(',')} rows=${rows.length} (sources ok: ${succeeded}/${courtTypes.length})`)
  const buf = await buildXlsx('Sud ishlari', HEADERS, rows, COL_WIDTHS)
  return xlsxResponse(buf, `ishlar-${tin}-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export const GET = guard(GET_impl)
