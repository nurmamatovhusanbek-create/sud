/**
 * A company's court bills, all of them, in `sud.db` (`lib/db`, table `bills`).
 *
 * A big company has hundreds of thousands of bills (a bank: 241 541 = 25 pages of 10 000). A row is the compact `BillRow` (`core/bill-rows`)
 * plus columns derived at insert (`ctype` the case API's court type, `kind` davlat boji / pochta / other, `yymm` the case's registration
 * month, `hay` the lower-cased court and description for search) so the Toʻlovlar tab's filters, sort and paging, the summary, the
 * bill ↔ case cross-reference and the by-number job's queue are plain indexed queries: the server never holds a company's set in memory.
 *
 * A page is written the moment it arrives (one transaction), so the tab can read the first pages while the later ones load, and a load that
 * stops resumes from `pagesDone`. billing's paging is NOT stable (core/bill-passes), so a load is a series of PASSES: every pass writes
 * into the same table by (tin, number), a bill is stored once and carries the last pass that returned it; nothing is ever dropped (a bill
 * never leaves billing). Nothing here expires and the app never deletes it. Server-only.
 */

import type { ApiCourtType } from '@/core/billing-format'
import { billCourtType, categoryKind, type BillQuery, type BillRow, type BillSort, type BillsSummary, type CategoryKind } from '@/core/bill-rows'
import { registeredKey } from '@/core/bill-cases'
import { getDb, type Db } from './db'

const TIN_RE = /^\d{9}$/

export interface BillsMeta {
  v: 1
  tin: string
  totalElements: number
  totalPages: number
  pageSize: number
  /** the pass in progress or the last one (0-based) */
  pass: number
  /** pages of THAT pass stored so far (0 … pagesDone-1) */
  pagesDone: number
  /** the load is finished: its last pass added (almost) nothing new, or its pages did not overlap */
  complete: boolean
  /** the last pass saw no bill twice across its pages: billing's order held for the whole pass, so it covered every row once */
  stable: boolean
  /** when the last page was stored (ms) */
  loadedAt: number
}

export interface PageTotals {
  totalElements: number
  totalPages: number
  pageSize: number
}

/** how many distinct bills of the company are stored */
export function billCountOf(tin: string): number {
  return Number(getDb().prepare('SELECT COUNT(*) n FROM bills WHERE tin = ?').get(tin)?.n ?? 0)
}

export function readBillsMeta(tin: string): BillsMeta | null {
  if (!TIN_RE.test(tin)) return null
  const r = getDb().prepare('SELECT * FROM bill_loads WHERE tin = ?').get(tin)
  if (!r) return null
  return {
    v: 1, tin,
    totalElements: Number(r.total_elements), totalPages: Number(r.total_pages), pageSize: Number(r.page_size),
    pass: Number(r.pass), pagesDone: Number(r.pages_done), complete: Number(r.complete) === 1, stable: Number(r.stable) === 1, loadedAt: Number(r.loaded_at),
  }
}

// ---------------- write ----------------

const COLS = 'tin, number, pass, status, issued, amount, paid, must_pay, balance, overdue, cat, cat_id, court, court_id, court_type, case_number, decision, descr, payer, payer_tin, in_favor, account, ctype, kind, yymm, hay'
const INSERT = `INSERT OR REPLACE INTO bills (${COLS}) VALUES (${COLS.split(',').map(() => '?').join(', ')})`

/**
 * Store one billing page (0-based) of a pass and the totals it came with. `complete` / `stable` are the job's verdict (`done`), never
 * guessed from the page counts: a load is finished when its passes agree, not when the last page arrives.
 */
