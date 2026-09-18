/**
 * v204 (P-C): shared hand-rolled .xlsx builder — extracted from the identical
 * JSZip XML blocks duplicated in api/bills/export and api/stats/export.
 *
 * An .xlsx file is just a ZIP of XML parts (Office Open XML); building it
 * manually avoids the heavy Excel libraries that kept tripping Turbopack.
 * All string cells share one sharedStrings table; style 1 is the bold
 * white-on-black header row.
 */

import JSZip from 'jszip'
import { NextResponse } from 'next/server'

/** XML-escape a cell value. */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Column index (0-based) → Excel letter (A, B, …, Z, AA, AB, …). */
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
 * Build a single-sheet .xlsx workbook.
 *
 * @param sheetName  Excel sheet tab name (≤31 chars, no []:*?/\\)
 * @param headers    Column header labels
 * @param rows       Data rows, already ordered, one string[] per row
 * @param colWidths  Per-column widths (same length as headers ideally)
 */
export async function buildXlsx(
  sheetName: string,
  headers: string[],
  rows: string[][],
  colWidths: number[],
): Promise<Buffer> {
  // ---- Shared strings table ----
  const strings: string[] = []
  const strIdx = new Map<string, number>()
  const s = (v: string): number => {
    if (strIdx.has(v)) return strIdx.get(v)!
    const i = strings.length
    strings.push(v)
    strIdx.set(v, i)
    return i
  }

  const safeName = (sheetName || 'Sheet1').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet1'
  const headerIdx = headers.map((h) => s(h))
  const rowData = rows.map((r) => r.map((cell) => s(String(cell ?? ''))))

  // ---- XML parts ----
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
<sheets><sheet name="${esc(safeName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`

  const sharedStrings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
${strings.map((str) => `<si><t xml:space="preserve">${esc(str)}</t></si>`).join('')}
</sst>`

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0A0A0A"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

  const colsXml = colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')
  const headerRow = `<row r="1">${headerIdx.map((idx, i) => `<c r="${colLetter(i)}1" t="s" s="1"><v>${idx}</v></c>`).join('')}</row>`
  const dataRows = rowData
    .map((rv, ri) => `<row r="${ri + 2}">${rv.map((idx, ci) => `<c r="${colLetter(ci)}${ri + 2}" t="s"><v>${idx}</v></c>`).join('')}</row>`)
    .join('')
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${colsXml}</cols><sheetData>${headerRow}${dataRows}</sheetData></worksheet>`

  // ---- ZIP ----
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

/** Standard download response for a built workbook (matches the old headers). */
export function xlsxResponse(buf: Buffer, filename: string) {
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
