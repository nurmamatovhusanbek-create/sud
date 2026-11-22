/**
 * A company's court bills, all of them, on disk: `~/.sud-tizimi/cases/bills/<STIR>/` (`CASE_STORE_DIR`).
 *
 * A big company has hundreds of thousands of bills (a bank: 241 541 = 25 pages of 10 000), so they are kept as COMPACT rows (`core/bill-rows`),
 * one gzip file per billing page (`g<pass>-p<page>.json.gz`) plus a small `meta.json`. A page is written the moment it arrives, so the
 * Toʻlovlar tab can read the first pages while the later ones are still loading, and a load that stops resumes from `pagesDone`. The whole
 * set is held in memory (parsed once, at most TWO companies at a time) and the tab asks it questions (`queryBills`): filters, sort, paging,
 * the summary, and the bill ↔ case cross-reference (`billsOfCase`, `casesOfBills`).
 *
 * billing's paging is NOT stable (measured Nov 2026: the same page asked twice returns different bills, and a long load repeats some and
 * skips others, so one pass over the pages does not see every bill). A load is therefore a series of PASSES (`lib/bill-cases`), each with
 * its own page size so the page boundaries move, and every pass is a generation of files; the rows of ALL generations are one set, a bill
 * is stored once (by its number, the later generation wins). A bill never leaves billing, so nothing is ever dropped.
 *
 * Nothing here expires and the app never deletes it. The STIR is the directory name, so it must be exactly 9 digits. Server-only: imports `fs`.
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { caseStoreDir } from './case-store'
import { casesOfBills, compareBills, matchesBill, summarizeBills, type BillQuery, type BillRow, type BillSort, type BillsSummary, type CaseBills } from '@/core/bill-rows'

const TIN_RE = /^\d{9}$/

export interface BillsMeta {
  v: 1
  tin: string
  totalElements: number
  totalPages: number
  pageSize: number
  /** the pass in progress or the last one (0-based) and its generation of files */
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

interface Held {
  version: number
  byNumber: Map<string, BillRow>
  rows: BillRow[]
  summary: BillsSummary | null
  sorted: Map<BillSort, BillRow[]>
  cases: Map<string, CaseBills> | null
  byCase: Map<string, BillRow[]> | null
}

const g = globalThis as unknown as { __sudBills?: { dir: string; held: Map<string, Held>; version: number } }
function mem(): { dir: string; held: Map<string, Held>; version: number } {
  const dir = caseStoreDir()
  if (!g.__sudBills || g.__sudBills.dir !== dir) g.__sudBills = { dir, held: new Map(), version: 0 }
  return g.__sudBills
}

/** forget what is held in memory (tests; the disk is untouched) */
export function forgetBillsMemory(): void {
  g.__sudBills = undefined
}

const dirOf = (tin: string): string => path.join(caseStoreDir(), 'bills', tin)
const pageName = (pass: number, page: number): string => `g${String(pass).padStart(3, '0')}-p${String(page).padStart(4, '0')}.json.gz`
const PAGE_RE = /^g(\d{3})-p(\d{4})\.json\.gz$/
const pageFile = (tin: string, pass: number, page: number): string => path.join(dirOf(tin), pageName(pass, page))
const metaFile = (tin: string): string => path.join(dirOf(tin), 'meta.json')

function writeAtomic(target: string, data: string | Buffer): boolean {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
    const tmp = `${target}.${process.pid}.tmp`
    fs.writeFileSync(tmp, data, { mode: 0o600 })
    fs.renameSync(tmp, target)
    return true
  } catch (e) {
    console.warn(`[bills-store] could not save ${target}: ${e instanceof Error ? e.message : e}`)
    return false
  }
}

export function readBillsMeta(tin: string): BillsMeta | null {
  if (!TIN_RE.test(tin)) return null
  try {
    const m = JSON.parse(fs.readFileSync(metaFile(tin), 'utf8')) as Partial<BillsMeta>
    if (!m || m.v !== 1 || m.tin !== tin) return null
    return {
      v: 1, tin,
      totalElements: Number(m.totalElements) || 0,
      totalPages: Number(m.totalPages) || 0,
      pageSize: Number(m.pageSize) || 0,
      pass: Number(m.pass) || 0,
      pagesDone: Number(m.pagesDone) || 0,
      complete: m.complete === true,
      stable: m.stable === true,
      loadedAt: Number(m.loadedAt) || 0,
    }
  } catch {
    return null
  }
}

export interface PageTotals {
  totalElements: number
  totalPages: number
  pageSize: number
}