export function writeBillsPage(
  tin: string,
  pass: number,
  page: number,
  rows: readonly BillRow[],
  t: PageTotals,
  done: { done: boolean; stable: boolean },
  now: number = Date.now(),
): boolean {
  if (!TIN_RE.test(tin) || !Number.isInteger(pass) || pass < 0 || pass > 999 || !Number.isInteger(page) || page < 0 || page > 9999) return false
  const db = getDb()
  const ins = db.prepare(INSERT)
  db.transaction(() => {
    for (const r of rows) {
      ins.run(
        tin, r.number, pass, r.status, r.issued, r.amount, r.paid, r.mustPay, r.balance, r.overdue, r.cat, r.catId, r.court, r.courtId, r.courtType,
        r.caseNumber, r.decision, r.desc, r.payer, r.payerTin, r.inFavor === null ? null : r.inFavor ? 1 : 0, r.account,
        billCourtType(r), categoryKind(r), r.caseNumber ? registeredKey(r.caseNumber) : -1, `${r.court} ${r.desc}`.toLowerCase(),
      )
    }
    db.prepare(
      `INSERT INTO bill_loads (tin, total_elements, total_pages, page_size, pass, pages_done, complete, stable, loaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tin) DO UPDATE SET total_elements = excluded.total_elements, total_pages = excluded.total_pages, page_size = excluded.page_size,
         pass = excluded.pass, pages_done = excluded.pages_done, complete = excluded.complete, stable = excluded.stable, loaded_at = excluded.loaded_at`,
    ).run(tin, t.totalElements, t.totalPages, t.pageSize, pass, page + 1, done.done ? 1 : 0, done.stable ? 1 : 0, now)
  })
  summaries.delete(tin)
  return true
}

/**
 * How a page that has NOT been written yet relates to what is stored: `overlap` = distinct bills already returned by an EARLIER page of THIS
 * pass (billing's order did not hold), `added` = distinct bills no pass has returned before.
 */
export function pageOverlap(tin: string, pass: number, numbers: Iterable<string>): { overlap: number; added: number } {
  const all = [...new Set(numbers)]
  const db = getDb()
  let overlap = 0
  let known = 0
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500)
    const rows = db.prepare(`SELECT pass FROM bills WHERE tin = ? AND number IN (${chunk.map(() => '?').join(',')})`).all(tin, ...chunk)
    known += rows.length
    for (const r of rows) if (Number(r.pass) === pass) overlap++
  }
  return { overlap, added: all.length - known }
}

// ---------------- read ----------------

const fromRow = (r: Record<string, unknown>): BillRow => ({
  number: String(r.number), status: String(r.status), issued: nz(r.issued), amount: nz(r.amount), paid: nz(r.paid), mustPay: nz(r.must_pay),
  balance: nz(r.balance), overdue: nz(r.overdue), cat: String(r.cat), catId: nz(r.cat_id), court: String(r.court), courtId: nz(r.court_id),
  courtType: String(r.court_type), caseNumber: r.case_number === null ? null : String(r.case_number), decision: nz(r.decision), desc: String(r.descr),
  payer: String(r.payer), payerTin: String(r.payer_tin), inFavor: r.in_favor === null ? null : Number(r.in_favor) === 1, account: String(r.account),
})
const nz = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

const ORDER: Record<BillSort, string> = {
  new: 'issued DESC, number ASC',
  old: 'issued ASC, number ASC',
  az: 'number ASC',
  za: 'number DESC',
}

/** the WHERE of a query: every value is a bound parameter */
function where(tin: string, f: BillQuery): { sql: string; params: Array<string | number> } {
  const parts = ['tin = ?']
  const params: Array<string | number> = [tin]
  if (f.seg === 'paid') parts.push("status IN ('PAID', 'USED')")
  else if (f.seg === 'overdue') parts.push("status = 'OVERDUE'")
  if (f.caseNumber) { parts.push('case_number = ?'); params.push(f.caseNumber) }
  if (f.court) { parts.push('ctype = ?'); params.push(f.court) }
  if (f.kind) { parts.push('kind = ?'); params.push(f.kind) }
  const q = f.q?.trim().toLowerCase()
  if (q) {
    parts.push("(instr(number, ?) > 0 OR instr(COALESCE(case_number, ''), ?) > 0 OR instr(hay, ?) > 0)")
    params.push(q, q, q)
  }
  return { sql: parts.join(' AND '), params }
}

