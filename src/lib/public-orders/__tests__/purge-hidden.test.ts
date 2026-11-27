import { afterAll, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { StoredOrder } from '@/core/public-orders'

mock.module('server-only', () => ({}))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-purgeh-'))
process.env.PUBLIC_ORDERS_DIR = dir
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const order = (caseNumber: string, id: string, pdfId: string): StoredOrder => ({
  id, caseNumber, instance: 'FIRST', result: 'FULFILLED', court: 'C', judge: 'J', category: '', pdfId, pdfName: '', pdfSize: 1, courtType: 'ECONOMIC',
})
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3])

describe('«Tozalangan» › Butunlay oʻchirish', () => {
  test('cleared orders go entirely (record + PDF), the others stay; restoring brings the record back, not the file', async () => {
    const { appendOrders, allOrders } = await import('../store')
    const { writePdf, readPdf } = await import('../pdf-store')
    const { setHidden, readHidden } = await import('../hidden-store')
    const { purgeHiddenOrders } = await import('../purge-hidden')
    const { restorePurged, activePurged } = await import('../purged-store')

    await appendOrders([order('2-1-2601/1', 'a', A), order('2-1-2601/2', 'b', B), order('2-1-2601/3', 'c', C)])
    await writePdf(A, PDF)
    await writePdf(B, PDF)
    await setHidden('hide', [A, B])

    const r = await purgeHiddenOrders()
    expect(r).toEqual({ purged: 2, files: 2 })
    expect((await allOrders()).map((o) => o.pdfId)).toEqual([C]) // A and B left the metadata
    expect(await readPdf(A)).toBeNull()
    expect(await readPdf(B)).toBeNull()
    expect((await readHidden()).size).toBe(0)
    expect([...(await activePurged()).keys()].sort()).toEqual([A, B])

    // a second press has nothing to do
    expect(await purgeHiddenOrders()).toEqual({ purged: 0, files: 0 })

    // the record can be brought back (the file cannot)
    expect(await restorePurged([A])).toBe(1)
    expect((await allOrders()).map((o) => o.pdfId).sort()).toEqual([A, C])
    expect(await readPdf(A)).toBeNull()
  })

  test('the route is privileged: refused without the action header, works with it', async () => {
    const { POST } = await import('@/app/api/public-orders/purge-hidden/route')
    const mk = (h: Record<string, string>) => new Request('http://localhost:3000/api/public-orders/purge-hidden', { method: 'POST', headers: { host: 'localhost:3000', ...h } }) as never
    expect((await POST(mk({}))).status).toBe(403)
    const ok = await POST(mk({ 'x-sud-action': '1' }))
    expect(ok.status).toBe(200)
    expect((await ok.json()).ok).toBe(true)
  })
})
