/**
 * What Settings › Maʼlumotlar bazasi shows and does with `sud.db`: its size and contents, a consistent copy to download, compacting, and
 * forgetting one company's data. Server-only. Nothing here runs by itself.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { backupTo, getDb, lastRecovery } from './db'

export interface DbCompany {
  tin: string
  bills: number
  found: number
  tried: number
  /** the bills load finished (`bill_loads.complete`) */
  loaded: boolean
}

export interface DbStatus {
  path: string
  driver: string
  /** the database file and its write-ahead log, bytes */
  bytes: number
  schemaVersion: number
  tables: { bills: number; foundCases: number; tried: number; details: number }
  /** found cases and stored details per court type */
  byCourt: Record<string, { found: number; details: number }>
  companies: DbCompany[]
  /** what the last open did to a damaged file, null when it was fine */
  recovery: string | null
  /** the one-time import of the old files: when and how much, null when it has not run */
  legacyImport: { at: number; bills: number; found: number; tried: number; details: number } | null
}

const n = (v: unknown): number => Number(v ?? 0)

export function dbStatus(): DbStatus {
  const db = getDb()
  const count = (t: string) => n(db.prepare(`SELECT COUNT(*) c FROM ${t}`).get()?.c)
  const byCourt: DbStatus['byCourt'] = {}
  for (const r of db.prepare('SELECT court, COUNT(*) c FROM found_cases GROUP BY court').all()) (byCourt[String(r.court)] ??= { found: 0, details: 0 }).found = n(r.c)
  for (const r of db.prepare('SELECT court, COUNT(*) c FROM case_details GROUP BY court').all()) (byCourt[String(r.court)] ??= { found: 0, details: 0 }).details = n(r.c)
  const companies = new Map<string, DbCompany>()
  const co = (tin: string) => companies.get(tin) ?? companies.set(tin, { tin, bills: 0, found: 0, tried: 0, loaded: false }).get(tin)!
  for (const r of db.prepare('SELECT tin, COUNT(*) c FROM bills GROUP BY tin').all()) co(String(r.tin)).bills = n(r.c)
  for (const r of db.prepare('SELECT tin, COUNT(*) c FROM found_cases GROUP BY tin').all()) co(String(r.tin)).found = n(r.c)
  for (const r of db.prepare('SELECT tin, COUNT(*) c FROM tried GROUP BY tin').all()) co(String(r.tin)).tried = n(r.c)
  for (const r of db.prepare('SELECT tin, complete FROM bill_loads').all()) co(String(r.tin)).loaded = n(r.complete) === 1
  let bytes = 0
  for (const suffix of ['', '-wal']) {
    try { bytes += fs.statSync(db.path + suffix).size } catch { /* no such file */ }
  }
  let legacyImport: DbStatus['legacyImport'] = null
  try {
    const m = db.prepare("SELECT v FROM meta WHERE k = 'legacy_import'").get()
    if (m) legacyImport = JSON.parse(String(m.v))
  } catch { /* unreadable marker */ }
  return {
    path: db.path,
    driver: db.driver,
    bytes,
    schemaVersion: n(db.prepare('PRAGMA user_version').get()?.user_version),
    tables: { bills: count('bills'), foundCases: count('found_cases'), tried: count('tried'), details: count('case_details') },
    byCourt,
    companies: [...companies.values()].sort((a, b) => b.bills + b.found - (a.bills + a.found)),
    recovery: lastRecovery(),
    legacyImport,
  }
}

/** A consistent copy of the whole database in a temp file; the caller streams it and calls `done()`. */
export function snapshotFile(): { file: string; name: string; done: () => void } {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const file = path.join(os.tmpdir(), `sud-backup-${process.pid}-${Date.now()}.db`)
  backupTo(file)
  return { file, name: `sud-${stamp}.db`, done: () => { try { fs.rmSync(file, { force: true }) } catch { /* gone */ } } }
}

/** Give back the space of deleted rows and fold the write-ahead log into the file (VACUUM). Returns the sizes before and after. */
export function compactDb(): { before: number; after: number } {
  const before = dbStatus().bytes
  const db = getDb()
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.exec('VACUUM')
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  return { before, after: dbStatus().bytes }
}

/**
 * Forget what the database holds for ONE company: its bills and load state, its found cases and the numbers tried for it. Case details are
 * kept (they belong to the case, not to a company). Returns the rows removed.
 */
export function forgetCompany(tin: string): { bills: number; found: number; tried: number } {
  if (!/^\d{9}$/.test(tin)) throw new Error('STIR aynan 9 ta raqamdan iborat boʻlishi kerak')
  const db = getDb()
  return db.transaction(() => {
    const bills = db.prepare('DELETE FROM bills WHERE tin = ?').run(tin).changes
    db.prepare('DELETE FROM bill_loads WHERE tin = ?').run(tin)
    const found = db.prepare('DELETE FROM found_cases WHERE tin = ?').run(tin).changes
    const tried = db.prepare('DELETE FROM tried WHERE tin = ?').run(tin).changes
    return { bills, found, tried }
  })
}