/** the summary of a company's bills, per connection (a write drops it); a new connection starts with none */
const summaryCache = new WeakMap<Db, Map<string, BillsSummary>>()
const summaries = {
  get: (tin: string): BillsSummary | undefined => summaryCache.get(getDb())?.get(tin),
  set: (tin: string, v: BillsSummary): void => {
    const db = getDb()
    const m = summaryCache.get(db) ?? new Map<string, BillsSummary>()
    m.set(tin, v)
    summaryCache.set(db, m)
  },
  delete: (tin: string): void => {
    summaryCache.get(getDb())?.delete(tin)
  },
}

function summary(tin: string): BillsSummary {
  const hit = summaries.get(tin)
  if (hit) return hit
  const db = getDb()
  const a = db.prepare(
    `SELECT COUNT(*) AS count,
       SUM(status IN ('PAID', 'USED')) AS paid,
       SUM(status = 'OVERDUE') AS overdue,
       SUM(status = 'PARTIALLY_PAID') AS partial,
       COALESCE(SUM(amount), 0) AS total_amount, COALESCE(SUM(paid), 0) AS total_paid,
       COALESCE(SUM(CASE WHEN status = 'OVERDUE' THEN COALESCE(overdue, balance, 0) ELSE 0 END), 0) AS overdue_sum,
       SUM(case_number IS NOT NULL) AS with_case, COUNT(DISTINCT case_number) AS cases
     FROM bills WHERE tin = ?`,
  ).get(tin) ?? {}
  const byCourt: Record<string, number> = {}
  for (const r of db.prepare('SELECT ctype, COUNT(*) n FROM bills WHERE tin = ? AND ctype IS NOT NULL GROUP BY ctype').all(tin)) byCourt[String(r.ctype)] = Number(r.n)
  const byKind: Record<CategoryKind, number> = { davlat_boji: 0, pochta: 0, other: 0 }
  for (const r of db.prepare('SELECT kind, COUNT(*) n FROM bills WHERE tin = ? GROUP BY kind').all(tin)) byKind[String(r.kind) as CategoryKind] = Number(r.n)
  const s: BillsSummary = {
    count: Number(a.count ?? 0), paid: Number(a.paid ?? 0), overdue: Number(a.overdue ?? 0), partial: Number(a.partial ?? 0),
    totalAmount: Number(a.total_amount ?? 0), totalPaid: Number(a.total_paid ?? 0), overdueSum: Number(a.overdue_sum ?? 0),
    withCase: Number(a.with_case ?? 0), cases: Number(a.cases ?? 0), byCourt, byKind,
  }
  summaries.set(tin, s)
  return s
}

export interface BillsPage {
  /** every bill the company has stored */
  total: number
  /** the bills that match the filters */
  matched: number
  rows: BillRow[]
  /** over ALL stored bills, whatever the filters */
  summary: BillsSummary
}

export function queryBills(tin: string, f: BillQuery & { page?: number; size?: number }): BillsPage | null {
  if (!TIN_RE.test(tin)) return null
  const db = getDb()
  const sum = summary(tin)
  if (sum.count === 0) return null
  const w = where(tin, f)
  const matched = Number(db.prepare(`SELECT COUNT(*) n FROM bills WHERE ${w.sql}`).get(...w.params)?.n ?? 0)
  const size = Math.max(1, Math.min(500, Math.trunc(f.size ?? 20)))
  const pages = Math.max(1, Math.ceil(matched / size))
  const page = Math.max(1, Math.min(pages, Math.trunc(f.page ?? 1)))
  const rows = db.prepare(`SELECT * FROM bills WHERE ${w.sql} ORDER BY ${ORDER[f.sort ?? 'new']} LIMIT ? OFFSET ?`).all(...w.params, size, (page - 1) * size)
  return { total: sum.count, matched, rows: rows.map(fromRow), summary: sum }
}

/** The bills that match (newest first by default), up to `limit`: what an export writes. Null when nothing is stored. */
export function listBills(tin: string, f: BillQuery, limit: number): BillRow[] | null {
  if (!TIN_RE.test(tin) || summary(tin).count === 0) return null
  const w = where(tin, f)
  return getDb().prepare(`SELECT * FROM bills WHERE ${w.sql} ORDER BY ${ORDER[f.sort ?? 'new']} LIMIT ?`).all(...w.params, Math.max(1, limit)).map(fromRow)
}

