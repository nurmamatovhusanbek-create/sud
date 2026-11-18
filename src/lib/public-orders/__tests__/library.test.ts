import { afterAll, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { searchLibrary, type LibraryQuery, type StoredOrder } from '@/core/public-orders'

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
  const none = new Map<string, { size: number; savedAt: number }>()
  const q = (o: Partial<LibraryQuery> = {}): LibraryQuery => ({ q: '', status: 'all', offset: 0, limit: 50, ...o })
  const run = (o: Partial<LibraryQuery> = {}, orderList = orders, onDisk = saved, history = none) => searchLibrary(orderList, onDisk, history, q(o))

  test('a full number finds that case; a fragment finds every case containing it', () => {
    expect(run({ q: '4-1001-2615/40333' }).total).toBe(2)
    expect(run({ q: '2615' }).total).toBe(2)
    expect(run({ q: ' 4-1001 ' }).total).toBe(3)
    expect(run({ q: '999' }).total).toBe(0)
  })
  test('«saved» comes from the PDFs on disk; saved rows first, newest first', () => {
    const r = run()
    expect(r.items.map((o) => [o.id, o.state])).toEqual([['2', 'saved'], ['1', 'saved'], ['3', 'never'], ['4', 'never']])
    expect(r.items[1]).toMatchObject({ size: 115_409, downloaded: true })
  })
  test('a file that was saved once and is gone is «gone», not «never»: it keeps its old size and date', () => {
    const history = new Map([[C, { size: 77_000, savedAt: 150 }], [A, { size: 1, savedAt: 1 }]]) // A is also on disk: the disk wins
    const r = run({}, orders, saved, history)
    expect(r.items.map((o) => [o.id, o.state])).toEqual([['2', 'saved'], ['1', 'saved'], ['3', 'gone'], ['4', 'never']])
    expect(r.items[2]).toMatchObject({ size: 77_000, savedAt: 150, downloaded: false })
    expect(r.counts).toEqual({ all: 4, saved: 2, gone: 1, never: 1, hidden: 0 })
    expect(run({ status: 'gone' }, orders, saved, history).items.map((o) => o.id)).toEqual(['3'])
    expect(r.items[1].size).toBe(115_409) // saved ones show the real file, not the log
  })
  test('status filter, and the counts show how the matches split BEFORE that filter', () => {
    expect(run({ status: 'saved' }).items.map((o) => o.id)).toEqual(['2', '1'])
    expect(run({ status: 'saved' }).counts).toEqual({ all: 4, saved: 2, gone: 0, never: 2, hidden: 0 })
    expect(run({ status: 'never' }).items.map((o) => o.id)).toEqual(['3', '4'])
    expect(run({ status: 'never', q: '2605' }).counts).toEqual({ all: 1, saved: 0, gone: 0, never: 1, hidden: 0 })
  })
  test('court type and instance filters', () => {
    const mixed = [...orders, { ...ord('5', '3-2001-2102/901', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'), courtType: 'ADMINISTRATIVE' as const }]
    expect(run({ courtType: 'ADMINISTRATIVE' }, mixed).items.map((o) => o.id)).toEqual(['5'])
    expect(run({ courtType: 'ECONOMIC' }, mixed).total).toBe(4)
    expect(run({ instance: '2' }, mixed).items.map((o) => o.id)).toEqual(['4'])
  })
  test('pages: a window of the sorted list; total stays the whole match count', () => {
    expect(run({ offset: 0, limit: 3 }).items.map((o) => o.id)).toEqual(['2', '1', '3'])
    expect(run({ offset: 3, limit: 3 }).items.map((o) => o.id)).toEqual(['4'])
    expect(run({ offset: 0, limit: 3 }).total).toBe(4)
    expect(run({ offset: 99, limit: 3 }).items).toEqual([])
  })
  test('words match the court / judge / category, Latin typed against Cyrillic stored; apostrophes are one kind', () => {
    const cy = [{ ...ord('7', '4-1-1/1', 'ffffffff-ffff-4fff-8fff-ffffffffffff'), court: 'Тошкент туманлараро иқтисодий суди', judge: 'Ғуломов Ҳ.', category: 'Қарз' }]
    expect(run({ q: 'toshkent' }, cy).total).toBe(1)
    expect(run({ q: 'Тошкент' }, cy).total).toBe(1)
    expect(run({ q: 'iqtisodiy suddi' }, cy).total).toBe(0)
    expect(run({ q: "g'ulomov" }, cy).total).toBe(1)
    expect(run({ q: 'gʻulomov' }, cy).total).toBe(1)
  })
  test('the pdf id is matched case-insensitively (files are stored lower-case)', () => {
    expect(run({ status: 'saved' }, [ord('9', '1-1/1', A.toUpperCase())]).total).toBe(1)
  })
})

describe('disk side: order index, saved PDFs and the download log', () => {
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

  test('delete a saved PDF → the page says «gone» (not «never») with its old size; opening it again saves it and updates the state', async () => {
    const { writePdf, listPdfs, syncDownloads, readDownloads } = await import('../pdf-store')
    const { allOrders } = await import('../store')
    const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const { appendOrders } = await import('../store')
    await appendOrders([ord('d1', '4-1001-2700/7', D)])
    const view = async () => {
      const onDisk = await listPdfs()
      return searchLibrary(await allOrders(), onDisk, await syncDownloads(onDisk), { q: '4-1001-2700/7', status: 'all', offset: 0, limit: 5 }).items[0]
    }
    expect((await view()).state).toBe('never')

    await writePdf(D, new TextEncoder().encode('%PDF-1.4 first'), { name: 'qaror.pdf', via: 'download' })
    expect(await view()).toMatchObject({ state: 'saved', downloaded: true, size: 14 })
    const rec = (await readDownloads()).get(D)!
    expect(rec).toMatchObject({ size: 14, name: 'qaror.pdf', via: 'download' })

    fs.rmSync(path.join(dir, 'files', `${D}.pdf`)) // the person deletes the file
    const gone = await view()
    expect(gone).toMatchObject({ state: 'gone', downloaded: false, size: 14, pdfId: D }) // the stored order still has the id to download again
    expect(gone.savedAt).toBe(rec.savedAt)

    await writePdf(D, new TextEncoder().encode('%PDF-1.4 second copy'), { via: 'download' }) // the click re-downloads it
    expect(await view()).toMatchObject({ state: 'saved', size: 20 })
  })

  test('a PDF that was on disk before the log existed is noticed (a «seen» line), so deleting it later is recognised', async () => {
    const { listPdfs, syncDownloads, readDownloads } = await import('../pdf-store')
    const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    fs.writeFileSync(path.join(dir, 'files', `${E}.pdf`), '%PDF-1.4 old file')
    const h1 = await syncDownloads(await listPdfs())
    expect(h1.get(E)).toMatchObject({ via: 'seen', size: 17 })
    fs.rmSync(path.join(dir, 'files', `${E}.pdf`))
    expect((await readDownloads()).has(E)).toBe(true) // remembered after the delete
    const lines = fs.readFileSync(path.join(dir, 'downloads.jsonl'), 'utf8').split('\n').filter((l) => l.includes(E))
    expect(lines.length).toBe(1) // seen once, not on every page load
  })

  test('the log ignores garbage lines and ids that are not order ids', async () => {
    const { readDownloads } = await import('../pdf-store')
    fs.appendFileSync(path.join(dir, 'downloads.jsonl'), 'not json\n{"pdfId":"../x","size":1,"savedAt":1}\n{"pdfId":"old-civil-5","size":9,"savedAt":3}\n{"pdfI')
    const m = await readDownloads()
    expect(m.has('../x')).toBe(false)
    expect(m.get('old-civil-5')).toMatchObject({ size: 9, savedAt: 3 })
  })
})

describe('cleared orders («Tozalash»)', () => {
  const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const saved = new Map([[A, { size: 1, savedAt: 200 }]])
  const none = new Map<string, { size: number; savedAt: number }>()
  const run = (o: Partial<LibraryQuery> = {}, hidden = new Set([B, C, A])) =>
    searchLibrary(orders, saved, none, { q: '', status: 'all', offset: 0, limit: 50, hidden, ...o })

  test('they leave the lists and the counts, and only the hidden view and a search still show them', () => {
    const r = run({ status: 'never' })
    expect(r.items.map((i) => i.pdfId)).toEqual([D]) // B and C are cleared; A is downloaded (never hidden), so it is not «never» anyway
    expect(r.counts).toEqual({ all: 2, saved: 1, gone: 0, never: 1, hidden: 2 })
    expect(run({ status: 'hidden' }).items.map((i) => i.pdfId).sort()).toEqual([B, C].sort())
  })
  test('a downloaded order is never hidden, whatever the set says', () => {
    const r = run({ status: 'saved' })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ pdfId: A, hidden: false })
  })
  test('a SEARCH finds a cleared order again, with its metadata, marked hidden, ready for «Yuklab olish»', () => {
    const r = run({ q: '2605' })
    expect(r.items).toHaveLength(1)
    expect(r.items[0]).toMatchObject({ caseNumber: '2-1005-2605/31875', pdfId: C, hidden: true, state: 'never' })
    expect(r.counts.never).toBe(1) // counted while searching: it is listed
  })
  test('ids compare case-insensitively; no set clears nothing', () => {
    expect(run({ status: 'never' }, new Set([B.toUpperCase().toLowerCase()])).counts.hidden).toBe(1)
    expect(run({ status: 'never' }, new Set()).counts).toMatchObject({ never: 3, hidden: 0 })
  })
})

