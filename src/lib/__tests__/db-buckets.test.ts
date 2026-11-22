/**
 * The database cut into buckets for the backup (lib/db-buckets): stable names, deterministic bytes (an unchanged bucket has identical bytes),
 * a change touches only its own bucket, and importing every bucket into an empty database reproduces the data.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'buckets-'))
process.env.SUD_DB = path.join(DIR, 'sud.db')
const dbm = await import('../db')
const bk = await import('../db-buckets')

const A = '207324986'
const B = '201052713'
const ms = (iso: string) => Date.parse(iso)

function seed() {
  const db = dbm.getDb()
  const bill = db.prepare('INSERT INTO bills (tin, number, pass, status, issued, amount, case_number, ctype, kind, yymm, hay, cat, court) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  bill.run(A, '1001', 0, 'PAID', ms('2024-03-01'), 100, '2-1004-2403/1', 'civil', 'duty', 2403, 'c d', 'x', 'c')
  bill.run(A, '1002', 0, 'USED', ms('2024-11-01'), 100, '2-1004-2411/2', 'civil', 'post', 2411, 'c d', 'x', 'c')
  bill.run(A, '1003', 0, 'PAID', ms('2025-02-01'), 100, null, null, 'duty', -1, 'c d', 'x', 'c')
  bill.run(A, '1004', 0, 'PAID', null, 100, null, null, 'duty', -1, 'c d', 'x', 'c')
  bill.run(B, '2001', 0, 'PAID', ms('2025-05-05'), 50, null, null, 'duty', -1, 'c d', 'x', 'c')
  db.prepare('INSERT INTO found_cases (court, tin, num, yymm, status, hay, row, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('civil', A, '2-1004-2403/1', 2403, 's', 'h', '{"n":1}', 10)
  db.prepare('INSERT INTO found_cases (court, tin, num, yymm, status, hay, row, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('civil', A, '2-1004-2509/7', 2509, 's', 'h', '{"n":2}', 11)
  db.prepare('INSERT INTO tried (tin, num, t, found) VALUES (?, ?, ?, ?)').run(A, '2-1004-2403/1', 10, 1)
  db.prepare('INSERT INTO case_details (court, num, t, d) VALUES (?, ?, ?, ?)').run('civil', '2-1004-2403/1', 10, new Uint8Array([1, 2, 3, 250]))
  db.prepare('INSERT INTO case_details (court, num, t, d) VALUES (?, ?, ?, ?)').run('economic', 'odd number', 12, new Uint8Array([9]))
  db.prepare('INSERT INTO bill_loads (tin, total_elements, total_pages, page_size, pass, pages_done, complete, stable, loaded_at) VALUES (?, 4, 1, 10000, 2, 1, 1, 1, 555)').run(A)
  db.prepare('INSERT INTO companies (tin, first_at, refreshed_at, last_added) VALUES (?, 100, 555, 4)').run(A)
}

const all = (db: ReturnType<typeof dbm.getDb>) => Object.fromEntries(bk.listBuckets(db).map((n) => [n, bk.renderBucket(n, db)!.text.toString('utf8')]))

beforeEach(() => {
  dbm.closeDb()
  for (const n of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, n), { force: true, recursive: true })
})
afterAll(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('buckets', () => {
  test('named by company and year, undated ones in year 0', () => {
    seed()
    expect(bk.listBuckets()).toEqual([
      `index:${B}`, `bills:${B}:2025`, `state:${A}`, `tried:${A}`, `index:${A}`, `bills:${A}:0`, `bills:${A}:2024`, `bills:${A}:2025`, `found:${A}:civil:24`, `found:${A}:civil:25`,
      'details:civil:24', 'details:economic:0',
    ])
  })

  test('the same data gives the same bytes; the bills pass counter is not part of them', () => {
    seed()
    const before = all(dbm.getDb())
    dbm.getDb().prepare('UPDATE bills SET pass = 7').run()
    expect(all(dbm.getDb())).toEqual(before)
  })

  test('a change touches only its own bucket', () => {
    seed()
    const before = all(dbm.getDb())
    dbm.getDb().prepare("UPDATE bills SET status = 'USED' WHERE number = '1003'").run()
    const after = all(dbm.getDb())
    const changed = Object.keys(after).filter((k) => after[k] !== before[k])
    expect(changed).toEqual([`bills:${A}:2025`])
  })

  test('every bucket imported into an empty database reproduces the data', () => {
    seed()
    const src = dbm.getDb()
    const target = dbm.openDbFile(path.join(DIR, 'copy.db'))
    for (const name of bk.listBuckets(src)) bk.importBucket(name, bk.renderBucket(name, src)!.text, target)
    expect(all(target)).toEqual(all(src))
    // the binary detail survived, and the dates came with the company
    expect([...(target.prepare("SELECT d FROM case_details WHERE num = '2-1004-2403/1'").get()!.d as Uint8Array)]).toEqual([1, 2, 3, 250])
    expect(target.prepare('SELECT first_at, refreshed_at FROM companies').get()).toMatchObject({ first_at: 100, refreshed_at: 555 })
    target.close()
  })

  test('importing an older copy of a case does not overwrite a newer one', () => {
    seed()
    const text = bk.renderBucket(`found:${A}:civil:24`)!.text
    dbm.getDb().prepare("UPDATE found_cases SET row = '{\"n\":99}', t = 99 WHERE num = '2-1004-2403/1'").run()
    bk.importBucket(`found:${A}:civil:24`, text)
    expect(dbm.getDb().prepare("SELECT row FROM found_cases WHERE num = '2-1004-2403/1'").get()?.row).toBe('{"n":99}')
  })

  test('the locator lists every case number (court, year) and every bill (year, its case), and is never imported', () => {
    seed()
    const text = bk.renderBucket(`index:${A}`)!.text.toString('utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(text).toEqual([
      ['c', '2-1004-2403/1', 'civil', 24], // found case: its own court and year
      ['c', '2-1004-2411/2', 'civil', 24], // only a bill names it
      ['c', '2-1004-2509/7', 'civil', 25],
      ['b', '1001', 2024, '2-1004-2403/1'],
      ['b', '1002', 2024, '2-1004-2411/2'],
      ['b', '1003', 2025, ''],
      ['b', '1004', 0, ''],
    ])
    const target = dbm.openDbFile(path.join(DIR, 'idx.db'))
    expect(bk.importBucket(`index:${A}`, bk.renderBucket(`index:${A}`)!.text, target)).toBe(0)
    target.close()
  })

  test('an unknown name is refused', () => {
    expect(() => bk.importBucket('nonsense:1', Buffer.from('[]\n'))).toThrow()
    expect(bk.renderBucket('nonsense:1')).toBeNull()
  })
})
