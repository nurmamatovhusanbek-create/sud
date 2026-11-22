/**
 * The one-time import of the files the app used before sud.db (lib/db-import): everything is copied in, nothing is changed or deleted, it runs
 * once, a broken file is skipped without stopping the rest, and rows already in the database win.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'db-import-'))
const LEGACY = path.join(ROOT, 'cases')
process.env.CASE_STORE_DIR = LEGACY
process.env.SUD_DB = path.join(ROOT, 'sud.db')
const dbm = await import('../db')

const TIN = '207324986'
const gz = (v: unknown) => zlib.gzipSync(JSON.stringify(v))
const put = (rel: string, v: unknown) => {
  const f = path.join(LEGACY, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, v instanceof Buffer ? v : gz(v))
}
const row = (n: string) => ({ caseNumber: n, caseType: 'Qarz', caseStatus: 'Якунланган', result: '', courtName: 'Sud', dateFiled: '', plaintiff: 'A', defendant: 'B', claimAmount: '1', hearingDate: '', hearingTime: '', judge: '' })
const bill = (i: number, caseNumber: string | null = `2-1004-2603/${i}`) => ({
  number: String(400000000000 + i), status: 'USED', issued: 1_700_000_000_000 + i, amount: 100, paid: 100, mustPay: 0, balance: 0, overdue: null, cat: 'Давлат божи', catId: 1,
  court: 'Uchtepa', courtId: 1, courtType: 'CITIZEN', caseNumber, decision: null, desc: 'x', payer: 'BANK', payerTin: TIN, inFavor: true, account: 'a',
})
const detail = { general: { caseNumber: '2-1004-2603/1', caseStatus: 'Якунланган' }, firstInstance: null, appellate: null, cassation: null, inspection: null }

function snapshotTree(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) walk(f); else out.push(`${path.relative(dir, f)}:${fs.statSync(f).size}`) } }
  walk(dir)
  return out.sort()
}

beforeEach(() => {
  dbm.closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
  fs.mkdirSync(LEGACY, { recursive: true })
})
afterAll(() => {
  dbm.closeDb()
  fs.rmSync(ROOT, { recursive: true, force: true })
})

const count = (t: string) => Number(dbm.getDb().prepare(`SELECT COUNT(*) n FROM ${t}`).get()?.n)

describe('importLegacy', () => {
  test('found cases, tried numbers, bills (both file layouts), loads and details all arrive', () => {
    put(`${TIN}.found.json.gz`, { v: 1, tin: TIN, courts: { civil: [row('2-1004-2603/1'), row('2-1004-2401/2')], economic: [row('4-1001-2505/3')] }, tried: { '2-1004-2603/1': { t: 5, found: true }, '2-1004-2101/9': { t: 6, found: false } } })
    put(`bills/${TIN}/g000-p0000.json.gz`, [bill(1), bill(2), bill(3, null)])
    put(`bills/${TIN}/g001-p0000.json.gz`, [bill(2), bill(4)]) // a later pass repeats a bill
    put(`bills/${TIN}/p0000.json.gz`, [bill(9)]) // the very first layout (no pass in the name)
    put(`bills/${TIN}/meta.json`, Buffer.from(JSON.stringify({ v: 1, tin: TIN, totalElements: 9, totalPages: 1, pageSize: 10000, pass: 1, pagesDone: 1, complete: true, stable: false, loadedAt: 77 })))
    put('details/civil/2-1004-2603@1.json.gz', { v: 1, t: 123, data: detail })

    const db = dbm.getDb()
    expect(count('found_cases')).toBe(3)
    expect(count('tried')).toBe(2)
    expect(count('bills')).toBe(5) // 1,2,3,4,9: a bill is one row whichever pass returned it
    expect(db.prepare('SELECT ctype, kind, yymm FROM bills WHERE number = ?').get('400000000001')).toEqual({ ctype: 'civil', kind: 'davlat_boji', yymm: 2603 })
    expect(db.prepare('SELECT complete, stable, pass, loaded_at FROM bill_loads WHERE tin = ?').get(TIN)).toEqual({ complete: 1, stable: 0, pass: 1, loaded_at: 77 })
    expect(count('case_details')).toBe(1)
    const d = db.prepare('SELECT t, d FROM case_details').get()!
    expect(d.t).toBe(123)
    expect(JSON.parse(zlib.gunzipSync(Buffer.from(d.d as Uint8Array)).toString()).general.caseStatus).toBe('Якунланган')
    expect(db.prepare("SELECT v FROM meta WHERE k = 'legacy_import'").get()).toBeDefined()
  })

  test('the old files are not changed, moved or deleted', () => {
    put(`${TIN}.found.json.gz`, { v: 1, tin: TIN, courts: { civil: [row('2-1004-2603/1')] }, tried: {} })
    put(`bills/${TIN}/g000-p0000.json.gz`, [bill(1)])
    put('details/civil/2-1004-2603@1.json.gz', { v: 1, t: 1, data: detail })
    put(`${TIN}.json.gz`, { v: 1, tin: TIN, feeds: {} }) // a TIN list feed: stays a file, is not imported
    const before = snapshotTree(LEGACY)
    dbm.getDb()
    expect(snapshotTree(LEGACY)).toEqual(before)
  })

  test('runs once: a second open does not import again, and what the app wrote since stays', () => {
    put(`${TIN}.found.json.gz`, { v: 1, tin: TIN, courts: { civil: [row('2-1004-2603/1')] }, tried: {} })
    const db = dbm.getDb()
    db.prepare("UPDATE found_cases SET status = 'changed in the database'").run()
    put(`${TIN}.found.json.gz`, { v: 1, tin: TIN, courts: { civil: [row('2-1004-2603/1'), row('2-1004-2603/77')] }, tried: {} }) // the old file grew later
    dbm.closeDb()
    expect(count('found_cases')).toBe(1) // not imported again
    expect(dbm.getDb().prepare('SELECT status FROM found_cases').get()?.status).toBe('changed in the database')
  })

  test('a row already in the database wins over an imported one', () => {
    // the database is created and written to BEFORE the old file appears (imported at the next open only if no marker: so create the marker-less state by hand)
    const db = dbm.getDb()
    db.prepare("DELETE FROM meta WHERE k = 'legacy_import'").run()
    db.prepare('INSERT INTO found_cases (court, tin, num, yymm, status, hay, row, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('civil', TIN, '2-1004-2603/1', 2603, 'live', 'x', '{}', 1)
    put(`${TIN}.found.json.gz`, { v: 1, tin: TIN, courts: { civil: [row('2-1004-2603/1'), row('2-1004-2603/2')] }, tried: {} })
    dbm.closeDb()
    const db2 = dbm.getDb()
    expect(count('found_cases')).toBe(2)
    expect(db2.prepare('SELECT status FROM found_cases WHERE num = ?').get('2-1004-2603/1')?.status).toBe('live')
  })

  test('a damaged or foreign file is skipped, the rest is imported, and nothing throws', () => {
    put(`${TIN}.found.json.gz`, { v: 1, tin: TIN, courts: { civil: [row('2-1004-2603/1')] }, tried: {} })
    put('201052713.found.json.gz', Buffer.from('not gzip'))
    put(`bills/${TIN}/g000-p0000.json.gz`, Buffer.from('not gzip'))
    put(`bills/../evil.json.gz`, { x: 1 })
    put('details/civil/../x.json.gz', { v: 1, t: 1, data: detail })
    put('details/civil/not-a-number.json.gz', { v: 1, t: 1, data: detail })
    put('details/hacker/2-1004-2603@1.json.gz', { v: 1, t: 1, data: detail })
    dbm.getDb()
    expect(count('found_cases')).toBe(1)
    expect(count('bills')).toBe(0)
    expect(count('case_details')).toBe(0)
  })

  test('with no old files nothing is imported and the marker is still set', () => {
    fs.rmSync(LEGACY, { recursive: true, force: true })
    const db = dbm.getDb()
    expect(count('bills') + count('found_cases') + count('case_details')).toBe(0)
    expect(db.prepare("SELECT v FROM meta WHERE k = 'legacy_import'").get()).toBeDefined()
  })
})
