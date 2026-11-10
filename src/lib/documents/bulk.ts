import { cellText, type Grid } from '@/lib/xlsx-grid'
import { FIELDS } from './registry'
import { formatHearingDate } from './from-case'

/**
 * Fill ONE document for MANY rows: a spreadsheet (xlsx or csv) whose columns are form fields and whose rows are the
 * people / contracts / cases; each row becomes one document, laid over the values already typed in the form (so what is
 * the same for everyone, the company, the director, the court, is typed once). Pure and isomorphic: the file is read in
 * the browser, the server only receives the finished rows.
 */

export const MAX_BULK_ROWS = 300

// ---- reading the file --------------------------------------------------------------------------------------------

/** a sheet grid (1-based rows / columns, empty cells absent) → dense rows of text, trailing empty rows and columns dropped */
export function gridToRows(grid: Grid): string[][] {
  const rowNos = [...grid.keys()].sort((a, b) => a - b)
  let width = 0
  for (const r of rowNos) for (const c of grid.get(r)!.keys()) width = Math.max(width, c)
  const rows: string[][] = []
  for (const r of rowNos) {
    const cells = grid.get(r)!
    rows.push(Array.from({ length: width }, (_, i) => cellText(cells.get(i + 1)).trim()))
  }
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop()
  return rows
}

/** csv / tsv text → rows: quoted cells, doubled quotes, a BOM, and the delimiter (`;` `,` or tab) guessed from the header line */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const head = src.split(/\r?\n/, 1)[0] ?? ''
  const count = (ch: string) => head.split(ch).length - 1
  const delim = [';', '\t', ','].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) { row.push(cell.trim()); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell.trim()); cell = ''
      rows.push(row); row = []
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop()
  return rows
}

/** an Excel date serial (days since 1899-12-30) → dd.mm.yyyy; null when it is not plausibly a date */
export function excelDate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null // 1954 … 2119
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`
}

// ---- columns → fields ------------------------------------------------------------------------------------------------

/** a header or label compared loosely: case, apostrophes, punctuation, spaces and «(lotinda)»-style notes ignored */
export const normHeader = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[ʻʼ'’‘`´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')

/** For each column, the field key it holds (matched by key or label), or null. A key is taken by the FIRST column that names it. */
export function matchColumns(headers: string[], keys: string[]): (string | null)[] {
  const byName = new Map<string, string>()
  for (const k of keys) {
    byName.set(normHeader(k), k)
    const label = FIELDS[k]?.label
    if (label) byName.set(normHeader(label), k)
  }
  const used = new Set<string>()
  return headers.map((h) => {
    const k = h.trim() ? byName.get(normHeader(h)) : undefined
    if (!k || used.has(k)) return null
    used.add(k)
    return k
  })
}

// ---- rows → values -------------------------------------------------------------------------------------------------------

const isDateKey = (k: string): boolean => FIELDS[k]?.kind === 'date'

/**
 * One value set per data row: the form's values with the row's mapped cells over them. A cell that is empty leaves the
 * form's value; a date column that arrives as an Excel serial («45201») becomes dd.mm.yyyy (the hearing date becomes «2026-yil 12-oktabr», as the letter reads). Fully empty rows are skipped.
 */
export function rowsToValues(rows: string[][], mapping: (string | null)[], base: Record<string, string>): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const row of rows) {
    if (row.every((c) => !c.trim())) continue
    const v = { ...base }
    mapping.forEach((k, i) => {
      if (!k) return
      let cell = (row[i] ?? '').trim()
      if (!cell) return
      const serial = /^\d{5}(\.\d+)?$/.test(cell) ? excelDate(Number(cell)) : null
      if (k === 'hearing_date') cell = formatHearingDate(serial ?? cell) || cell // this field reads «2026-yil 12-oktabr» in the letter
      else if (isDateKey(k) && serial) cell = serial
      v[k] = cell
    })
    out.push(v)
  }
  return out
}

/** a CSV template for a document: a header row of its field labels (Excel opens it with the BOM), one example line */
export function templateCsv(keys: string[], defaults: Record<string, string>): string {
  const q = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const labels = keys.map((k) => q(FIELDS[k]?.label ?? k))
  return `﻿${labels.join(';')}\r\n${keys.map((k) => q(defaults[k] ?? '')).join(';')}\r\n`
}
