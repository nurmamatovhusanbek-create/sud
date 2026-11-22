/**
 * The background job (lib/bill-cases): loads all bills page by page into the store, then asks the court for the cases they name that no list
 * has, one at a time, with back-off, announcing every find. billing and the court are faked; time is faked too (no real waiting).
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

mock.module('server-only', () => ({}))
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bill-job-'))
process.env.CASE_STORE_DIR = DIR
process.env.SNAPSHOT_DIR = path.join(DIR, 'snap')
process.env.SUD_DB = path.join(DIR, 'sud.db')
const dbm = await import('../db')
const store = await import('../case-store')
const bills = await import('../bills-store')
const lib = await import('../bill-cases')
import type { BillCasesDeps } from '../bill-cases'
import type { CaseLean } from '../court-case'
import type { FullCaseData } from '../court-case-types'

const TIN = '207324986'
let n = 0
const bill = (caseNumber: string | null, courtType = 'CITIZEN', cat = 'Давлат божи') => ({ number: String(300000000000 + n++), invoiceStatus: 'USED', issued: 1, amount: 100, paidAmount: 100, payCategory: cat, payCategoryId: 1, court: 'Bill court', courtType, claimCaseNumber: caseNumber, payerTin: TIN })
// 3 pages: a case has TWO bills (state duty + postal costs), often on different pages
const PAGES: unknown[][] = [
  [bill('2-1004-2603/1'), bill(null), bill('2-1004-2101/2'), bill(null)],
  [bill('4-1001-2505/3', 'ECONOMIC'), bill('2-1004-2603/1', 'CITIZEN', 'Почта харажатлари'), bill(null)],
  [bill('2-1004-2401/4'), bill('2-1004-2101/2', 'CITIZEN', 'Почта харажатлари')],
]
let billCalls: number[] = []
let billSizes: number[] = []
let pagesFor: ((page: number, size: number, call: number) => unknown[]) | null = null
let bigTotal: number | null = null // a dataset of this many bills: totals follow the page size
let callNo = 0
let billFails: Record<number, number> = {} // page → how many calls fail first
let caseCalls: string[] = []
let waits: number[] = []
let script: Record<string, CaseLean[]> = {}
let defaultCase: (num: string) => CaseLean

const detailOf = (num: string): FullCaseData => ({
  general: { caseNumber: num, caseType: 'Qarz', caseStatus: 'Якунланган (Ижро варақасиз)', court: 'Real court', judge: 'J', secretary: '-', plaintiff: 'A', plaintiffTin: '-', defendant: 'B', defendantTin: '-', thirdParty: '-', claimSubject: '', claimAmount: '1', applicationDate: '01.02.2022', initiatedDate: '-', deadlineDate: '-', stateDuty: '-', representative: '-', prosecutor: '-' },
  firstInstance: { hearings: [], decision: null, documents: [] }, appellate: null, cassation: null, inspection: null,
})
const found = (num: string): CaseLean => ({ kind: 'found', via: 'new', data: detailOf(num), row: null })

const deps: Partial<BillCasesDeps> = {
  searchBills: (async (_inn: string, o: { page?: number; size?: number } = {}) => {
    const page = o.page ?? 0
    billCalls.push(page)
    billSizes.push(o.size ?? 0)
    callNo++
    if ((billFails[page] ?? 0) > 0) { billFails[page]--; throw new Error('Failed captcha check') }
    const content = pagesFor ? pagesFor(page, o.size ?? 0, callNo) : (PAGES[page] ?? [])
    if (bigTotal !== null) { const sz = o.size ?? 10000; return { content, pageNumber: page, pageSize: sz, totalElements: bigTotal, totalPages: Math.ceil(bigTotal / sz), last: (page + 1) * sz >= bigTotal } }
    return { content, pageNumber: page, pageSize: o.size ?? 10000, totalElements: 9, totalPages: PAGES.length, last: page >= PAGES.length - 1 }
  }) as unknown as BillCasesDeps['searchBills'],
  getCase: async (_c, num) => {
    caseCalls.push(num)
    const q = script[num]
    return q?.length ? q.shift()! : defaultCase(num)
  },
  sleep: async (ms) => { waits.push(ms) },
}

const run = async (o: Parameters<typeof lib.startJob>[1] = {}) => {
  lib.startJob(TIN, { deps, paceMs: 1000, ...o })
  await lib.jobDone()
  return lib.jobStatus(TIN)
}

beforeEach(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
  fs.mkdirSync(DIR, { recursive: true })
  store.forgetCaseStoreMemory(); lib.forgetJob()
  n = 0; billCalls = []; billSizes = []; pagesFor = null; bigTotal = null; callNo = 0; billFails = {}; caseCalls = []; waits = []; script = {}; defaultCase = found
})
afterAll(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('load', () => {
  test('stores every page as it arrives; a pass whose pages did not overlap is the whole load; the cases come out with BOTH their bills', async () => {
    const st = await run({ fill: false })
    expect(billCalls).toEqual([0, 1, 2])
    expect(billSizes).toEqual([10_000, 10_000, 10_000])
    expect(st).toMatchObject({ state: 'done', pages: 3, bills: 9, pass: 0, stable: true })
    expect(bills.readBillsMeta(TIN)).toMatchObject({ pagesDone: 3, complete: true, stable: true, pass: 0 })
    expect(bills.billCaseCount(TIN)).toBe(4)
    expect(bills.nextMissingCases(TIN, 0, 10).map((c) => c.caseNumber)).toEqual(['2-1004-2603/1', '4-1001-2505/3', '2-1004-2401/4', '2-1004-2101/2']) // newest registration first
    expect(bills.billsOfCase(TIN, '2-1004-2603/1').map((b) => b.cat)).toEqual(['Давлат божи', 'Почта харажатлари']) // state duty on page 1, postal costs on page 2
    expect(caseCalls).toEqual([]) // fill was not asked for
  })

  test('billing\'s unstable paging: overlapping pages mean another pass with other page boundaries, and the passes\' bills are ONE set', async () => {
    // pass 0: page 1 repeats page 0's bills (billing skipped the rows that belonged there); pass 1 (size 9000) returns them
    const row = (i: number) => bill(`2-1004-26${String(i).padStart(2, '0')}/${i}`, 'CITIZEN')
    const rows = Array.from({ length: 30 }, (_, i) => { const r = row(i) as Record<string, unknown>; r.number = String(500000000000 + i); return r })
    pagesFor = (page, size) => {
      if (size === 10_000) return page === 0 ? rows.slice(0, 10) : page === 1 ? rows.slice(0, 10) /* repeat */ : rows.slice(20, 30)
      return page === 0 ? rows.slice(0, 10) : page === 1 ? rows.slice(10, 20) : rows.slice(20, 30)
    }
    const st = await run({ fill: false })
    expect(billSizes).toEqual([10_000, 10_000, 10_000, 9_000, 9_000, 9_000]) // two passes
    expect(st).toMatchObject({ state: 'done', pass: 1, stable: true })
    expect(bills.queryBills(TIN, {})?.total).toBe(30) // the 10 the first pass skipped came with the second
    expect(bills.readBillsMeta(TIN)).toMatchObject({ pass: 1, complete: true, stable: true })
  })

  test('passes that never agree stop after the last size, and the load says it is not certain', async () => {
    let k = 0
    pagesFor = (page) => PAGES[page === 1 ? 0 : page].map((r) => ({ ...(r as object), number: String(600000000000 + k++) })).concat(PAGES[0].map(() => ({ number: '600000000000', invoiceStatus: 'USED', claimCaseNumber: null }))) // always repeats a bill
    const st = await run({ fill: false })
    expect(st.state).toBe('done')
    expect(st.stable).toBe(false)
    expect(new Set(billSizes)).toEqual(new Set([10_000, 9_000, 8_000, 7_000, 9_500, 8_500, 7_500, 6_500])) // every size is tried before the load gives up
    expect(bills.readBillsMeta(TIN)).toMatchObject({ complete: true, stable: false })
  })

  test('a page that fails on the captcha is tried again after a pause, then the load goes on', async () => {
    billFails = { 1: 2 }
    const st = await run({ fill: false })
    expect(st.state).toBe('done')
    expect(billCalls).toEqual([0, 1, 1, 1, 2])
    expect(waits).toEqual([30_000, 60_000])
  })

  test('a page that keeps failing ends the job with the pages already stored kept; the next start resumes the SAME pass after them', async () => {
    billFails = { 2: 99, 10: 99, 11: 99, 12: 99, 13: 99, 14: 99 } // the window fails as a whole page AND as its five smaller requests
    const st = await run({ fill: false })
    expect(st.state).toBe('error')
    expect(st.lastError).toContain('captcha')
    expect(bills.readBillsMeta(TIN)).toMatchObject({ pagesDone: 2, complete: false })
    billFails = {}; billCalls = []; billSizes = []
    expect((await run({ fill: false })).state).toBe('done')
    // the pass was resumed in another run: its earlier pages' numbers are lost, so it is never called stable and ONE more pass (other page size) follows
    expect(billCalls).toEqual([2, 0, 1, 2])
    expect(billSizes).toEqual([10_000, 9_000, 9_000, 9_000])
    expect(bills.readBillsMeta(TIN)?.complete).toBe(true)
  })

  test('a finished load is not read again; «refresh» reads a new pass, the stored bills stay', async () => {
    await run({ fill: false })
    billCalls = []
    await run({ fill: false })
    expect(billCalls).toEqual([])
    await run({ fill: false, load: 'refresh' })
    expect(billCalls).toEqual([0, 1, 2])
    expect(bills.readBillsMeta(TIN)).toMatchObject({ complete: true, pass: 1 })
    expect(bills.queryBills(TIN, {})?.total).toBe(6) // only the bills that name a case are kept (3 of the 9 name none)
  })

  test('the first scrape\'s date is set once; a finished load is «as of» the moment it began; a refresh says what it added', async () => {
    let clock = 1_000_000
    const withClock = { ...deps, now: () => clock }
    lib.startJob(TIN, { deps: withClock, paceMs: 1000, fill: false })
    await lib.jobDone()
    expect(lib.billCasesStatus(TIN)).toMatchObject({ firstAt: 1_000_000, refreshedAt: 1_000_000, lastAdded: 6 })
    // two weeks later a refresh finds one more bill on the last page
    clock = 2_000_000
    const base = PAGES[2]!
    n = 500
    PAGES[2] = [...base, bill('2-1004-2509/9')]
    try {
      lib.startJob(TIN, { deps: withClock, paceMs: 1000, fill: false, load: 'refresh' })
      await lib.jobDone()
    } finally {
      PAGES[2] = base
    }
    expect(lib.billCasesStatus(TIN)).toMatchObject({ firstAt: 1_000_000, refreshedAt: 2_000_000, lastAdded: 1 })
  })

  test('a load stopped half way does not move «refreshed»; the resumed load keeps the date it began on', async () => {
    let clock = 5_000
    const withClock = { ...deps, now: () => clock }
    billFails = { 1: 99, 5: 99, 6: 99, 7: 99, 8: 99, 9: 99 } // page 1 keeps failing (whole and split): the load ends with an error after page 0
    lib.startJob(TIN, { deps: withClock, paceMs: 1000, fill: false })
    await lib.jobDone()
    expect(lib.jobStatus(TIN).state).toBe('error')
    expect(lib.billCasesStatus(TIN)).toMatchObject({ firstAt: 5_000, refreshedAt: 0 })
    clock = 9_000
    billFails = {}
    lib.forgetJob()
    lib.startJob(TIN, { deps: withClock, paceMs: 1000, fill: false })
    await lib.jobDone()
    expect(lib.billCasesStatus(TIN)).toMatchObject({ firstAt: 5_000, refreshedAt: 5_000 })
  })

  test('a big page that keeps failing is asked as five smaller requests of the same window, and the load goes on', async () => {
    // 25 000 bills: pages of 10 000 → 3 pages; page 1 (offset 10 000) is rejected every time at the full size
    const all = Array.from({ length: 25_000 }, (_, i) => ({ ...bill('2-1004-2603/1'), number: String(400000000000 + i) }))
    bigTotal = 25_000
    pagesFor = (page, size) => all.slice(page * size, (page + 1) * size)
    billFails = { 1: 99 } // only the full-size page index 1 fails; the split uses page indexes 5-9 of size 2 000
    const st = await run({ fill: false })
    expect(st.state).toBe('done')
    // page 1 needed the split after three failures; page 2 (deeper) then STARTED split without trying the full size again
    expect(billSizes.filter((x) => x === 2_000)).toHaveLength(10)
    expect(billCalls.filter((p) => p >= 5 && p <= 9)).toEqual([5, 6, 7, 8, 9])
    expect(billCalls.filter((p) => p >= 10)).toEqual([10, 11, 12, 13, 14])
    expect(bills.queryBills(TIN, {})?.total).toBe(25_000) // every bill of the failing window arrived
    expect(waits).toEqual([30_000, 60_000, 90_000]) // three full-size attempts on page 1 only; the deeper page went straight to the split
    expect(lib.billCasesStatus(TIN).passes[0]).toMatchObject({ pass: 0, size: 10_000, rows: 25_000, added: 25_000 })
  })

  test('an empty page inside the range is an error, not the end', async () => {
    const orig = PAGES[1]
    PAGES[1] = []
    try {
      const st = await run({ fill: false })
      expect(st.state).toBe('error')
      expect(st.lastError).toContain('boʻsh')
      expect(bills.readBillsMeta(TIN)?.complete).toBe(false)
    } finally {
      PAGES[1] = orig
    }
  })
})

