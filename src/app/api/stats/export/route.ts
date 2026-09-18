import { NextRequest, NextResponse } from 'next/server'
import { getCompanyStats, type CaseWithClassification, type StatsCourtType } from '@/lib/stats'
import { buildXlsx, xlsxResponse } from '@/lib/xlsx'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST /api/stats/export
 *   Body: { tin, courtTypes, cases, companyName }
 *
 *   Generates an .xlsx file from the case data POSTed by the client. This
 *   avoids re-fetching all stats data (4 parallel API calls) when the user
 *   already has the data on screen — export is now instant.
 *
 * GET /api/stats/export?tin=302678824&courtTypes=economic,civil
 *   (Backward-compat fallback) — re-fetches stats via getCompanyStats(tin)
 *   and filters by courtTypes. Kept for callers that donʼt have the data yet.
 *
 * The .xlsx is built MANUALLY using jszip (no Excel library dependency).
 * An .xlsx file is just a ZIP archive of XML files (Office Open XML format).
 * This avoids all Turbopack/bundler resolution issues with heavy Excel libs.
 *
 * Columns: Sud | Ish raqami | Daʼvogar | Javobgar | Sana | Natija | Holat | Sud turi
 */

// ---- XML helpers ----
// v204 (P-C): the hand-rolled JSZip/XML builder moved to src/lib/xlsx.ts
// (shared with api/bills/export and the new court-cases/hearings exports).

/**
 * Shared Excel builder — takes a list of classified cases + a company name
 * and returns a Node Buffer containing the .xlsx file.
 *
 * Used by both the POST handler (instant — case data POSTed by the client)
 * and the GET fallback (re-fetches stats first, then calls this).
 */
function buildExcelBuffer(
  cases: CaseWithClassification[],
  companyName: string,
): Promise<Buffer> {
  const headers = ['Sud', 'Ish raqami', "Daʼvogar", 'Javobgar', 'Sana', 'Natija', 'Holat', 'Sud turi']
  const colWidths = [40, 22, 35, 35, 12, 25, 10, 12]
  const rows = cases.map((c) => ({
    Sud: c.court,
    'Ish raqami': c.caseNumber,
    "Daʼvogar": c.role === 'plaintiff' ? companyName : c.counterparty,
    Javobgar: c.role === 'defendant' ? companyName : c.counterparty,
    Sana: c.regDate,
    Natija: c.result,
    Holat:
      c.classification === 'win'
        ? 'Yutdi'
        : c.classification === 'lose'
          ? 'Yutqazdi'
          : c.classification === 'neutral'
            ? 'Neitral'
            : 'Kutilmoqda',
    'Sud turi':
      c.courtType === 'economic'
        ? 'Iqtisodiy'
        : c.courtType === 'civil'
          ? 'Fuqarolik'
          : "Maʼmuriy",
  }))

  return buildXlsx('Statistika', headers, rows, colWidths)
}

/** Build the standard NextResponse that triggers a browser download. */
function excelResponse(buf: Buffer, tin: string): NextResponse {
  const filename = `statistika-${tin}-${new Date().toISOString().slice(0, 10)}.xlsx`
  return xlsxResponse(buf, filename)
}

/** Shape of the POST body sent by the client (matches StatsCase on the client). */
interface ExportPostBody {
  tin: string
  courtTypes?: string[] // e.g. ['economic', 'civil']
  cases: CaseWithClassification[] // already-classified cases
  companyName?: string
}

/**
 * POST /api/stats/export
 * Body: { tin, courtTypes, cases, companyName }
 *
 * Generates the .xlsx from the case data the client already has on screen —
 * no re-fetch needed. This is the preferred path: instant export.
 */
async function POST_impl(req: NextRequest) {
  let body: ExportPostBody
  try {
    body = (await req.json()) as ExportPostBody
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Noto\'g\'ri JSON body' },
      { status: 400 },
    )
  }

  const tin = (body.tin || '').trim()
  if (!tin || !/^\d{9}$/.test(tin)) {
    return NextResponse.json(
      { ok: false, error: "STIR aynan 9 ta raqamdan iborat boʻlishi kerak" },
      { status: 400 },
    )
  }

  if (!Array.isArray(body.cases) || body.cases.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Tanlangan sud turlarida ishlar yo\'q' },
      { status: 404 },
    )
  }

  // Filter cases by the requested court types (if provided)
  const selectedTypes = (body.courtTypes || ['economic', 'civil', 'administrative']) as StatsCourtType[]
  const cases = body.cases.filter((c) => selectedTypes.includes(c.courtType))
  if (cases.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Tanlangan sud turlarida ishlar yo\'q' },
      { status: 404 },
    )
  }

  const companyName = body.companyName || tin
  const buf = await buildExcelBuffer(cases, companyName)
  return excelResponse(buf, tin)
}

/**
 * GET /api/stats/export?tin=302678824&courtTypes=economic,civil
 *
 * Backward-compat fallback: re-fetches stats via getCompanyStats(tin) and
 * builds the .xlsx from the result. Prefer POST when the client already
 * has the data — POST skips the 4-8s re-fetch.
 */
async function GET_impl(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tin = (searchParams.get('tin') || '').trim()
  const courtTypesParam = searchParams.get('courtTypes') || 'economic,civil,administrative'
  const selectedTypes = courtTypesParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as StatsCourtType[]

  // Validate TIN
  if (!tin || !/^\d{9}$/.test(tin)) {
    return NextResponse.json(
      { ok: false, error: "STIR aynan 9 ta raqamdan iborat boʻlishi kerak" },
      { status: 400 },
    )
  }

  // Fetch stats
  const timeout = new Promise<{ ok: false; error: string }>((resolve) => {
    setTimeout(
      () => resolve({ ok: false, error: "Soʻrov vaqti tugadi (30s). Qayta urinib koʻring." }),
      30000,
    )
  })

  let result
  try {
    result = await Promise.race([getCompanyStats(tin), timeout])
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Statistikani olib bo\'lmadi' },
      { status: 502 },
    )
  }

  if ('ok' in result && result.ok === false) {
    return NextResponse.json(result, { status: 504 })
  }

  // Filter cases by selected court types
  const cases = result.cases.filter((c) => selectedTypes.includes(c.courtType))

  if (cases.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Tanlangan sud turlarida ishlar yo\'q' },
      { status: 404 },
    )
  }

  const companyName = result.company?.name || tin
  const buf = await buildExcelBuffer(cases, companyName)
  return excelResponse(buf, tin)
}

export const POST = guard(POST_impl)
export const GET = guard(GET_impl)
