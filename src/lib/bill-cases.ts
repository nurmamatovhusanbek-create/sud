/**
 * Cases that a company's TIN lists do not show, found through its court bills (billing.sud.uz) and then asked BY NUMBER.
 *
 * Why: the court's TIN lists stop at a row limit (`lib/court-case` LIST_CAPS), so a big company's older cases are invisible there, while
 * billing's search is paged and every bill that belongs to a case names it (`core/bill-cases`). Two steps, both started by a click and
 * both resumable, because a big company has tens of thousands of bills:
 *
 *   1. SCAN: read the bills page by page (10 000 a page; each page costs one captcha, ~8-12 s), collect the distinct case numbers into
 *      the stored index (`lib/case-store` BillIndex, saved after every page, so a stopped scan is resumed, not repeated);
 *   2. FILL: ask the court for the numbers the stored lists do not have, newest first, `limit` of them per run (~1-2 s each). A case the
 *      court answers is stored as a detail (so its drawer opens from disk and, once old enough, is never asked again) and as a row of the
 *      company's `<court>|bills` list, which `court-case` merges into that court's list; a number the court knows nothing about is
 *      remembered as tried and not asked again for RETRY_MISSING_MS.
 *
 * Only one run per company at a time. Server-only.
 */

import { extractBillCases, missingCases, rowFromDetail, type BillCase } from '@/core/bill-cases'
import { searchBillsByInn } from './billing'
import { clearCourtCaseCache, getCaseBundle } from './court-case'
import type { CourtCase, CourtType } from './court-case-types'
import { addFeedRows, billsFeedKey, knownCaseNumbers, readBillIndex, writeBillIndex, writeDetail, type BillIndex } from './case-store'
import { dropSnapshot } from './snapshot-store'

/** billing accepts at least 10 000 rows a page (measured Nov 2026): the fewest pages, so the fewest captchas */
export const BILL_PAGE_SIZE = 10_000
/** a case the court's APIs did not know is asked again only after this long (the old system's node is flaky: «not found» is not always true) */
export const RETRY_MISSING_MS = 14 * 24 * 60 * 60_000
/** stop a fill after this many failures in a row (the court is down: do not burn through the list) */
const MAX_FAILURES_IN_ROW = 3
const PACE_MS = 250

export type BillCasesEvent =
  | { type: 'phase'; phase: 'scan' | 'fill'; detail: string }
  | { type: 'scan'; page: number; pages: number; bills: number; cases: number }
  | { type: 'case'; index: number; of: number; caseNumber: string; found: boolean }
  | { type: 'done'; status: BillCasesStatus; found: number; tried: number }
  | { type: 'error'; error: string }

export interface BillCasesStatus {
  /** a scan has been made (a partial one counts) */
  scanned: boolean
  scannedAt: number
  totalBills: number
  pagesDone: number
  totalPages: number
  /** every page of the bills was read */
  complete: boolean
  /** distinct case numbers the bills name */
  billCases: number
  /** of those: not in the stored lists and not yet tried (what a fill would ask) */
  missing: number
  /** of those: found by number and stored */
  found: number
  /** of those: asked and unknown to the court's APIs */
  notFound: number
}

const running = new Set<string>()

const skipTried = (idx: BillIndex | null, now: number) => (n: string): boolean => {
  const t = idx?.tried[n]
  return !!t && (t.found || now - t.t < RETRY_MISSING_MS)
}

/** What is known about a company's bill cases, from disk only (no site is asked). */
export function billCasesStatus(tin: string, now: number = Date.now()): BillCasesStatus {
  const idx = readBillIndex(tin)
  if (!idx) return { scanned: false, scannedAt: 0, totalBills: 0, pagesDone: 0, totalPages: 0, complete: false, billCases: 0, missing: 0, found: 0, notFound: 0 }
  const missing = missingCases(Object.values(idx.cases), knownCaseNumbers(tin), { skip: skipTried(idx, now) }).length
  const tried = Object.entries(idx.tried).filter(([n]) => n in idx.cases)
  return {
    scanned: true,
    scannedAt: idx.scannedAt,
    totalBills: idx.totalElements,
    pagesDone: idx.pagesDone,
    totalPages: idx.totalPages,
    complete: idx.complete,
    billCases: Object.keys(idx.cases).length,
    missing,
    found: tried.filter(([, v]) => v.found).length,
    notFound: tried.filter(([, v]) => !v.found && now - v.t < RETRY_MISSING_MS).length,
  }
}

/** the two calls to the sites, injectable so the run can be tested without them */
export interface BillCasesDeps {
  searchBills: typeof searchBillsByInn
  getCase: typeof getCaseBundle
}
const REAL: BillCasesDeps = { searchBills: searchBillsByInn, getCase: getCaseBundle }

