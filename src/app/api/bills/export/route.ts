import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { guard } from '@/server/middleware'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST /api/bills/export
 * Body: { bills: [...] }
 *
 * Generates an .xlsx file from the provided bill data (client-side POST).
 * Columns: Kvitansiya | Kompaniya | Summa | Toʻlangan | Toʻlanmagan |
 *          Holat | Sud | Berilgan sana | Amal qilish | Ish raqami | Turi
 */
async function POST_impl(req: NextRequest) {
  try {
    const body = await req.json()
    const bills = body.bills as any[]

    if (!bills || !Array.isArray(bills) || bills.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Eksport uchun to\'lovlar yo\'q' },
        { status: 400 },
      )
    }

    const rows = bills.map((b: any) => {
      const d = b.detail || {}
      const status = d.invoiceStatus || b.invoiceStatus || '-'
      const amount = d.amount || '-'
      const paid = d.paidAmount || (status === 'PAID' ? amount : '0')
      const unpaid = d.balance || (status === 'PAID' ? '0' : amount)
      const court = d.courtName || '-'
      const issued = b.issued || '-'
      const expiry = d.expiry || '-'
      const caseNum = d.claimCaseNumber || '-'
      const category = d.payCategory || d.description || '-'

      return {
        'Kvitansiya': b.number || '-',
        'Kompaniya': b.companyName || '-',
        'Summa': String(amount),
        "Toʻlangan": String(paid),
        "Toʻlanmagan": String(unpaid),
        'Holati': status === 'PAID' ? "Toʻlangan" : status === 'PARTIAL' ? "Qisman" : status === 'UNPAID' ? "Toʻlanmagan" : status,
        'Sud': court,
        'Berilgan sana': issued,
        'Amal qilish': expiry,
        'Ish raqami': caseNum,
        'Turi': category,
      }
    })

    // Build .xlsx manually using jszip (same pattern as stats export)
    function esc(s: string): string {
      return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    }
    function colLetter(idx: number): string {
      let s = '', n = idx
      while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1 }
      return s
    }

    const headers = ['Kvitansiya', 'Kompaniya', 'Summa', "Toʻlangan", "Toʻlanmagan", 'Holati', 'Sud', 'Berilgan sana', 'Amal qilish', 'Ish raqami', 'Turi']
    const colWidths = [22, 35, 15, 15, 15, 12, 40, 14, 14, 22, 18]

    const strings: string[] = []
    const strIdx = new Map<string, number>()
    function s(v: string): number {
      if (strIdx.has(v)) return strIdx.get(v)!
      const i = strings.length; strings.push(v); strIdx.set(v, i); return i
    }
    const headerIdx = headers.map(h => s(h))
    const rowData = rows.map(r => headers.map(h => s(String(r[h as keyof typeof r] ?? ''))))

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Toʻlovlar" sheetId="1" r:id="rId1"/></sheets>
</workbook>`
    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
${strings.map(str => `<si><t xml:space="preserve">${esc(str)}</t></si>`).join('')}
</sst>`
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF000000"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
    const colsXml = colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
    const headerRow = `<row r="1">${headerIdx.map((idx, i) => `<c r="${colLetter(i)}1" t="s" s="1"><v>${idx}</v></c>`).join('')}</row>`
    const dataRows = rowData.map((rv, ri) => `<row r="${ri + 2}">${rv.map((idx, ci) => `<c r="${colLetter(ci)}${ri + 2}" t="s"><v>${idx}</v></c>`).join('')}</row>`).join('')
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${colsXml}</cols><sheetData>${headerRow}${dataRows}</sheetData></worksheet>`

    const zip = new JSZip()
    zip.file('[Content_Types].xml', contentTypes)
    zip.folder('_rels')!.file('.rels', rootRels)
    const xl = zip.folder('xl')!
    xl.file('workbook.xml', workbook)
    xl.folder('_rels')!.file('workbook.xml.rels', workbookRels)
    xl.file('sharedStrings.xml', sharedStrings)
    xl.file('styles.xml', styles)
    xl.folder('worksheets')!.file('sheet1.xml', sheet)

    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } })
    const filename = `tolovlar-${new Date().toISOString().slice(0, 10)}.xlsx`
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buf.byteLength),
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Export failed' },
      { status: 500 },
    )
  }
}

export const POST = guard(POST_impl)
