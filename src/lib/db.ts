/**
 * The app's one SQLite file: `~/.sud-tizimi/sud.db` (`SUD_DB`). Server-only.
 *
 * Why SQLite: a big company has hundreds of thousands of bills and tens of thousands of cases (a bank: 241 541 bills, 71 000 cases found by
 * number), which the app used to hold whole in memory and send whole to the browser. Here the server asks for one PAGE at a time
 * (docs/design-notes.md › «SQLite»).
 *
 * The driver is chosen at run time, because the server runs on whichever runtime started it: the owner's PC has no Node, so `bun run dev`
 * runs the supervisor and Next on BUN (`bun:sqlite`); under Node it is `node:sqlite` (Node ≥ 22.13). Both are loaded through
 * `createRequire` / `process.getBuiltinModule`, which a bundler does not try to resolve (checked in the Next dev server under both).
 * `driverName()` says which one is in use and `[db]` is logged at open.
 *
 * WAL, `synchronous=NORMAL` (a power cut can lose the last moments, never corrupt the file), a 32 MB page cache, a busy timeout. One
 * connection per process, kept on `globalThis` so dev hot reloads do not open a second one. Schema changes are numbered migrations
 * (`lib/db-schema`, `PRAGMA user_version`). A file that fails `quick_check` is set aside (`sud.db.corrupt-<time>`) and a fresh one is made:
 * almost everything in it can be fetched again, and the owner can download a backup (`backupTo`).
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { MIGRATIONS } from './db-schema'
import { importLegacy } from './db-import'

export type SqlValue = string | number | bigint | null | Uint8Array

export interface Stmt {
  all(...params: SqlValue[]): Record<string, unknown>[]
  get(...params: SqlValue[]): Record<string, unknown> | undefined
  run(...params: SqlValue[]): { changes: number }
}

export interface Db {
  readonly path: string
  readonly driver: 'bun:sqlite' | 'node:sqlite'
  exec(sql: string): void
  /** a prepared statement, cached by its text */
  prepare(sql: string): Stmt
  /** run `fn` in one transaction (nested calls join the outer one) */
  transaction<T>(fn: () => T): T
  close(): void
}

export const dbPath = (): string => process.env.SUD_DB || path.join(os.homedir(), '.sud-tizimi', 'sud.db')

interface Raw {
  exec(sql: string): void
  prepare(sql: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown; run(...p: unknown[]): { changes: number | bigint } }
  close(): void
}

function openRaw(file: string): { raw: Raw; driver: Db['driver'] } {
  const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
  const req = createRequire(path.join(process.cwd(), 'noop.js'))
  if (hasBun) {
    const { Database } = req('bun:sqlite') as { Database: new (p: string, o?: { create?: boolean }) => Raw }
    return { raw: new Database(file, { create: true }), driver: 'bun:sqlite' }
  }
  const mod = ((process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule?.('node:sqlite') ?? tryRequire(req, 'node:sqlite')) as
    | { DatabaseSync: new (p: string) => Raw }
    | null
  if (!mod) {
    throw new Error(
      `SQLite topilmadi: bu ilova Bun (bun:sqlite) yoki Node 22.13+ (node:sqlite) bilan ishlaydi; hozirgi Node ${process.versions.node}. Node 22 LTS yoki yangisini oʻrnating.`,
    )
  }
  return { raw: new mod.DatabaseSync(file), driver: 'node:sqlite' }
}

function tryRequire(req: NodeJS.Require, name: string): unknown {
  try {
    return req(name)
  } catch {
    return null
  }
}

function wrap(raw: Raw, driver: Db['driver'], file: string): Db {
  const cache = new Map<string, Stmt>()
  let depth = 0
  // node:sqlite THROWS on an integer above 2^53 (a bill with an absurd amount is one); bun:sqlite gives a float. With bigints read, every
  // integer is turned into a Number the same way, so one odd row cannot break a whole list.
  const big = driver === 'node:sqlite'
  const fix = (r: Record<string, unknown>): Record<string, unknown> => {
    if (big) for (const k in r) if (typeof r[k] === 'bigint') r[k] = Number(r[k])
    return r
  }
  const norm = (r: unknown) => (r === null || r === undefined ? undefined : fix(r as Record<string, unknown>))
  const db: Db = {
    path: file,
    driver,
    exec: (sql) => raw.exec(sql),
    prepare(sql) {
      let s = cache.get(sql)
      if (!s) {
        const st = raw.prepare(sql)
        if (big) (st as unknown as { setReadBigInts?: (on: boolean) => void }).setReadBigInts?.(true)
        s = {
          all: (...p) => (st.all(...p) as Record<string, unknown>[]).map(fix),
          get: (...p) => norm(st.get(...p)),
          run: (...p) => ({ changes: Number(st.run(...p).changes) }),
        }
        if (cache.size > 300) cache.clear()
        cache.set(sql, s)
      }
      return s
    },
    transaction<T>(fn: () => T): T {
      if (depth > 0) return fn()
      raw.exec('BEGIN IMMEDIATE')
      depth++
      try {
        const out = fn()
        raw.exec('COMMIT')
        return out
      } catch (e) {
        try { raw.exec('ROLLBACK') } catch { /* already rolled back */ }
        throw e
      } finally {
        depth--
      }
    },
    close() {
      cache.clear()
      raw.close()
    },
  }
  return db
}

const g = globalThis as unknown as { __sudDb?: { path: string; db: Db; recovered: string | null } }

/** what the last open did to a damaged file (null when it was fine): shown in Settings */
export const lastRecovery = (): string | null => g.__sudDb?.recovered ?? null

function migrate(db: Db): void {
  const cur = Number((db.prepare('PRAGMA user_version').get() ?? {}).user_version ?? 0)
  for (const m of MIGRATIONS) {
    if (m.v <= cur) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.exec(`PRAGMA user_version = ${m.v}`)
    })
  }
}

