/**
 * Finding the cases a capped TIN list hides, through the bills (lib/bill-cases): the scan is paged and resumable, the fill asks the court
 * by number, newest first, and what it finds lands in the company's stored lists. billing and the court are faked.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

mock.module('server-only', () => ({}))
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bill-cases-'))
process.env.CASE_STORE_DIR = DIR
process.env.SNAPSHOT_DIR = path.join(DIR, 'snap')
const store = await import('../case-store')
const lib = await import('../bill-cases')
import type { BillCasesDeps, BillCasesEvent } from '../bill-cases'
import type { FullCaseData } from '../court-case-types'

const TIN = '201052713'
const bill = (n: string | null, courtType = 'CITIZEN') => ({ number: String(Math.random()), invoiceStatus: 'USED', issued: 1, claimCaseNumber: n, courtType, court: 'Bill court', decisionDate: null })
// 3 pages of bills: some name cases, most do not
const PAGES = [
  [bill('2-1004-2603/1'), bill(null), bill('2-1004-2101/2'), bill(null)],
  [bill('4-1001-2505/3', 'ECONOMIC'), bill('2-1004-2603/1'), bill(null)],
  [bill('2-1004-2401/4'), bill(null)],
]
const known = new Set<string>()
let billCalls: number[] = []
let caseCalls: string[] = []
let failBillsAtPage: number | null = null
let missing = new Set<string>()
let failCases = false

const detailOf = (n: string): FullCaseData => ({
  general: { caseNumber: n, caseType: 'Qarz', caseStatus: 'Якунланган (Ижро варақасиз)', court: 'Real court', judge: 'J', secretary: '-', plaintiff: 'A', plaintiffTin: '-', defendant: 'B', defendantTin: '-', thirdParty: '-', claimSubject: '', claimAmount: '1', applicationDate: '01.02.2022', initiatedDate: '-', deadlineDate: '-', stateDuty: '-', representative: '-', prosecutor: '-' },
  firstInstance: { hearings: [], decision: null, documents: [] }, appellate: null, cassation: null, inspection: null,
})
const deps: BillCasesDeps = {
  searchBills: (async (_inn: string, o: { page?: number } = {}) => {
    const page = o.page ?? 0
    billCalls.push(page)
    if (failBillsAtPage === page) throw new Error('billing down')
    const content = PAGES[page] ?? []
    return { content, pageNumber: page, pageSize: 10000, totalElements: 9, totalPages: PAGES.length, last: page >= PAGES.length - 1 }
  }) as unknown as BillCasesDeps['searchBills'],
  getCase: (async (_ct: string, n: string) => {
    caseCalls.push(n)
    if (failCases) throw new Error('court down')
    if (missing.has(n)) return { data: { general: null, firstInstance: null, appellate: null, cassation: null, inspection: null }, row: null }
    return { data: detailOf(n), row: n.startsWith('4-') ? { caseNumber: n, caseType: 'Qarz', caseStatus: 'x', result: '', courtName: 'c', dateFiled: '', plaintiff: '', defendant: '', claimAmount: '', hearingDate: '', hearingTime: '', judge: '' } : null }
  }) as unknown as BillCasesDeps['getCase'],
}

const events: BillCasesEvent[] = []
const run = (opts: Parameters<typeof lib.runBillCases>[2] = {}) => lib.runBillCases(TIN, (e) => events.push(e), { deps, paceMs: 0, ...opts })

beforeEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true })
  store.forgetCaseStoreMemory()
  known.clear(); events.length = 0; billCalls = []; caseCalls = []; failBillsAtPage = null; missing = new Set(); failCases = false
})
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }))

describe('scan', () => {
  test('reads every page, keeps the distinct case numbers, saves after each page', async () => {
    await run({ limit: 1 })
    expect(billCalls).toEqual([0, 1, 2])
    const idx = store.readBillIndex(TIN)!
    expect(Object.keys(idx.cases).sort()).toEqual(['2-1004-2101/2', '2-1004-2401/4', '2-1004-2603/1', '4-1001-2505/3'])
    expect(idx.complete).toBe(true)
    expect(idx.cases['4-1001-2505/3'].courtType).toBe('economic')
    expect(events.filter((e) => e.type === 'scan').map((e) => (e as { page: number }).page)).toEqual([1, 2, 3])
  })

  test('a scan that fails half way keeps the pages it read and the next run resumes from there', async () => {
    failBillsAtPage = 2
    await expect(run({ limit: 1 })).rejects.toThrow('billing down')
    const part = store.readBillIndex(TIN)!
    expect(part.complete).toBe(false)
    expect(part.pagesDone).toBe(2)
    expect(Object.keys(part.cases)).toHaveLength(3)
    failBillsAtPage = null
    billCalls = []
    await run({ limit: 1 })
    expect(billCalls).toEqual([2]) // only the page that was missing
    expect(store.readBillIndex(TIN)!.complete).toBe(true)
  })

  test('a finished scan is not read again unless asked; force reads it again and keeps what was found', async () => {
    await run({ limit: 1 })
    billCalls = []
    await run({ limit: 1 })
    expect(billCalls).toEqual([])
    await run({ limit: 1, scan: 'force' })
    expect(billCalls).toEqual([0, 1, 2])
    expect(Object.keys(store.readBillIndex(TIN)!.cases)).toHaveLength(4)
  })

  test('an empty page inside the range is an error, not the end', async () => {
    const orig = PAGES[1]
    PAGES[1] = []
    try {
      await expect(run({ limit: 1 })).rejects.toThrow('boʻsh')
      expect(store.readBillIndex(TIN)!.complete).toBe(false)
    } finally {
      PAGES[1] = orig
    }
  })
})

describe('fill', () => {
  test('asks the court newest first, at most `limit`, and stores the details and the rows', async () => {
    await run({ limit: 2 })
    expect(caseCalls).toHaveLength(2)
    // newest registration first: 2603 then 2505
    expect(caseCalls[0]).toBe('2-1004-2603/1')
    expect(caseCalls[1]).toBe('4-1001-2505/3')
    expect(store.readDetail('civil', '2-1004-2603/1')?.data.general?.court).toBe('Real court')
    // the civil one had no list row: it is built from its detail; the economic one has the court's own row
    expect(store.readFeed(TIN, store.billsFeedKey('civil'))?.items.map((r) => r.caseNumber)).toEqual(['2-1004-2603/1'])
    expect(store.readFeed(TIN, store.billsFeedKey('economic'))?.items.map((r) => r.caseNumber)).toEqual(['4-1001-2505/3'])
    const done = events.at(-1) as Extract<BillCasesEvent, { type: 'done' }>
    expect(done).toMatchObject({ type: 'done', found: 2, tried: 2 })
    expect(done.status).toMatchObject({ billCases: 4, found: 2, missing: 2 })
  })

  test('a next run continues with the numbers not yet asked, and never asks a found one again', async () => {
    await run({ limit: 2 })
    caseCalls = []
    await run({ limit: 10 })
    expect(caseCalls.sort()).toEqual(['2-1004-2101/2', '2-1004-2401/4'])
    caseCalls = []
    await run({ limit: 10 })
    expect(caseCalls).toEqual([])
    expect(lib.billCasesStatus(TIN)).toMatchObject({ billCases: 4, found: 4, missing: 0, notFound: 0 })
  })

  test('cases the stored lists already have are not asked', async () => {
    store.writeFeed(TIN, 'civil|x', { t: 1, complete: true, items: [{ caseNumber: '2-1004-2603/1', caseType: '', caseStatus: '', result: '', courtName: '', dateFiled: '', plaintiff: '', defendant: '', claimAmount: '', hearingDate: '', hearingTime: '', judge: '' }] })
    await run({ limit: 10 })
    expect(caseCalls).not.toContain('2-1004-2603/1')
    expect(caseCalls).toHaveLength(3)
  })

  test('a number the court does not know is remembered and not asked again, but is asked again after two weeks', async () => {
    missing = new Set(['2-1004-2101/2'])
    await run({ limit: 10 })
    expect(lib.billCasesStatus(TIN)).toMatchObject({ found: 3, notFound: 1, missing: 0 })
    caseCalls = []
    await run({ limit: 10 })
    expect(caseCalls).toEqual([])
    const later = Date.now() + lib.RETRY_MISSING_MS + 1000
    expect(lib.billCasesStatus(TIN, later)).toMatchObject({ notFound: 0, missing: 1 })
  })

  test('failed calls are not marked as tried; three in a row stop the run with an error', async () => {
    failCases = true
    await expect(run({ limit: 10 })).rejects.toThrow('Sud tizimi javob bermayapti')
    expect(caseCalls).toHaveLength(3)
    expect(store.readBillIndex(TIN)!.tried).toEqual({})
    failCases = false
    caseCalls = []
    await run({ limit: 10 })
    expect(caseCalls).toHaveLength(4)
  })

  test('the found cases appear in the company\'s list through the bills feed, and the day snapshots are dropped', async () => {
    const snaps = await import('../snapshot-store')
    snaps.writeSnapshot(TIN, 'court:civil', { cases: [] })
    snaps.writeSnapshot(TIN, 'stats', { x: 1 })
    await run({ limit: 10 })
    expect(snaps.readSnapshot(TIN, 'court:civil')).toBeNull()
    expect(snaps.readSnapshot(TIN, 'stats')).toBeNull()
  })

  test('stopping (an aborted signal) ends the run after the current step and keeps what was found', async () => {
    const ac = new AbortController()
    const d2: BillCasesDeps = { ...deps, getCase: (async (c: string, n: string) => { const r = await deps.getCase(c as never, n); ac.abort(); return r }) as unknown as BillCasesDeps['getCase'] }
    await lib.runBillCases(TIN, (e) => events.push(e), { deps: d2, paceMs: 0, limit: 10, signal: ac.signal })
    expect(caseCalls).toHaveLength(1)
    expect(store.readFeed(TIN, store.billsFeedKey('civil'))?.items).toHaveLength(1)
  })

  test('only one run per company at a time', async () => {
    const slow: BillCasesDeps = { ...deps, searchBills: (async (...a: unknown[]) => { await new Promise((r) => setTimeout(r, 30)); return (deps.searchBills as (...x: unknown[]) => unknown)(...a) }) as unknown as BillCasesDeps['searchBills'] }
    const first = lib.runBillCases(TIN, () => {}, { deps: slow, limit: 1 })
    await expect(lib.runBillCases(TIN, () => {}, { deps, limit: 1 })).rejects.toThrow('allaqachon')
    await first
  })
})
