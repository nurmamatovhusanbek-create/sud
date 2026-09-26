/**
 * Parse an «Акт сверки» (reconciliation) .xlsx into the debtor contracts it
 * contains — 1, several, or none. Runs in the browser (JSZip), so the uploaded
 * financial statement never leaves the operator's machine.
 *
 * We only need what the demand letter is computed from: per contract the
 * number, date, main debt (Сальдо конечное, debit side) and the total credited
 * against it (opening advance + payments). Everything else in the letter
 * (parties, addresses, court, rate) comes from the editable constants, not the
 * spreadsheet.
 *
 * Layout (verified against real HET/Artikul exports): a header row carries
 * «Дата | Документ | Дебет | Кредит» for the first (our) party; below it each
 * contract is a block that starts with «№<no> от dd.mm.yyyy» and ends at
 * «Сальдо конечное». The right-party mirror columns are ignored. A contract is
 * a claimable debtor iff its closing balance sits on the DEBIT side.
 */

import JSZip from 'jszip'
import { toTiyin } from '@/core/pretenzia'

export interface DebtorContract {
  /** Contract number without the «№», e.g. «K1125545». */
  no: string
  /** Contract date. */
  date: Date
  /** Main debt = closing debit balance, in tiyin. */
  mainDebtTiyin: number
  /** Opening advance + payments credited against it, in tiyin (0 if none). */
  paymentTiyin: number
}

export interface SverkaParseResult {
  contracts: DebtorContract[]
  /** Reconciliation period end («на dd.mm.yyyy»), when found — a sensible
   *  default for the claim date. */
  periodEnd?: Date
  creditorName?: string
  debtorName?: string
  /** Every contract block seen (incl. fully-paid ones) — for a "N of M" hint. */
  totalBlocks: number
}

// ---- minimal .xlsx cell reader ---------------------------------------------

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

function parseSharedStrings(xml: string): string[] {
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

type Grid = Map<number, Map<number, string | number>>

function parseSheet(xml: string, shared: string[]): Grid {
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

// ---- sverka semantics ------------------------------------------------------

const HEADER_RE = /^№\s*(.+?)\s+от\s+(\d{2})\.(\d{2})\.(\d{4})/
const PERIOD_END_RE = /на\s+(\d{2})\.(\d{2})\.(\d{4})\s+задолженность/
const MIN_DEBT_TIYIN = 100 // ignore 0.01/0.33-sum residue rows

function toDate(dd: string, mm: string, yyyy: string): Date {
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd))
}

export async function parseSverka(data: ArrayBuffer | Uint8Array): Promise<SverkaParseResult> {
  const zip = await JSZip.loadAsync(data)

  const ssFile = zip.file('xl/sharedStrings.xml')
  const shared = ssFile ? parseSharedStrings(await ssFile.async('string')) : []

  // First worksheet (workbook order); fall back to sheet1.xml.
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
  const grid = parseSheet(await sheetFile.async('string'), shared)

  // Locate the «Дебет | Кредит» header row → the first-party column indices.
  let debitCol = 5
  let creditCol = 7
  let labelCol = 2
  const sortedRows = [...grid.keys()].sort((a, b) => a - b)
  for (const row of sortedRows) {
    const cells = grid.get(row)!
    const cols = [...cells.entries()]
    const debit = cols.find(([, v]) => str(v).trim() === 'Дебет')
    const credit = cols.find(([, v]) => str(v).trim() === 'Кредит')
    const date = cols.find(([, v]) => str(v).trim() === 'Дата')
    if (debit && credit) {
      debitCol = debit[0]
      creditCol = credit[0]
      if (date) labelCol = date[0]
      break
    }
  }

  // Extract party names + period end from the free-text rows.
  let creditorName: string | undefined
  let debtorName: string | undefined
  let periodEnd: Date | undefined
  for (const row of sortedRows) {
    for (const v of grid.get(row)!.values()) {
      const t = str(v)
      if (!periodEnd) {
        const pm = PERIOD_END_RE.exec(t)
        if (pm) periodEnd = toDate(pm[1], pm[2], pm[3])
      }
      if (!creditorName) {
        const cm = /между\s+"+([^"]+?)"+\s+Mas'uliyati/i.exec(t)
        if (cm) creditorName = cm[1].trim()
      }
      if (!debtorName) {
        const dm = /и\s+"+([^"]+?)"+\s+Aksiyadorlik/i.exec(t)
        if (dm) debtorName = dm[1].trim()
      }
    }
  }

  // Walk contract blocks.
  const contracts: DebtorContract[] = []
  let totalBlocks = 0
  let cur: { no: string; date: Date; closingDebit?: number; credit: number } | null = null

  const flush = () => {
    if (!cur) return
    totalBlocks++
    const debtTiyin = cur.closingDebit != null ? toTiyin(cur.closingDebit) : 0
    if (debtTiyin >= MIN_DEBT_TIYIN) {
      contracts.push({
        no: cur.no,
        date: cur.date,
        mainDebtTiyin: debtTiyin,
        paymentTiyin: toTiyin(cur.credit),
      })
    }
    cur = null
  }

  for (const row of sortedRows) {
    const cells = grid.get(row)!
    const label = str(cells.get(labelCol)).trim()
    const doc = str([...cells.values()].find((v) => /Обороты по договору|Оплата|Счет|Сальдо/.test(str(v))) ?? '')

    // Grand-total footer → stop.
    if (/^Обороты за период/.test(label)) break

    const hm = HEADER_RE.exec(label)
    if (hm) {
      flush()
      cur = { no: hm[1].trim(), date: toDate(hm[2], hm[3], hm[4]), credit: 0 }
      continue
    }
    if (!cur) continue

    if (label === 'Сальдо начальное') {
      // opening advance sits on the credit side → counts as payment
      cur.credit += num(cells.get(creditCol)) ?? 0
    } else if (label === 'Сальдо конечное') {
      cur.closingDebit = num(cells.get(debitCol)) ?? 0
    } else if (/Обороты по договору/.test(doc)) {
      // period credit turnover = sum of all Оплата lines
      cur.credit += num(cells.get(creditCol)) ?? 0
    }
  }
  flush()

  return { contracts, periodEnd, creditorName, debtorName, totalBlocks }
}