describe('fill', () => {
  test('asks newest first, one at a time, paced; stores the detail and the row; announces every find', async () => {
    const st = await run({ fill: true })
    expect(caseCalls[0]).toBe('2-1004-2603/1') // 2603 is the newest registration
    expect(caseCalls).toHaveLength(4)
    expect(st).toMatchObject({ state: 'done', total: 4, done: 4, found: 4, absent: 0, seq: 4 })
    expect(waits.filter((w) => w === 1000)).toHaveLength(4)
    expect(store.readDetail('civil', '2-1004-2603/1')?.data.general?.court).toBe('Real court')
    expect(store.readFound(TIN, 'civil').map((r) => r.caseNumber).sort()).toEqual(['2-1004-2101/2', '2-1004-2401/4', '2-1004-2603/1'])
    expect(store.readFound(TIN, 'economic').map((r) => r.caseNumber)).toEqual(['4-1001-2505/3'])
    const ev = lib.eventsSince(TIN, 0)
    expect(ev.events.map((e) => e.seq)).toEqual([1, 2, 3, 4])
    expect(ev.events[0].courtType).toBe('civil')
    expect(lib.eventsSince(TIN, 3).events.map((e) => e.seq)).toEqual([4]) // a page that has 3 gets only the new one
    expect(lib.eventsSince(TIN, 4).events).toEqual([])
  })

  test('cases the stored lists already have are not asked; found ones and fresh «not found» ones are not asked again', async () => {
    store.writeFeed(TIN, 'civil|x', { t: 1, complete: true, items: [{ caseNumber: '2-1004-2603/1', caseType: '', caseStatus: '', result: '', courtName: '', dateFiled: '', plaintiff: '', defendant: '', claimAmount: '', hearingDate: '', hearingTime: '', judge: '' }] })
    script = { '2-1004-2101/2': [{ kind: 'absent' }] }
    await run({ fill: true })
    expect(caseCalls).not.toContain('2-1004-2603/1')
    expect(caseCalls).toHaveLength(3)
    expect(lib.jobStatus(TIN)).toMatchObject({ found: 2, absent: 1 })
    caseCalls = []
    await run({ fill: true, load: 'skip' })
    expect(caseCalls).toEqual([])
    expect(lib.billCasesStatus(TIN)).toMatchObject({ billCases: 4, found: 2, notFound: 1, missing: 0 })
  })

  test('«not found» is asked again after two weeks', async () => {
    script = { '2-1004-2101/2': [{ kind: 'absent' }] }
    await run({ fill: true })
    const later = Date.now() + lib.RETRY_MISSING_MS + 1000
    expect(lib.billCasesStatus(TIN, later)).toMatchObject({ notFound: 0, missing: 1 })
  })

  test('a failed request backs off (20 s, 40 s …) and asks the SAME case again; a success resets the back-off', async () => {
    script = { '2-1004-2603/1': [{ kind: 'error', message: 'HTTP 429' }, { kind: 'error', message: 'HTTP 429' }] } // third ask succeeds
    const st = await run({ fill: true })
    expect(st).toMatchObject({ state: 'done', found: 4, errors: 2 })
    expect(caseCalls.slice(0, 3)).toEqual(['2-1004-2603/1', '2-1004-2603/1', '2-1004-2603/1'])
    expect(waits.slice(0, 2)).toEqual([20_000, 40_000])
    expect(store.readTried(TIN)['2-1004-2603/1']).toMatchObject({ found: true })
  })

  test('six failures in a row PAUSE the job (the court is not pressed on) and the pause says why; found cases are kept', async () => {
    script = { '2-1004-2401/4': Array.from({ length: 10 }, () => ({ kind: 'error', message: 'HTTP 503' }) as CaseLean) }
    const st = await run({ fill: true })
    // 2603 then 2505 are found first, 2401 keeps failing
    expect(st.state).toBe('paused')
    expect(st.lastError).toContain('HTTP 503')
    expect(st.found).toBe(2)
    expect(store.readFound(TIN, 'civil').map((r) => r.caseNumber)).toEqual(['2-1004-2603/1'])
    expect(store.readFound(TIN, 'economic')).toHaveLength(1)
    expect(waits.filter((w) => w >= 20_000)).toEqual([20_000, 40_000, 80_000, 160_000, 320_000])
    // a failed case is NOT marked tried: after the court is back it is asked
    expect(store.readTried(TIN)['2-1004-2401/4']).toBeUndefined()
  })

  test('the back-off is capped at 15 minutes', async () => {
    script = { '2-1004-2603/1': Array.from({ length: 5 }, () => ({ kind: 'error', message: 'x' }) as CaseLean) }
    await run({ fill: true })
    expect(Math.max(...waits)).toBeLessThanOrEqual(15 * 60_000)
  })

  test('a thrown error counts as a failure, not a crash', async () => {
    const d: Partial<BillCasesDeps> = { ...deps, getCase: async () => { throw new Error('socket hang up') } }
    const st = await run({ fill: true, deps: d })
    expect(st.state).toBe('paused')
    expect(st.lastError).toContain('socket hang up')
  })

  test('«Toʻxtatish» ends it after the current step and keeps what was found', async () => {
    const d: Partial<BillCasesDeps> = { ...deps, getCase: async (c, num) => { const r = await deps.getCase!(c, num); lib.stopJob(TIN); return r } }
    const st = await run({ fill: true, deps: d })
    expect(st.state).toBe('stopped')
    expect(caseCalls).toHaveLength(1)
    expect(store.readFound(TIN, 'civil')).toHaveLength(1) // flushed on the way out
  })

  test('one job at a time for the whole app: another company is refused while one runs', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const slow: Partial<BillCasesDeps> = { ...deps, searchBills: (async (...a: unknown[]) => { await gate; return (deps.searchBills as (...x: unknown[]) => unknown)(...a) }) as unknown as BillCasesDeps['searchBills'] }
    lib.startJob(TIN, { deps: slow, fill: false })
    expect(lib.billJobRunning()).toBe(true)
    expect(() => lib.startJob(TIN, { deps })).toThrow('allaqachon')
    expect(() => lib.startJob('201052713', { deps })).toThrow('Boshqa kompaniya')
    release()
    await lib.jobDone()
    expect(lib.billJobRunning()).toBe(false)
    expect(() => lib.startJob('201052713', { deps, fill: false })).not.toThrow()
    await lib.jobDone()
  })

  test('the queue lives in the database: it is read a batch at a time and survives a restart of the job', async () => {
    await run({ fill: true })
    const st1 = lib.jobStatus(TIN)
    expect(st1).toMatchObject({ found: 4, total: 4 })
    // after a restart of the process nothing is asked again: what was answered is in the tables
    dbm.closeDb(); store.forgetCaseStoreMemory(); lib.forgetJob()
    caseCalls = []
    await run({ fill: true, load: 'skip' })
    expect(caseCalls).toEqual([])
    expect(store.readFound(TIN, 'civil').length + store.readFound(TIN, 'economic').length).toBe(4)
  })

  test('a case recorded as found is written the moment it is found (a crash loses nothing)', async () => {
    const d: Partial<BillCasesDeps> = { ...deps, getCase: async (c, num) => { const r = await deps.getCase!(c, num); if (caseCalls.length >= 3) throw new Error('process died'); return r } }
    // the third call throws: the job pauses after failures, but the first two are already in the tables
    const st = await run({ fill: true, deps: d })
    expect(st.found).toBe(2)
    expect(store.readFound(TIN, 'civil').length + store.readFound(TIN, 'economic').length).toBe(2)
  })
})