/**
 * Store one billing page (0-based) of a pass and the totals it came with. The memory copy is dropped so the next read sees it. `complete` /
 * `stable` are the job's verdict (`done`), never guessed from the page counts: a load is finished when its passes agree, not when the last
 * page arrives.
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
  if (!writeAtomic(pageFile(tin, pass, page), zlib.gzipSync(JSON.stringify(rows)))) return false
  const meta: BillsMeta = { v: 1, tin, totalElements: t.totalElements, totalPages: t.totalPages, pageSize: t.pageSize, pass, pagesDone: page + 1, complete: done.done, stable: done.stable, loadedAt: now }
  // the set held in memory takes the new page in (re-reading every stored page after each of 25 pages would cost more than the load itself)
  const h = mem().held.get(tin)
  if (h) {
    for (const r of rows) h.byNumber.set(r.number, r)
    h.rows = [...h.byNumber.values()]
    h.summary = null
    h.sorted = new Map()
    h.cases = null
    h.byCase = null
    h.version = ++mem().version
  }
  return writeAtomic(metaFile(tin), JSON.stringify(meta))
}

function readPage(tin: string, pass: number, page: number): BillRow[] {
  try {
    const rows = JSON.parse(zlib.gunzipSync(fs.readFileSync(pageFile(tin, pass, page))).toString('utf8'))
    return Array.isArray(rows) ? (rows as BillRow[]) : []
  } catch {
    return [] // missing or damaged: that page reads as empty and the next load replaces it
  }
}

function held(tin: string): Held | null {
  if (!TIN_RE.test(tin)) return null
  const m = mem()
  const hit = m.held.get(tin)
  if (hit) return hit
  const meta = readBillsMeta(tin)
  if (!meta) return null
  // every page of every pass that is on disk: they are one set, a bill once (by its number), the later pass wins
  let names: string[] = []
  try { names = fs.readdirSync(dirOf(tin)).filter((n) => PAGE_RE.test(n)).sort() } catch { return null }
  const byNumber = new Map<string, BillRow>()
  for (const n of names) {
    const m = PAGE_RE.exec(n)!
    for (const r of readPage(tin, Number(m[1]), Number(m[2]))) byNumber.set(r.number, r)
  }
  const h: Held = { version: ++m.version, byNumber, rows: [...byNumber.values()], summary: null, sorted: new Map(), cases: null, byCase: null }
  m.held.set(tin, h)
  while (m.held.size > 2) m.held.delete(m.held.keys().next().value as string)
  return h
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
  const h = held(tin)
  if (!h) return null
  const sort: BillSort = f.sort ?? 'new'
  let ordered = h.sorted.get(sort)
  if (!ordered) h.sorted.set(sort, (ordered = [...h.rows].sort(compareBills(sort))))
  const noFilter = !f.q?.trim() && (!f.seg || f.seg === 'all') && !f.court && !f.kind && !f.caseNumber
  const matched = noFilter ? ordered : ordered.filter((r) => matchesBill(r, f))
  const size = Math.max(1, Math.min(500, Math.trunc(f.size ?? 20)))
  const pages = Math.max(1, Math.ceil(matched.length / size))
  const page = Math.max(1, Math.min(pages, Math.trunc(f.page ?? 1)))
  return { total: h.rows.length, matched: matched.length, rows: matched.slice((page - 1) * size, page * size), summary: (h.summary ??= summarizeBills(h.rows)) }
}

/** The bills that match (newest first by default), up to `limit`: what an export writes. Null when nothing is stored. */
export function listBills(tin: string, f: BillQuery, limit: number): BillRow[] | null {
  const h = held(tin)
  if (!h) return null
  const sort: BillSort = f.sort ?? 'new'
  let ordered = h.sorted.get(sort)
  if (!ordered) h.sorted.set(sort, (ordered = [...h.rows].sort(compareBills(sort))))
  const out: BillRow[] = []
  for (const r of ordered) {
    if (matchesBill(r, f)) {
      out.push(r)
      if (out.length >= limit) break
    }
  }
  return out
}

/** All the bills of one case (usually two: state duty and postal costs). */
export function billsOfCase(tin: string, caseNumber: string): BillRow[] {
  const h = held(tin)
  if (!h) return []
  if (!h.byCase) {
    h.byCase = new Map()
    for (const r of h.rows) if (r.caseNumber) (h.byCase.get(r.caseNumber) ?? h.byCase.set(r.caseNumber, []).get(r.caseNumber)!).push(r)
  }
  return h.byCase.get(caseNumber) ?? []
}

/** The cases the stored bills name, with their bills. */
export function storedBillCases(tin: string): Map<string, CaseBills> {
  const h = held(tin)
  if (!h) return new Map()
  return (h.cases ??= casesOfBills(h.rows))
}

/** the bill numbers of the pages already stored for ONE pass (a resumed pass continues counting its overlaps) */
export function passNumbers(tin: string, pass: number): Set<string> {
  const out = new Set<string>()
  if (!TIN_RE.test(tin)) return out
  try {
    for (const n of fs.readdirSync(dirOf(tin)).sort()) {
      const m = PAGE_RE.exec(n)
      if (m && Number(m[1]) === pass) for (const r of readPage(tin, pass, Number(m[2]))) out.add(r.number)
    }
  } catch { /* no directory */ }
  return out
}

/** every bill number stored (a load checks a new page against it: pages that overlap the earlier ones mean billing's paging is not stable) */
export function storedNumbers(tin: string): Set<string> {
  const h = held(tin)
  return h ? new Set(h.rows.map((r) => r.number)) : new Set()
}

/** the newest bills (the Overview's «Soʻnggi toʻlovlar» strip) */
export function recentBills(tin: string, n: number): BillRow[] {
  return queryBills(tin, { sort: 'new', page: 1, size: n })?.rows ?? []
}
