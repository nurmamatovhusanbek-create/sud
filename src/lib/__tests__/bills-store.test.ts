/**
 * The bills store (lib/bills-store): pages written as they arrive, read back in memory, queried (filters, sort, paging, summary) and cross-referenced.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bills-store-'))
process.env.SUD_DB = path.join(DIR, 'sud.db')
const dbm = await import('../db')
const store = await import('../bills-store')
import type { BillRow } from '@/core/bill-rows'

const TIN = '207324986'
const mk = (i: number, extra: Partial<BillRow> = {}): BillRow => ({
  number: String(100000000000 + i), status: 'USED', issued: 1_700_000_000_000 + i * 1000, amount: 100 + i, paid: 100 + i, mustPay: 0, balance: 0, overdue: null,
  cat: i % 2 ? 'Почта харажатлари' : 'Давлат божи', catId: i % 2 ? 3 : 1, court: `Sud ${i % 3}`, courtId: i % 3, courtType: i % 4 === 0 ? 'ECONOMIC' : 'CITIZEN',
  caseNumber: `2-1004-2608/${Math.floor(i / 2)}`, decision: null, desc: `desc ${i}`, payer: 'BANK', payerTin: TIN, inFavor: true, account: 'a', ...extra,
})
const page = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => mk(from + i))
const T = { totalElements: 30, totalPages: 3, pageSize: 10 }
const D = { done: false, stable: false }
const write = (pg: number, rows: BillRow[], done = D, pass = 0, t = T) => store.writeBillsPage(TIN, pass, pg, rows, t, done)

beforeEach(() => {
  dbm.closeDb()
  for (const n of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, n), { force: true })
})
afterAll(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('pages', () => {
  test('a page is readable the moment it is written, while the later ones are still to come', () => {
    expect(store.queryBills(TIN, {})).toBeNull()
    write(0, page(0, 10))
    expect(store.readBillsMeta(TIN)).toMatchObject({ pagesDone: 1, totalPages: 3, complete: false, pass: 0 })
    expect(store.queryBills(TIN, {})?.total).toBe(10)
    write(1, page(10, 20))
    expect(store.queryBills(TIN, {})?.total).toBe(20)
    write(2, page(20, 30), { done: true, stable: true })
    expect(store.readBillsMeta(TIN)).toMatchObject({ pagesDone: 3, complete: true, stable: true })
    expect(store.queryBills(TIN, {})?.total).toBe(30)
  })

  test('«complete» is the job\'s verdict, never guessed from the page count', () => {
    write(0, page(0, 10), D, 0, { totalElements: 10, totalPages: 1, pageSize: 10 })
    expect(store.readBillsMeta(TIN)?.complete).toBe(false)
  })

  test('it survives a restart, and a later pass wins when a bill is in two (it was refreshed)', () => {
    write(0, [mk(1, { status: 'CREATED' }), mk(2)], D, 0)
    write(0, [mk(1, { status: 'PAID' })], D, 1)
    dbm.closeDb()
    const q = store.queryBills(TIN, {})!
    expect(q.total).toBe(2)
    expect(q.rows.find((r) => r.number.endsWith('01'))?.status).toBe('PAID')
  })

  test('the passes are ONE set: bills a later pass did not return are still there (billing\'s paging skips some)', () => {
    write(0, page(0, 10), D, 0)
    write(0, page(5, 15), D, 1)
    expect(store.queryBills(TIN, {})?.total).toBe(15)
  })

  test('companies do not mix', () => {
    write(0, page(0, 10))
    store.writeBillsPage('201052713', 0, 0, page(100, 105), T, D)
    expect(store.queryBills(TIN, {})?.total).toBe(10)
    expect(store.queryBills('201052713', {})?.total).toBe(5)
  })

  test('a row survives the round trip field by field (nulls included)', () => {
    const r = mk(7, { issued: null, amount: null, caseNumber: null, inFavor: null, decision: 1789516800000 })
    write(0, [r])
    expect(store.queryBills(TIN, {})!.rows[0]).toEqual(r)
  })

  test('only a 9-digit STIR and sane pass / page numbers reach the database', () => {
    for (const bad of ['../x', '12345678', '1234567890', '']) {
      expect(store.writeBillsPage(bad, 0, 0, page(0, 1), T, D)).toBe(false)
      expect(store.readBillsMeta(bad)).toBeNull()
    }
    expect(store.writeBillsPage(TIN, 0, -1, page(0, 1), T, D)).toBe(false)
    expect(store.writeBillsPage(TIN, 0, 1.5, page(0, 1), T, D)).toBe(false)
    expect(store.writeBillsPage(TIN, -1, 0, page(0, 1), T, D)).toBe(false)
    expect(store.writeBillsPage(TIN, 1000, 0, page(0, 1), T, D)).toBe(false)
    expect(store.queryBills(TIN, {})).toBeNull()
  })

  test('the overlap of a page not yet written: bills this pass already had, and bills nobody had', () => {
    write(0, page(0, 10), D, 0)
    // pass 0 again: 0-4 repeat (overlap), 10-14 are new
    expect(store.pageOverlap(TIN, 0, [...page(0, 5), ...page(10, 15)].map((r) => r.number))).toEqual({ overlap: 5, added: 5 })
    // a later pass meeting the same bills is NOT an overlap (earlier passes are expected to repeat), but they are not «added» either
    expect(store.pageOverlap(TIN, 1, page(0, 5).map((r) => r.number))).toEqual({ overlap: 0, added: 0 })
    // a repeat inside the page counts once
    expect(store.pageOverlap(TIN, 0, [mk(0).number, mk(0).number, mk(99).number])).toEqual({ overlap: 1, added: 1 })
  })
})

describe('queries', () => {
  beforeEach(() => write(0, page(0, 30)))

  test('paging and sort: newest first by default, the page is clamped', () => {
    const a = store.queryBills(TIN, { page: 1, size: 5 })!
    expect(a.rows.map((r) => r.number.slice(-2))).toEqual(['29', '28', '27', '26', '25'])
    expect(a.matched).toBe(30)
    expect(store.queryBills(TIN, { page: 99, size: 5 })!.rows.map((r) => r.number.slice(-2))).toEqual(['04', '03', '02', '01', '00'])
    expect(store.queryBills(TIN, { sort: 'az', size: 1 })!.rows[0].number.endsWith('00')).toBe(true)
  })

  test('filters narrow the list, the summary stays the whole company\'s', () => {
    const q = store.queryBills(TIN, { court: 'economic', kind: 'davlat_boji', size: 100 })!
    expect(q.rows.every((r) => r.courtType === 'ECONOMIC' && r.catId === 1)).toBe(true)
    expect(q.matched).toBe(8) // i % 4 === 0 (economic) and even (state duty): 0,4,…,28
    expect(q.total).toBe(30)
    expect(q.summary.count).toBe(30)
  })

  test('search by case number', () => {
    expect(store.queryBills(TIN, { q: '2-1004-2608/7', size: 100 })!.rows.map((r) => r.number.slice(-2)).sort()).toEqual(['14', '15'])
  })

  test('a case\'s bills are its two: state duty and postal costs', () => {
    const b = store.billsOfCase(TIN, '2-1004-2608/3')
    expect(b.map((r) => r.catId).sort()).toEqual([1, 3])
    expect(store.billsOfCase(TIN, '2-1004-2608/9999')).toEqual([])
    expect(store.billCaseCount(TIN)).toBe(15)
  })

  test('Cyrillic search ignores case (the court and the description are lower-cased when stored)', () => {
    write(1, [mk(50, { court: 'Фуқаролик ишлари бўйича Учтепа суди', desc: 'Почта Харажатлари' })], D, 0)
    expect(store.queryBills(TIN, { q: 'УЧТЕПА', size: 10 })!.matched).toBe(1)
    expect(store.queryBills(TIN, { q: 'почта харажат', size: 10 })!.matched).toBe(1)
  })

  test('the summary counts the whole company by status, court type and fee kind', () => {
    const s = store.queryBills(TIN, {})!.summary
    expect(s).toMatchObject({ count: 30, paid: 30, overdue: 0, withCase: 30, cases: 15 })
    expect(s.byKind).toEqual({ davlat_boji: 15, pochta: 15, other: 0 })
    expect(s.byCourt).toEqual({ economic: 8, civil: 22 })
    // a write refreshes it
    write(1, [mk(60, { status: 'OVERDUE', overdue: 500, amount: 1000 })], D, 0)
    const s2 = store.queryBills(TIN, {})!.summary
    expect(s2).toMatchObject({ count: 31, overdue: 1, overdueSum: 500 })
  })

  test('the export list is the matches, capped', () => {
    expect(store.listBills(TIN, { court: 'economic' }, 100)).toHaveLength(8)
    expect(store.listBills(TIN, {}, 5)).toHaveLength(5)
    expect(store.listBills('201052713', {}, 5)).toBeNull()
  })

  test('recent bills are the newest', () => {
    expect(store.recentBills(TIN, 3).map((r) => r.number.slice(-2))).toEqual(['29', '28', '27'])
  })
})
