/**
 * The bills store (lib/bills-store): pages written as they arrive, read back in memory, queried (filters, sort, paging, summary) and cross-referenced.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bills-store-'))
process.env.CASE_STORE_DIR = DIR
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
const write = (page: number, rows: BillRow[], done = D, pass = 0, t = T) => store.writeBillsPage(TIN, pass, page, rows, t, done)

beforeEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true })
  store.forgetBillsMemory()
})
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }))

describe('pages', () => {
  test('a page is readable the moment it is written, while the later ones are still to come', () => {
    expect(store.queryBills(TIN, {})).toBeNull()
    write(0, page(0, 10))
    expect(store.readBillsMeta(TIN)).toMatchObject({ pagesDone: 1, totalPages: 3, complete: false, pass: 0 })
    expect(store.queryBills(TIN, {})?.total).toBe(10)
    write(1, page(10, 20))
    expect(store.queryBills(TIN, {})?.total).toBe(20) // the memory copy was dropped by the write
    write(2, page(20, 30), { done: true, stable: true })
    expect(store.readBillsMeta(TIN)).toMatchObject({ pagesDone: 3, complete: true, stable: true })
    expect(store.queryBills(TIN, {})?.total).toBe(30)
  })

  test('«complete» is the job\'s verdict, never guessed from the page count', () => {
    write(0, page(0, 10), D, 0, { totalElements: 10, totalPages: 1, pageSize: 10 })
    expect(store.readBillsMeta(TIN)?.complete).toBe(false) // the last page arrived, but the passes have not agreed yet
  })

  test('it survives a restart, and a later pass wins when a bill is in two (it was refreshed)', () => {
    write(0, [mk(1, { status: 'CREATED' }), mk(2)], D, 0)
    write(0, [mk(1, { status: 'PAID' })], D, 1)
    store.forgetBillsMemory()
    const q = store.queryBills(TIN, {})!
    expect(q.total).toBe(2)
    expect(q.rows.find((r) => r.number.endsWith('01'))?.status).toBe('PAID')
  })

  test('the passes are ONE set: bills a later pass did not return are still there (billing\'s paging skips some)', () => {
    write(0, page(0, 10), D, 0)
    write(0, page(5, 15), D, 1)
    expect(store.queryBills(TIN, {})?.total).toBe(15)
  })

  test('the numbers of one pass can be read back (a resumed pass keeps counting its overlaps)', () => {
    write(0, page(0, 10), D, 0)
    write(1, page(10, 20), D, 0)
    write(0, page(100, 105), D, 1)
    expect(store.passNumbers(TIN, 0).size).toBe(20)
    expect(store.passNumbers(TIN, 1).size).toBe(5)
    expect(store.storedNumbers(TIN).size).toBe(25)
  })

  test('a damaged page reads as empty and the rest is still served', () => {
    write(0, page(0, 10))
    write(1, page(10, 20))
    fs.writeFileSync(path.join(DIR, 'bills', TIN, 'g000-p0001.json.gz'), 'not gzip')
    store.forgetBillsMemory()
    expect(store.queryBills(TIN, {})?.total).toBe(10)
  })

  test('only a 9-digit STIR and sane pass / page numbers reach the disk', () => {
    for (const bad of ['../x', '12345678', '1234567890', '']) {
      expect(store.writeBillsPage(bad, 0, 0, page(0, 1), T, D)).toBe(false)
      expect(store.readBillsMeta(bad)).toBeNull()
    }
    expect(store.writeBillsPage(TIN, 0, -1, page(0, 1), T, D)).toBe(false)
    expect(store.writeBillsPage(TIN, 0, 1.5, page(0, 1), T, D)).toBe(false)
    expect(store.writeBillsPage(TIN, -1, 0, page(0, 1), T, D)).toBe(false)
    expect(store.writeBillsPage(TIN, 1000, 0, page(0, 1), T, D)).toBe(false)
    expect(fs.existsSync(path.join(DIR, 'bills'))).toBe(false)
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
    expect(store.storedBillCases(TIN).get('2-1004-2608/3')?.bills).toHaveLength(2)
  })

  test('recent bills are the newest', () => {
    expect(store.recentBills(TIN, 3).map((r) => r.number.slice(-2))).toEqual(['29', '28', '27'])
  })
})
