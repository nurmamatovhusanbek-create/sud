import { NextRequest, NextResponse } from 'next/server'
import { getCompanyStats, type CaseWithClassification, type StatsCourtType } from '@/lib/stats'
import JSZip from 'jszip'
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
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Convert column index (0-based) to Excel letter (A, B, ..., Z, AA, AB, ...)
function colLetter(idx: number): string {
  let s = ''
  let n = idx
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

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

  // ---- Build shared strings table ----
  // All string cells reference this table by index. Numbers are written inline.
  const strings: string[] = []
  const strIdx = new Map<string, number>()
  function s(v: string): number {
    if (strIdx.has(v)) return strIdx.get(v)!
    const i = strings.length
    strings.push(v)
    strIdx.set(v, i)
    return i
  }

  // Add header strings
  const headerIdx = headers.map((h) => s(h))

  // Add row string values
  const rowData = rows.map((r) =>
    headers.map((h) => s(String(r[h as keyof typeof r] ?? ''))),
  )

  // ---- Build XML parts ----

  // [Content_Types].xml
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`

  // _rels/.rels
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  // xl/workbook.xml
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Statistika" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

  // xl/_rels/workbook.xml.rels
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  // xl/sharedStrings.xml
  const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
${strings.map((str) => `<si><t xml:space="preserve">${esc(str)}</t></si>`).join('')}
</sst>`

  // xl/styles.xml — style 0 = default, style 1 = header (bold white on black)
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0A0A0A"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

  // xl/worksheets/sheet1.xml
  const colsXml = colWidths
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')

  const headerRow =
    `<row r="1">` +
    headerIdx
      .map((idx, i) => `<c r="${colLetter(i)}1" t="s" s="1"><v>${idx}</v></c>`)
      .join('') +
    `</row>`

  const dataRows = rowData
    .map(
      (rowVals, ri) =>
        `<row r="${ri + 2}">` +
        rowVals
          .map((idx, ci) => `<c r="${colLetter(ci)}${ri + 2}" t="s"><v>${idx}</v></c>`)
          .join('') +
        `</row>`,
    )
    .join('')

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<cols>${colsXml}</cols>
<sheetData>${headerRow}${dataRows}</sheetData>
</worksheet>`

  // ---- Assemble the ZIP ----
  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypes)
  zip.folder('_rels')!.file('.rels', rootRels)
  const xl = zip.folder('xl')!
  xl.file('workbook.xml', workbook)
  xl.folder('_rels')!.file('workbook.xml.rels', workbookRels)
  xl.file('sharedStrings.xml', sharedStrings)
  xl.file('styles.xml', styles)
  xl.folder('worksheets')!.file('sheet1.xml', sheet)

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}

/** Build the standard NextResponse that triggers a browser download. */
function excelResponse(buf: Buffer, tin: string): NextResponse {
  const filename = `statistika-${tin}-${new Date().toISOString().slice(0, 10)}.xlsx`
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buf.byteLength),
      'Access-Control-Allow-Origin': '*',
    },
  })
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