interface RunOpts {
  deps?: BillCasesDeps
  /** the pause between two cases asked of the court (tests pass 0) */
  paceMs?: number
  signal?: AbortSignal
  /** the most cases one fill asks the court for */
  limit?: number
  /** `auto`: scan only when there is no scan yet; `force`: read the bills again (from page 0, keeping what was found); `skip`: fill only */
  scan?: 'auto' | 'force' | 'skip'
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const aborted = (s?: AbortSignal): boolean => !!s?.aborted

async function scan(tin: string, emit: (e: BillCasesEvent) => void, opts: RunOpts, force: boolean): Promise<void> {
  const old = readBillIndex(tin)
  const resume = !force && !!old && !old.complete && old.pageSize === BILL_PAGE_SIZE && old.pagesDone > 0
  const idx: BillIndex = {
    v: 1, tin,
    scannedAt: Date.now(),
    totalElements: old?.totalElements ?? 0,
    totalPages: old?.totalPages ?? 0,
    pageSize: BILL_PAGE_SIZE,
    pagesDone: resume ? old!.pagesDone : 0,
    complete: false,
    cases: { ...(old?.cases ?? {}) }, // a case once seen stays, a rescan only adds
    tried: { ...(old?.tried ?? {}) },
  }
  const found = new Map<string, BillCase>(Object.entries(idx.cases))
  let page = idx.pagesDone
  for (;;) {
    if (aborted(opts.signal)) return
    emit({ type: 'phase', phase: 'scan', detail: idx.totalPages ? `Toʻlovlar oʻqilmoqda: ${page + 1}/${idx.totalPages}-sahifa…` : 'Toʻlovlar oʻqilmoqda…' })
    const res = await (opts.deps ?? REAL).searchBills(tin, { page, size: BILL_PAGE_SIZE })
    if (!res.content.length) {
      // an empty page inside the range is billing refusing us, not the end: say so instead of calling the scan complete
      if (page < res.totalPages) throw new Error(`billing.sud.uz ${page + 1}-sahifani boʻsh qaytardi`)
      idx.totalElements = res.totalElements
      idx.totalPages = res.totalPages
      break
    }
    extractBillCases(res.content, found)
    idx.cases = Object.fromEntries(found)
    idx.totalElements = res.totalElements
    idx.totalPages = res.totalPages
    idx.pagesDone = page + 1
    idx.scannedAt = Date.now()
    idx.complete = page + 1 >= res.totalPages
    writeBillIndex(idx) // after EVERY page: a stopped or failed scan is resumed from here
    emit({ type: 'scan', page: page + 1, pages: res.totalPages, bills: res.totalElements, cases: found.size })
    if (idx.complete) return
    page++
  }
  idx.complete = true
  writeBillIndex(idx)
}

async function fill(tin: string, emit: (e: BillCasesEvent) => void, opts: RunOpts): Promise<{ found: number; tried: number }> {
  const idx = readBillIndex(tin)
  if (!idx) throw new Error('Toʻlovlar hali oʻqilmagan')
  const now = Date.now()
  const todo = missingCases(Object.values(idx.cases), knownCaseNumbers(tin), { skip: skipTried(idx, now) }).slice(0, opts.limit ?? 60)
  const rows = new Map<CourtType, CourtCase[]>()
  const flush = () => {
    for (const [ct, list] of rows) addFeedRows(tin, billsFeedKey(ct), list)
    rows.clear()
    writeBillIndex(idx)
  }
  let found = 0
  let tried = 0
  let failures = 0
  for (let i = 0; i < todo.length; i++) {
    if (aborted(opts.signal)) break
    const c = todo[i]
    emit({ type: 'phase', phase: 'fill', detail: `Ishlar olinmoqda: ${i + 1}/${todo.length}…` })
    let ok = false
    try {
      const b = await (opts.deps ?? REAL).getCase(c.courtType, c.caseNumber)
      failures = 0
      tried++
      if (b.data.general) {
        ok = true
        found++
        writeDetail(c.courtType, c.caseNumber, b.data)
        const list = rows.get(c.courtType) ?? []
        list.push(b.row ?? rowFromDetail(b.data, { caseNumber: c.caseNumber, court: c.court }))
        rows.set(c.courtType, list)
        idx.tried[c.caseNumber] = { t: Date.now(), found: true }
      } else {
        idx.tried[c.caseNumber] = { t: Date.now(), found: false }
      }
      emit({ type: 'case', index: i + 1, of: todo.length, caseNumber: c.caseNumber, found: ok })
    } catch (e) {
      // a failed call proves nothing about the case: it is not marked tried, and a run of failures stops the fill
      if (++failures >= MAX_FAILURES_IN_ROW) throw new Error(`Sud tizimi javob bermayapti (${e instanceof Error ? e.message : e})`)
    }
    if ((i + 1) % 10 === 0) flush()
    await sleep(opts.paceMs ?? PACE_MS)
  }
  flush()
  if (found > 0) {
    // the day snapshots hold the lists as they were without these cases
    dropSnapshot(tin, 'court:')
    dropSnapshot(tin, 'stats')
    clearCourtCaseCache(tin)
  }
  return { found, tried }
}

/** One run: scan (when asked for or missing) then fill. Throws when another run of the same company is going. */
export async function runBillCases(tin: string, emit: (e: BillCasesEvent) => void, opts: RunOpts = {}): Promise<void> {
  if (running.has(tin)) throw new Error('Bu kompaniya uchun jarayon allaqachon ketmoqda')
  running.add(tin)
  try {
    const mode = opts.scan ?? 'auto'
    const idx = readBillIndex(tin)
    // an unfinished scan is finished first; a finished one is read again only when asked
    if (mode === 'force') await scan(tin, emit, opts, true)
    else if (mode === 'auto' && (!idx || !idx.complete)) await scan(tin, emit, opts, false)
    if (aborted(opts.signal)) {
      emit({ type: 'done', status: billCasesStatus(tin), found: 0, tried: 0 })
      return
    }
    const r = await fill(tin, emit, opts)
    emit({ type: 'done', status: billCasesStatus(tin), ...r })
  } finally {
    running.delete(tin)
  }
}
