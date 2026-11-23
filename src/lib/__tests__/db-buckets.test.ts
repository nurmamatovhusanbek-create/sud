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
process.env.CASE_STORE_DIR = path.join(DIR, 'cases') // the lists are files: never read the real ones
const dbm = await import('../db')
const bk = await import('../db-buckets')
const cs = await import('../case-store')

const A = '207324986'
const B = '201052713'
const ms = (iso: string) => Date.parse(iso)

function seed() {
  const db = dbm.getDb()
  const bill = db.prepare('INSERT INTO bills (tin, number, pass, status, issued, amount, case_number, ctype, kind, yymm, hay, cat, court) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  bill.run(A, '1001', 0, 'PAID', ms('2024-03-01'), 100, '2-1004-2403/1', 'civil', 'duty', 2403, 'c d', 'x', 'c')
  bill.run(A, '1002', 0, 'USED', ms('2024-11-01'), 100, '2-1004-2411/2', 'civil', 'post', 2411, 'c d', 'x', 'c')
  bill.run(A, '1003', 0, 'PAID', ms('2025-02-01'), 100, '2-1004-2502/3', 'civil', 'duty', 2502, 'c d', 'x', 'c')
  bill.run(A, '1004', 0, 'PAID', null, 100, null, null, 'duty', -1, 'c d', 'x', 'c')
  bill.run(B, '2001', 0, 'PAID', ms('2025-05-05'), 50, '2-1004-2505/9', 'civil', 'duty', 2505, 'c d', 'x', 'c')
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
  cs.forgetCaseStoreMemory()
})
afterAll(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('buckets', () => {
  test('named by company and year, undated ones in year 0', () => {
    seed()
    expect(bk.listBuckets()).toEqual([
      `index:${B}`, `bills:${B}:2025`, `state:${A}`, `tried:${A}`, `index:${A}`, `bills:${A}:2024`, `bills:${A}:2025`, `found:${A}:civil:24`, `found:${A}:civil:25`,
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
      ['c', '2-1004-2502/3', 'civil', 25], // only a bill names it
      ['c', '2-1004-2509/7', 'civil', 25],
      ['b', '1001', 2024, '2-1004-2403/1'],
      ['b', '1002', 2024, '2-1004-2411/2'],
      ['b', '1003', 2025, '2-1004-2502/3'],
      // bill 1004 names no case: it is not in the locator (nor kept at all)
    ])
    const target = dbm.openDbFile(path.join(DIR, 'idx.db'))
    expect(bk.importBucket(`index:${A}`, bk.renderBucket(`index:${A}`)!.text, target)).toBe(0)
    target.close()
  })

  test('merging two copies of a bucket: every row of either, the newer one where both have it, in key order', () => {
    const t = (rows: unknown[][]) => Buffer.from(rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    const lines = (b: Buffer) => b.toString('utf8').trim().split('\n').map((l) => JSON.parse(l))
    // found cases: [court, tin, num, yymm, status, hay, row, t]
    const base = t([['civil', A, '2-1004-2403/1', 2403, 'old', '', '{}', 10], ['civil', A, '2-1004-2403/9', 2403, 'only-remote', '', '{}', 5]])
    const local = t([['civil', A, '2-1004-2403/1', 2403, 'new', '', '{}', 20], ['civil', A, '2-1004-2403/5', 2403, 'only-local', '', '{}', 7]])
    const m = lines(bk.mergeBucketText(`found:${A}:civil:24`, base, local))
    expect(m.map((r) => [r[2], r[4]])).toEqual([['2-1004-2403/1', 'new'], ['2-1004-2403/5', 'only-local'], ['2-1004-2403/9', 'only-remote']])
    // the same row, the REMOTE one is newer: it stays
    const m2 = lines(bk.mergeBucketText(`found:${A}:civil:24`, t([['civil', A, '2-1004-2403/1', 2403, 'remote-newer', '', '{}', 99]]), local))
    expect(m2.find((r) => r[2] === '2-1004-2403/1')?.[4]).toBe('remote-newer')
    // bills have no time: the local copy wins, rows only the channel has are kept
    // a bill row: [tin, number, status, …, case_number at index 14]
    const br = (number: string, status: string, caseNumber: string | null) => { const r: unknown[] = new Array(15).fill(null); r[0] = A; r[1] = number; r[2] = status; r[14] = caseNumber; return r }
    const b = lines(bk.mergeBucketText(`bills:${A}:2024`, t([br('1001', 'OLD', '2-1-2401/1'), br('1002', 'KEEP', '2-1-2401/2'), br('1005', 'NOCASE', null)]), t([br('1001', 'NEW', '2-1-2401/1'), br('1000', 'ADD', '2-1-2401/0')])))
    // the local copy wins; rows only the channel has are kept; a bill that names no case is dropped (an older backup holds many)
    expect(b.map((r) => [r[1], r[2]])).toEqual([['1000', 'ADD'], ['1001', 'NEW'], ['1002', 'KEEP']])
    // a copy that adds nothing merges to exactly the other one (so its id matches and nothing is uploaded)
    expect(bk.mergeBucketText(`bills:${A}:2024`, t([br('1001', 'A', '2-1-2401/1'), br('1002', 'B', '2-1-2401/2')]), t([br('1001', 'A', '2-1-2401/1')])).equals(t([br('1001', 'A', '2-1-2401/1'), br('1002', 'B', '2-1-2401/2')]))).toBe(true)
    // the locator: cases first, then bills, each by key
    const ix = lines(bk.mergeBucketText(`index:${A}`, t([['c', '2-1-2401/9', 'civil', 24], ['b', '2002', 2024, '2-1-2401/9'], ['b', '3003', 2024, '']]), t([['c', '2-1-2401/1', 'civil', 24], ['b', '1001', 2024, '2-1-2401/1']])))
    expect(ix.map((r) => r[1])).toEqual(['2-1-2401/1', '2-1-2401/9', '1001', '2002']) // the bill that names no case (3003) is dropped
  })

  test('the court lists (files) are a bucket of their own and their cases are in the locator', () => {
    seed()
    cs.writeFeed(A, 'civil|jadvalapi/CIVIL/findByTin', { t: 100, complete: true, items: [{ caseNumber: '2-1004-2601/77', status: 'Иш юритувда', plaintiff: 'P', defendant: 'D' } as never] })
    cs.writeFeed(A, 'economic|jadvalapi/ECONOMIC/findByTin', { t: 100, complete: true, items: [{ caseNumber: '4-1001-2602/5', status: 'x' } as never] })
    expect(bk.listBuckets()).toContain(`lists:${A}`)
    const lists = bk.renderBucket(`lists:${A}`)!.text.toString('utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lists.map((r) => [r[0], r[1]])).toEqual([['civil', '2-1004-2601/77'], ['economic', '4-1001-2602/5']])
    expect(JSON.parse(lists[0][2]).plaintiff).toBe('P')
    const index = bk.renderBucket(`index:${A}`)!.text.toString('utf8')
    expect(index).toContain('["c","2-1004-2601/77","civil",26]')
    expect(index).toContain('["c","4-1001-2602/5","economic",26]')
    // never imported into a database
    const target = dbm.openDbFile(path.join(DIR, 'lists.db'))
    expect(bk.importBucket(`lists:${A}`, bk.renderBucket(`lists:${A}`)!.text, target)).toBe(0)
    target.close()
    cs.forgetCaseStoreMemory()
  })

  test('an unknown name is refused', () => {
    expect(() => bk.importBucket('nonsense:1', Buffer.from('[]\n'))).toThrow()
    expect(bk.renderBucket('nonsense:1')).toBeNull()
  })
})

describe('hearings bucket', () => {
  const row = (date: string, time = '10:00') => JSON.stringify({ hearingDate: date, hearingTime: time, hearingStage: 'first', caseStatus: 'Кўриб чиқиш жараёнида', plaintiff: 'P', defendant: 'D' })
  const put = (num: string, r: string, t: number) => dbm.getDb().prepare('INSERT INTO found_cases (court, tin, num, yymm, status, hay, row, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('civil', A, num, 2509, 's', 'h', r, t)

  test('holds the upcoming hearings only, one row per case, sorted by date and time; a case with no date or a past date is not in it', () => {
    put('2-1004-2509/1', row('20.12.2090', '11:00'), 5)
    put('2-1004-2509/2', row('05.01.2090', '09:30'), 6)
    put('2-1004-2509/3', row('01.01.2001'), 7)
    put('2-1004-2509/4', '{"hearingDate":"-"}', 8)
    put('2-1004-2509/5', '{"n":5}', 9)
    expect(bk.listBuckets()).toContain(`hearings:${A}`)
    const lines = bk.renderBucket(`hearings:${A}`)!.text.toString('utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => [l[0], l[2], l[3]])).toEqual([['2-1004-2509/2', 20900105, '09:30'], ['2-1004-2509/1', 20901220, '11:00']])
    expect(lines[0].slice(4)).toEqual(['first', 'Кўриб чиқиш жараёнида', 'P', 'D', 6]) // the row's own fetch time, so unchanged rows keep their bytes
    expect(bk.renderBucket(`hearings:${A}`)!.text.equals(bk.renderBucket(`hearings:${A}`)!.text)).toBe(true)
  })

  test('a company with no upcoming hearing has no such bucket; the bucket is never imported', () => {
    put('2-1004-2509/3', row('01.01.2001'), 7)
    expect(bk.listBuckets()).not.toContain(`hearings:${A}`)
    expect(bk.importBucket(`hearings:${A}`, Buffer.from('["x","civil",20900101,"","","","","",1]\n'))).toBe(0)
  })

  test('merging two copies keeps the newer row of a case (a postponed hearing) and drops what has passed', () => {
    const base = Buffer.from(['["2-1004-2509/1","civil",20900105,"09:00","first","s","P","D",5]', '["2-1004-2509/2","civil",20010101,"09:00","first","s","P","D",5]'].join('\n') + '\n')
    const local = Buffer.from('["2-1004-2509/1","civil",20900220,"14:00","first","s","P","D",9]\n')
    const merged = bk.mergeBucketText(`hearings:${A}`, base, local).toString('utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(merged).toEqual([['2-1004-2509/1', 'civil', 20900220, '14:00', 'first', 's', 'P', 'D', 9]])
  })

  test('the court lists (files) add their hearings too, when no found row has the case', () => {
    cs.writeFeed(A, 'civil|x', { t: 3, complete: true, items: [{ caseNumber: '2-1004-2601/77', caseType: '', caseStatus: 'Тайинлаш', result: '', courtName: '', dateFiled: '', plaintiff: 'P', defendant: '', claimAmount: '', hearingDate: '03.03.2090', hearingTime: '10:00', judge: '' }] })
    const lines = bk.renderBucket(`hearings:${A}`)!.text.toString('utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.map((l) => l[0])).toEqual(['2-1004-2601/77'])
  })
})