function openChecked(file: string): { db: Db; recovered: string | null } {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  let recovered: string | null = null
  const attempt = (): Db => {
    const { raw, driver } = openRaw(file)
    const db = wrap(raw, driver, file)
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000; PRAGMA cache_size = -32768; PRAGMA temp_store = MEMORY')
    if (fs.existsSync(file) && fs.statSync(file).size > 0) {
      const ok = String((db.prepare('PRAGMA quick_check(1)').get() ?? {}).quick_check ?? '')
      if (ok !== 'ok') {
        db.close()
        throw new Error(`quick_check: ${ok || 'failed'}`)
      }
    }
    migrate(db)
    return db
  }
  try {
    return { db: attempt(), recovered }
  } catch (e) {
    if (!fs.existsSync(file)) throw e // not a damaged file: the driver is missing or the folder is not writable
    const msg = e instanceof Error ? e.message : String(e)
    if (/SQLite topilmadi/.test(msg)) throw e
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    const aside = `${file}.corrupt-${stamp}`
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.renameSync(file + suffix, aside + suffix) } catch { /* no such file */ }
    }
    recovered = `Maʼlumotlar bazasi fayli shikastlangan edi (${msg}); u ${path.basename(aside)} nomi bilan chetga olindi va yangisi yaratildi.`
    console.warn(`[db] ${recovered}`)
    return { db: attempt(), recovered }
  }
}

/** The one connection of this process (opened and migrated on first use). */
export function getDb(): Db {
  const file = dbPath()
  if (g.__sudDb && g.__sudDb.path === file) return g.__sudDb.db
  if (g.__sudDb) {
    try { g.__sudDb.db.close() } catch { /* already closed */ }
    g.__sudDb = undefined
  }
  const { db, recovered } = openChecked(file)
  g.__sudDb = { path: file, db, recovered }
  console.log(`[db] ${db.driver} ${file}`)
  try {
    importLegacy(db) // once: the files the app used before the database are copied in (never changed or deleted)
  } catch (e) {
    console.warn(`[db] import of the old files failed, it will be tried again next time: ${e instanceof Error ? e.message : e}`)
  }
  return db
}

/** A SEPARATE database file (a restored copy, a check): opened, checked and migrated like the live one, but not the app's connection and with no import of the old files. The caller closes it. */
export function openDbFile(file: string): Db {
  return openChecked(file).db
}

/** close the connection (tests; the next `getDb()` opens it again) */
export function closeDb(): void {
  if (g.__sudDb) {
    try { g.__sudDb.db.close() } catch { /* already closed */ }
    g.__sudDb = undefined
  }
}

/**
 * A consistent copy of the database in one file (`VACUUM INTO`): safe while the app is writing. Used by the Settings download; the caller
 * deletes the file afterwards.
 */
export function backupTo(target: string): void {
  const db = getDb()
  try { fs.rmSync(target, { force: true }) } catch { /* none */ }
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
}
