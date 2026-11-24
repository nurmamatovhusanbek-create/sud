/**
 * The automatic backup (lib/auto-backup): it starts only when the database has something NEW, waits while a job runs, never loops on a failure,
 * keeps the passphrase in a private file that switching off deletes, and its fingerprint ignores times (opening a company rewrites its list file).
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

mock.module('server-only', () => ({}))
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-backup-'))
process.env.SUD_DB = path.join(DIR, 'sud.db')
process.env.CASE_STORE_DIR = path.join(DIR, 'cases')
process.env.SUD_BACKUP_PASS_FILE = path.join(DIR, 'pass.json')
const dbm = await import('../db')
const store = await import('../case-store')
const ab = await import('../auto-backup')
import type { AutoDeps } from '../auto-backup'

const PASS = 'a-long-test-passphrase'
let t = 0
let fp = 'one'
let busy = false
let working = false
let started: string[] = []
let startOk = true
let outcome = { ok: true, message: 'Tayyor' }
const deps: AutoDeps = {
  now: () => t,
  fingerprint: () => fp,
  readPass: () => ab.readPass(),
  start: (p) => { if (!startOk) return { ok: false, error: 'Avval Telegram botini saqlang' }; started.push(p); busy = true; return { ok: true } },
  busy: () => busy,
  outcome: () => outcome,
  working: () => working,
}
const tick = (advance = 6 * 60_000) => { t += advance; ab.autoBackupTick(deps) }
const finish = (ok = true, message = 'Tayyor') => { outcome = { ok, message }; busy = false; tick(1000) }

beforeEach(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
  fs.mkdirSync(DIR, { recursive: true })
  store.forgetCaseStoreMemory()
  t = 1_700_000_000_000; fp = 'one'; busy = false; working = false; started = []; startOk = true; outcome = { ok: true, message: 'Tayyor' }
  // the module keeps its «checked at» in memory: switching on resets it
  ab.enableAuto(PASS)
})
afterAll(() => {
  dbm.closeDb()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('when it starts', () => {
  test('off: nothing ever starts', () => {
    ab.disableAuto()
    tick()
    expect(started).toEqual([])
  })

  test('the first look takes a backup (the channel does not have this database yet), then it waits for something new', () => {
    tick()
    expect(started).toEqual([PASS])
    finish()
    expect(ab.readAuto().fp).toBe('one')
    expect(ab.readAuto().lastOkAt).toBeGreaterThan(0)
    tick(20 * 60_000)
    expect(started).toHaveLength(1) // same fingerprint: nothing new
    fp = 'two'
    tick(20 * 60_000)
    expect(started).toHaveLength(2) // something new
    finish()
    expect(ab.readAuto().fp).toBe('two')
  })

  test('what changes while a backup runs is taken by the NEXT one (the fingerprint is the one taken before it started)', () => {
    tick()
    fp = 'two' // changed during the backup
    finish()
    expect(ab.readAuto().fp).toBe('one')
    tick(20 * 60_000)
    expect(started).toHaveLength(2)
  })

  test('it waits while the bills job or Kuzatuv works, and while a backup is already running', () => {
    working = true
    tick()
    expect(started).toEqual([])
    working = false
    busy = true
    tick()
    expect(started).toEqual([])
    busy = false
    tick()
    expect(started).toHaveLength(1)
  })

  test('not more often than every 5 minutes it looks, and not more often than every 15 it starts', () => {
    tick()
    finish()
    fp = 'two'
    tick(60_000) // 1 minute after the last: too soon to even look
    expect(started).toHaveLength(1)
    tick(10 * 60_000)
    expect(started).toHaveLength(1) // looked, but the last start was 11 minutes ago
    tick(6 * 60_000)
    expect(started).toHaveLength(2)
  })
})

describe('a failure never becomes a loop', () => {
  test('a backup that fails is retried after a pause that grows, and the reason is kept', () => {
    tick()
    finish(false, 'Parol notoʻgʻri')
    expect(ab.readAuto()).toMatchObject({ failures: 1, lastError: 'Parol notoʻgʻri', fp: null })
    tick(10 * 60_000)
    expect(started).toHaveLength(1) // inside the 30 minute pause
    tick(30 * 60_000)
    expect(started).toHaveLength(2)
    finish(false, 'xato')
    expect(ab.readAuto().failures).toBe(2)
    expect(ab.backoffMs(1)).toBe(30 * 60_000)
    expect(ab.backoffMs(2)).toBe(60 * 60_000)
    expect(ab.backoffMs(30)).toBe(6 * 3_600_000)
  })

  test('a start that is refused (no bot saved) counts as a failure', () => {
    startOk = false
    tick()
    expect(ab.readAuto()).toMatchObject({ failures: 1, lastError: 'Avval Telegram botini saqlang' })
  })

  test('a success clears the failures', () => {
    tick()
    finish(false, 'x')
    tick(40 * 60_000)
    finish(true)
    expect(ab.readAuto()).toMatchObject({ failures: 0, lastError: null })
  })

  test('without the passphrase file it says so and starts nothing', () => {
    fs.rmSync(process.env.SUD_BACKUP_PASS_FILE!, { force: true })
    tick()
    expect(started).toEqual([])
    expect(ab.readAuto().lastError).toContain('Parol fayli')
  })
})

describe('the passphrase', () => {
  test('is kept in a private file, never in the status, and switching off deletes it', () => {
    const f = process.env.SUD_BACKUP_PASS_FILE!
    expect(fs.existsSync(f)).toBe(true)
    if (process.platform !== 'win32') expect(fs.statSync(f).mode & 0o777).toBe(0o600)
    expect(JSON.stringify(ab.autoStatus())).not.toContain(PASS)
    expect(ab.autoStatus()).toMatchObject({ enabled: true, hasPassphrase: true })
    ab.disableAuto()
    expect(fs.existsSync(f)).toBe(false)
    expect(ab.autoStatus()).toMatchObject({ enabled: false, hasPassphrase: false })
  })

  test('a too short one is not accepted from a damaged file', () => {
    fs.writeFileSync(process.env.SUD_BACKUP_PASS_FILE!, JSON.stringify({ passphrase: 'short' }))
    expect(ab.readPass()).toBeNull()
  })
})

describe('the fingerprint', () => {
  const row = (n: number, status = 'Тайинлаш') => ({ caseNumber: `4-1001-2601/${n}`, caseType: '', caseStatus: status, result: '', courtName: '', dateFiled: '', plaintiff: 'P', defendant: 'D', claimAmount: '', hearingDate: '', hearingTime: '', judge: '' })
  const T = '309922250'

  test('does not change when a list is only read again (new time, same rows), changes when a row changes or is added', () => {
    store.writeFeed(T, 'economic|x', { t: 1, complete: true, items: [row(1), row(2)] })
    const a = ab.fingerprint()
    store.writeFeed(T, 'economic|x', { t: 99999, complete: true, etag: 'W/"e"', items: [row(1), row(2)] })
    expect(ab.fingerprint()).toBe(a)
    store.writeFeed(T, 'economic|x', { t: 3, complete: true, items: [row(1, 'Якунланган'), row(2)] })
    const b = ab.fingerprint()
    expect(b).not.toBe(a)
    store.writeFeed(T, 'economic|x', { t: 4, complete: true, items: [row(1, 'Якунланган'), row(2), row(3)] })
    expect(ab.fingerprint()).not.toBe(b)
  })

  test('changes when a case is found by number, and not when it is fetched again unchanged', () => {
    const a = ab.fingerprint()
    store.addFound(T, [{ courtType: 'economic', row: row(7) }], {}, 100)
    const b = ab.fingerprint()
    expect(b).not.toBe(a)
    store.addFound(T, [{ courtType: 'economic', row: row(7) }], {}, 999999)
    expect(ab.fingerprint()).toBe(b) // a later time on the same row is not news
  })
})