/** All the bills of one case (usually two: state duty and postal costs). */
export function billsOfCase(tin: string, caseNumber: string): BillRow[] {
  if (!TIN_RE.test(tin)) return []
  return getDb().prepare('SELECT * FROM bills WHERE tin = ? AND case_number = ? ORDER BY issued, number').all(tin, caseNumber).map(fromRow)
}

/** the newest bills (the Overview's «Soʻnggi toʻlovlar» strip) */
export function recentBills(tin: string, n: number): BillRow[] {
  return queryBills(tin, { sort: 'new', page: 1, size: n })?.rows ?? []
}

// ---------------- the cases the bills name ----------------

export interface BillCaseRef {
  caseNumber: string
  courtType: ApiCourtType
  /** the court as the bills name it */
  court: string
  decision: number | null
}

/** distinct cases the stored bills name (a number whose court type cannot be placed is not counted) */
export function billCaseCount(tin: string): number {
  if (!TIN_RE.test(tin)) return 0
  return Number(getDb().prepare('SELECT COUNT(DISTINCT case_number) n FROM bills WHERE tin = ? AND case_number IS NOT NULL AND ctype IS NOT NULL').get(tin)?.n ?? 0)
}

const MISSING_FROM = `FROM bills b
  WHERE b.tin = ? AND b.case_number IS NOT NULL AND b.ctype IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM found_cases f WHERE f.court = b.ctype AND f.tin = b.tin AND f.num = b.case_number)
    AND NOT EXISTS (SELECT 1 FROM tried t WHERE t.tin = b.tin AND t.num = b.case_number AND (t.found = 1 OR t.t > ?))
    AND NOT EXISTS (SELECT 1 FROM known_feed k WHERE k.tin = b.tin AND k.num = b.case_number)`

/** the numbers the company's TIN lists already show (they are not asked for again); call before `nextMissingCases` / `countMissingCases` */
export function setKnownFeed(tin: string, numbers: Iterable<string>): void {
  const db = getDb()
  db.exec('CREATE TEMP TABLE IF NOT EXISTS known_feed (tin TEXT NOT NULL, num TEXT NOT NULL, PRIMARY KEY (tin, num)) WITHOUT ROWID')
  db.transaction(() => {
    db.prepare('DELETE FROM known_feed WHERE tin = ?').run(tin)
    const ins = db.prepare('INSERT OR IGNORE INTO known_feed VALUES (?, ?)')
    for (const n of numbers) ins.run(tin, n)
  })
}

/**
 * The next cases the bills name that no list has and the court was not already asked about (a «not found» is asked again only after
 * `retryBefore`: ms timestamp, rows tried after it are skipped), newest registration first. The job asks for a batch at a time, so it never holds
 * the whole queue.
 */
export function nextMissingCases(tin: string, retryBefore: number, limit: number): BillCaseRef[] {
  if (!TIN_RE.test(tin)) return []
  setKnownFeedIfMissing()
  return getDb()
    .prepare(`SELECT b.case_number AS num, MIN(b.ctype) AS ctype, MAX(b.court) AS court, MAX(b.decision) AS decision, MAX(b.yymm) AS yymm ${MISSING_FROM} GROUP BY b.case_number ORDER BY yymm DESC, num LIMIT ?`)
    .all(tin, retryBefore, limit)
    .map((r) => ({ caseNumber: String(r.num), courtType: String(r.ctype) as ApiCourtType, court: String(r.court), decision: nz(r.decision) }))
}

export function countMissingCases(tin: string, retryBefore: number): number {
  if (!TIN_RE.test(tin)) return 0
  setKnownFeedIfMissing()
  return Number(getDb().prepare(`SELECT COUNT(DISTINCT b.case_number) n ${MISSING_FROM}`).get(tin, retryBefore)?.n ?? 0)
}

/** the temp table must exist even when no list was registered */
function setKnownFeedIfMissing(): void {
  getDb().exec('CREATE TEMP TABLE IF NOT EXISTS known_feed (tin TEXT NOT NULL, num TEXT NOT NULL, PRIMARY KEY (tin, num)) WITHOUT ROWID')
}
