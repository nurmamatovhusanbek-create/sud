/**
 * The SQLite adapter (lib/db): opens, migrates, wraps transactions, survives a damaged file, and says which driver it uses.
 */
import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'db-'))
const FILE = path.join(DIR, 'sud.db')
process.env.SUD_DB = FILE
const dbm = await import('../db')

beforeEach(() => {
  dbm.closeDb()
  for (const n of fs.readdirSync(DIR)) fs.rmSync(path.join(DIR, n), { force: true })
})
afterAll(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('open and migrate', () => {
  test('creates the file, applies the schema, names the driver (Bun runs the tests)', () => {
    const db = dbm.getDb()
    expect(db.driver).toBe('bun:sqlite')
    expect(fs.existsSync(FILE)).toBe(true)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name)
    expect(tables).toEqual(expect.arrayContaining(['bills', 'bill_loads', 'found_cases', 'tried', 'case_details', 'meta']))
    expect(Number(db.prepare('PRAGMA user_version').get()?.user_version)).toBe(2)
    expect(String(db.prepare('PRAGMA journal_mode').get()?.journal_mode)).toBe('wal')
  })

  test('one connection per process; opening again does not migrate twice', () => {
    expect(dbm.getDb()).toBe(dbm.getDb())
    dbm.getDb().prepare('INSERT INTO meta VALUES (?, ?)').run('k', 'v')
    dbm.closeDb()
    expect(dbm.getDb().prepare('SELECT v FROM meta WHERE k = ?').get('k')?.v).toBe('v') // survived the reopen
  })
})

describe('statements and transactions', () => {
  test('all / get / run, a missing row is undefined, blobs come back as bytes', () => {
    const db = dbm.getDb()
    db.prepare('INSERT INTO case_details VALUES (?, ?, ?, ?)').run('civil', '2-1-2101/1', 5, new Uint8Array([1, 2, 3]))
    expect(db.prepare('SELECT t FROM case_details WHERE court = ? AND num = ?').get('civil', '2-1-2101/1')?.t).toBe(5)
    expect(db.prepare('SELECT t FROM case_details WHERE court = ? AND num = ?').get('civil', 'nope')).toBeUndefined()
    const blob = db.prepare('SELECT d FROM case_details').get()?.d as Uint8Array
    expect([...blob]).toEqual([1, 2, 3])
    expect(db.prepare('DELETE FROM case_details').run().changes).toBe(1)
  })

  test('a transaction commits as one, rolls back on an error, and nested calls join the outer one', () => {
    const db = dbm.getDb()
    const count = () => Number(db.prepare("SELECT COUNT(*) c FROM meta WHERE k IN ('a', 'b', 'c', 'd')").get()?.c)
    db.transaction(() => {
      db.prepare('INSERT INTO meta VALUES (?, ?)').run('a', '1')
      db.transaction(() => db.prepare('INSERT INTO meta VALUES (?, ?)').run('b', '2'))
    })
    expect(count()).toBe(2)
    expect(() =>
      db.transaction(() => {
        db.prepare('INSERT INTO meta VALUES (?, ?)').run('c', '3')
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(count()).toBe(2) // nothing of the failed one stayed
    db.transaction(() => db.prepare('INSERT INTO meta VALUES (?, ?)').run('d', '4')) // and the connection is usable afterwards
    expect(count()).toBe(3)
  })
})

describe('a damaged file', () => {
  test('is set aside and a fresh database is made; the reason is kept for Settings', () => {
    fs.writeFileSync(FILE, Buffer.from('this is not a sqlite file at all, just text'.repeat(200)))
    const db = dbm.getDb()
    expect(Number(db.prepare('SELECT COUNT(*) c FROM bills').get()?.c)).toBe(0)
    expect(fs.readdirSync(DIR).some((n) => n.startsWith('sud.db.corrupt-'))).toBe(true)
    expect(dbm.lastRecovery()).toContain('shikastlangan')
  })

  test('a healthy file is not touched and reports no recovery', () => {
    dbm.getDb()
    dbm.closeDb()
    dbm.getDb()
    expect(dbm.lastRecovery()).toBeNull()
    expect(fs.readdirSync(DIR).some((n) => n.includes('corrupt'))).toBe(false)
  })
})

describe('backup', () => {
  test('VACUUM INTO writes a consistent, openable copy while the app keeps its connection', () => {
    const db = dbm.getDb()
    db.prepare('INSERT INTO meta VALUES (?, ?)').run('x', 'y')
    const copy = path.join(DIR, 'copy.db')
    dbm.backupTo(copy)
    expect(fs.statSync(copy).size).toBeGreaterThan(0)
    const { Database } = createRequire(import.meta.url)('bun:sqlite') as { Database: new (p: string) => { prepare: (s: string) => { get: (k: string) => { v: string } }; close: () => void } }
    const c = new Database(copy)
    expect(c.prepare('SELECT v FROM meta WHERE k = ?').get('x').v).toBe('y')
    c.close()
    db.prepare('INSERT INTO meta VALUES (?, ?)').run('z', 'w') // the live connection still works
  })
})
