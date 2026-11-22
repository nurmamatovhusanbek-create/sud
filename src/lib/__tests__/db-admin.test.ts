/**
 * Settings › Maʼlumotlar bazasi: status, the downloadable snapshot, compacting, forgetting one company.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'db-admin-'))
process.env.SUD_DB = path.join(DIR, 'sud.db')
const dbm = await import('../db')
const admin = await import('../db-admin')

const A = '207324986'
const B = '201052713'

function seed() {
  const db = dbm.getDb()
  const bill = db.prepare('INSERT INTO bills (tin, number, pass, status, case_number, hay) VALUES (?, ?, 1, ?, ?, ?)')
  for (let i = 0; i < 5; i++) bill.run(A, `b${i}`, 'PAID', `1-${i}`, 'x')
  bill.run(B, 'c1', 'PAID', null, 'x')
  db.prepare('INSERT INTO found_cases (court, tin, num, yymm, row, t) VALUES (?, ?, ?, ?, ?, ?)').run('civil', A, '1-0', 2401, '{}', 1)
  db.prepare('INSERT INTO tried (tin, num, t, found) VALUES (?, ?, ?, ?)').run(A, '1-0', 1, 1)
  db.prepare('INSERT INTO case_details (court, num, t, d) VALUES (?, ?, ?, ?)').run('civil', '1-0', 1, new Uint8Array([1, 2, 3]))
}

beforeEach(() => {
  dbm.closeDb()
  for (const n of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, n), { force: true })
})
afterAll(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('db-admin', () => {
  test('status counts tables, courts and companies', () => {
    seed()
    const s = admin.dbStatus()
    expect(s.tables).toEqual({ bills: 6, foundCases: 1, tried: 1, details: 1 })
    expect(s.byCourt.civil).toEqual({ found: 1, details: 1 })
    expect(s.companies[0]).toMatchObject({ tin: A, bills: 5, found: 1, tried: 1 })
    expect(s.bytes).toBeGreaterThan(0)
    expect(s.driver).toBe('bun:sqlite')
  })

  test('the snapshot is a complete, separate database file; done() removes it', () => {
    seed()
    const snap = admin.snapshotFile()
    expect(snap.name).toMatch(/^sud-\d{8}\.db$/)
    expect(fs.existsSync(snap.file)).toBe(true)
    const { Database } = createRequire(import.meta.url)('bun:sqlite')
    const copy = new Database(snap.file, { readonly: true })
    expect((copy.query('SELECT COUNT(*) c FROM bills').get() as { c: number }).c).toBe(6)
    copy.close()
    snap.done()
    expect(fs.existsSync(snap.file)).toBe(false)
  })

  test('compact reports sizes and keeps the data', () => {
    seed()
    const r = admin.compactDb()
    expect(r.after).toBeGreaterThan(0)
    expect(admin.dbStatus().tables.bills).toBe(6)
  })

  test('forget removes one company and nothing else; case details stay', () => {
    seed()
    expect(admin.forgetCompany(A)).toEqual({ bills: 5, found: 1, tried: 1 })
    const s = admin.dbStatus()
    expect(s.tables).toEqual({ bills: 1, foundCases: 0, tried: 0, details: 1 })
    expect(() => admin.forgetCompany('12')).toThrow()
  })
})
