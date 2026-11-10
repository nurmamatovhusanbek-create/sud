/**
 * A minimal .xlsx reader: the first worksheet as a grid of cells. Runs in the browser (JSZip), so an uploaded
 * spreadsheet never leaves the operator's machine. Shared by the reconciliation parser (pretenzia/parse.ts) and the
 * bulk document fill (documents/bulk.ts).
 */

import JSZip from 'jszip'

function textOfTags(xml: string, tag: string): string {
  // concatenate all <t>…</t> inside a fragment (handles rich-text runs)
  let out = ''
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out += m[1]
  return unescapeXml(out)
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_x, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

export function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const re = /<si>([\s\S]*?)<\/si>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out.push(textOfTags(m[1], 't'))
  return out
}

/** Split a cell ref like «AB12» into a 1-based column index and row number. */
function refToColRow(ref: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)
  if (!m) return { col: 0, row: 0 }
  let col = 0
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { col, row: Number(m[2]) }
}

export type Grid = Map<number, Map<number, string | number>>

export function parseSheet(xml: string, shared: string[]): Grid {
  const grid: Grid = new Map()
  // attrs, then EITHER a self-closing "/>" OR ">inner</c>". Splitting these
  // explicitly matters: empty cells serialize as <c r=".." t="e"/> and must not
  // swallow the cells that follow.
  const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const attrs = m[1] ?? ''
    const inner = m[2] ?? ''
    const refM = /\br="([A-Z]+\d+)"/.exec(attrs)
    if (!refM) continue
    const ref = refM[1]
    const { col, row } = refToColRow(ref)
    const typeM = /\bt="([^"]+)"/.exec(attrs)
    const type = typeM ? typeM[1] : 'n'
    let value: string | number | undefined
    if (type === 's') {
      const vM = /<v>([\s\S]*?)<\/v>/.exec(inner)
      if (vM) value = shared[Number(vM[1])] ?? ''
    } else if (type === 'inlineStr') {
      value = textOfTags(inner, 't')
    } else if (type === 'str') {
      const vM = /<v>([\s\S]*?)<\/v>/.exec(inner)
      if (vM) value = unescapeXml(vM[1])
    } else {
      const vM = /<v>([\s\S]*?)<\/v>/.exec(inner)
      if (vM && vM[1] !== '') value = Number(vM[1])
    }
    if (value === undefined || value === '') continue
    let r = grid.get(row)
    if (!r) grid.set(row, (r = new Map()))
    r.set(col, value)
  }
  return grid
}

const str = (v: string | number | undefined): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: string | number | undefined): number | undefined => (typeof v === 'number' ? v : undefined)


export const cellText = (v: string | number | undefined): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** The first worksheet (workbook order, falling back to sheet1.xml) as a grid keyed by 1-based row / column. */
export async function readFirstSheet(data: ArrayBuffer | Uint8Array): Promise<Grid> {
  const zip = await JSZip.loadAsync(data)

  const ssFile = zip.file('xl/sharedStrings.xml')
  const shared = ssFile ? parseSharedStrings(await ssFile.async('string')) : []

  let sheetPath = 'xl/worksheets/sheet1.xml'
  const wb = zip.file('xl/workbook.xml')
  const wbRels = zip.file('xl/_rels/workbook.xml.rels')
  if (wb && wbRels) {
    const wbXml = await wb.async('string')
    const relsXml = await wbRels.async('string')
    const firstSheet = /<sheet[^>]*r:id="([^"]+)"/.exec(wbXml)
    if (firstSheet) {
      const relRe = new RegExp(`Id="${firstSheet[1]}"[^>]*Target="([^"]+)"`)
      const tM = relRe.exec(relsXml)
      if (tM) sheetPath = tM[1].startsWith('/') ? tM[1].slice(1) : `xl/${tM[1].replace(/^\.\//, '')}`
    }
  }
  const sheetFile = zip.file(sheetPath) ?? zip.file('xl/worksheets/sheet1.xml')
  if (!sheetFile) throw new Error('Ish varagʻi topilmadi (xlsx buzilgan)')
  return parseSheet(await sheetFile.async('string'), shared)
}
