import { afterAll, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { searchLibrary, type StoredOrder } from '@/core/public-orders'

mock.module('server-only', () => ({}))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-lib-'))
process.env.PUBLIC_ORDERS_DIR = dir
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const ord = (id: string, caseNumber: string, pdfId: string, instance = '1'): StoredOrder => ({
  id, caseNumber, instance, result: 'SATISFIED', court: 'Sud', judge: 'J', category: '', pdfId, pdfName: 'q.pdf', pdfSize: 1, courtType: 'ECONOMIC',
})
const orders = [ord('1', '4-1001-2615/40333', A), ord('2', '4-1001-2529/43957', B), ord('3', '2-1005-2605/31875', C), ord('4', '4-1001-2615/40333', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '2')]

describe('searchLibrary', () => {
  const saved = new Map([[A, { size: 115_409, savedAt: 200 }], [B, { size: 5_000, savedAt: 300 }]])

  test('a full number finds that case; a fragment finds every case containing it', () => {
    expect(searchLibrary(orders, saved, { q: '4-1001-2615/40333', savedOnly: false, limit: 50 }).total).toBe(2)
    expect(searchLibrary(orders, saved, { q: '2615', savedOnly: false, limit: 50 }).total).toBe(2)
    expect(searchLibrary(orders, saved, { q: ' 4-1001 ', savedOnly: false, limit: 50 }).total).toBe(3)
    expect(searchLibrary(orders, saved, { q: '999', savedOnly: false, limit: 50 }).total).toBe(0)
  })
  test('«downloaded» comes from the PDFs on disk; downloaded rows first, newest first', () => {
    const r = searchLibrary(orders, saved, { q: '', savedOnly: false, limit: 50 })
    expect(r.items.map((o) => [o.id, o.downloaded])).toEqual([['2', true], ['1', true], ['3', false], ['4', false]])
    expect(r.items[1].size).toBe(115_409)
  })
  test('«only downloaded» hides the rest; limit caps items but not total', () => {
    expect(searchLibrary(orders, saved, { q: '', savedOnly: true, limit: 50 }).items.map((o) => o.id)).toEqual(['2', '1'])
    const r = searchLibrary(orders, saved, { q: '', savedOnly: false, limit: 2 })
    expect(r.items.length).toBe(2)
    expect(r.total).toBe(4)
  })
  test('the pdf id is matched case-insensitively (files are stored lower-case)', () => {
    const up = [ord('9', '1-1/1', A.toUpperCase())]
    expect(searchLibrary(up, saved, { q: '', savedOnly: true, limit: 5 }).total).toBe(1)
  })
})

describe('disk side: allOrders + listPdfs', () => {
  test('lists real PDFs only (not temp files or strangers) and the order index with the last copy of each id', async () => {
    const { appendOrders, allOrders } = await import('../store')
    const { writePdf, listPdfs } = await import('../pdf-store')
    await appendOrders([ord('1', '4-1001-2615/40333', A)])
    await appendOrders([{ ...ord('1', '4-1001-2615/40333', A), judge: 'NEW' }, ord('2', '2-1-1/1', B)])
    expect((await allOrders()).find((o) => o.id === '1')?.judge).toBe('NEW')
    expect((await allOrders()).length).toBe(2)

    expect((await listPdfs()).size).toBe(0) // no files folder yet
    await writePdf(A, new TextEncoder().encode('%PDF-1.4 x'))
    fs.writeFileSync(path.join(dir, 'files', `${B}.pdf.123.tmp`), 'half')
    fs.writeFileSync(path.join(dir, 'files', 'notes.pdf'), '%PDF-1.4 stray')
    const l = await listPdfs()
    expect([...l.keys()]).toEqual([A])
    expect(l.get(A)!.size).toBe(10)

    // a shard that grew is noticed (the memo is keyed on name + size + mtime)
    await appendOrders([ord('3', '3-3-3/3', C)])
    expect((await allOrders()).length).toBe(3)
  })
})
