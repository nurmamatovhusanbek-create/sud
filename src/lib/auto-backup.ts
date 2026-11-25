import 'server-only'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDb } from './db'
import { backupBusy, backupState, startBackup, type StartResult } from './backup'
import { billJobRunning } from './bill-cases'
import { feedRows, feedTins } from './case-store'
import { watchRunning } from './watch'
import { MIN_PASSPHRASE } from './backup-crypto'
import { ordersFingerprint } from './orders-buckets'

/**
 * Automatic backup («Avtomatik zaxira»): when something NEW is in the database, the encrypted backup goes to the Telegram channel by itself, so the
 * bot (which only ever reads that backup, every 5 minutes) follows the app without anyone pressing «Zaxira». Opt-in, off until the operator
 * switches it on in Settings › Telegram.
 *
 * The passphrase has to be kept for this, so it is: `~/.sud-tizimi/backup-pass.json`, 0600, like the bot token and the captcha keys (outside the
 * project, never in git, never sent back to the browser; switching the feature off DELETES it). It is checked against the channel's chain before it
 * is accepted (`verifyPassphrase`), and a backup that fails is retried with a growing pause, never in a loop.
 *
 * «New» is a FINGERPRINT of what a backup would carry (counts, sizes and sums of bills, found cases, details, tried numbers, loads, and the content
 * of the court lists), NOT of timestamps: opening a company rewrites its list file with a new time but the same rows, and every backup pins a new
 * manifest message, so a change in time alone must not start one. A backup also waits while the bills job or Kuzatuv is running, so it carries a
 * finished piece of work and not half of it.
 */

export const CHECK_EVERY_MS = 5 * 60_000
export const MIN_GAP_MS = 15 * 60_000
export const backoffMs = (failures: number): number => Math.min(6 * 3_600_000, 30 * 60_000 * 2 ** Math.max(0, failures - 1))

const META = 'auto_backup'

export interface AutoState {
  enabled: boolean
  /** the fingerprint of the database at the last SUCCESSFUL automatic backup */
  fp: string | null
  lastOkAt: number
  lastAttemptAt: number
  failures: number
  lastError: string | null
}
const IDLE: AutoState = { enabled: false, fp: null, lastOkAt: 0, lastAttemptAt: 0, failures: 0, lastError: null }

export const passFile = (): string => process.env.SUD_BACKUP_PASS_FILE || path.join(os.homedir(), '.sud-tizimi', 'backup-pass.json')

export function readPass(): string | null {
  try {
    const p = (JSON.parse(fs.readFileSync(passFile(), 'utf8')) as { passphrase?: unknown }).passphrase
    return typeof p === 'string' && p.length >= MIN_PASSPHRASE ? p : null
  } catch {
    return null
  }
}

function savePass(passphrase: string): void {
  const file = passFile()
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ passphrase, savedAt: new Date().toISOString() }), { mode: 0o600 })
  fs.renameSync(tmp, file) // never a half-written file
}

function forgetPass(): void {
  try {
    fs.rmSync(passFile(), { force: true })
  } catch {
    /* nothing to remove */
  }
}

export function readAuto(): AutoState {
  try {
    const r = getDb().prepare('SELECT v FROM meta WHERE k = ?').get(META)
    return r ? { ...IDLE, ...(JSON.parse(String(r.v)) as Partial<AutoState>) } : IDLE
  } catch {
    return IDLE
  }
}

const writeAuto = (s: AutoState): void => {
  getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(META, JSON.stringify(s))
}

/** what a backup would carry, as one short string: equal strings = nothing new */
export function fingerprint(): string {
  const db = getDb()
  const h = crypto.createHash('sha256')
  const one = (sql: string): void => {
    h.update(JSON.stringify(db.prepare(sql).get()))
    h.update('\n')
  }
  one('SELECT COUNT(*) n, COALESCE(SUM(paid),0) p, COALESCE(SUM(balance),0) b, COALESCE(SUM(decision),0) d, COALESCE(SUM(amount),0) a, COALESCE(SUM(overdue),0) o, COALESCE(SUM(LENGTH(status)),0) s FROM bills WHERE case_number IS NOT NULL AND case_number != \'\'')
  one('SELECT COUNT(*) n, COALESCE(SUM(LENGTH(row)),0) r, COALESCE(SUM(LENGTH(status)),0) s FROM found_cases')
  one('SELECT COUNT(*) n, COALESCE(SUM(LENGTH(d)),0) s FROM case_details')
  one('SELECT COUNT(*) n, COALESCE(SUM(found),0) f FROM tried')
  one('SELECT COUNT(*) n, COALESCE(SUM(total_elements),0) t, COALESCE(SUM(complete),0) c FROM bill_loads')
  one('SELECT COUNT(*) n FROM companies')
  for (const tin of feedTins()) {
    h.update(tin)
    for (const r of feedRows(tin)) h.update(`|${r.court}|${r.num}|${r.row.caseStatus}|${r.row.result}|${r.row.hearingDate}|${r.row.hearingTime}`)
    h.update('\n')
  }
  h.update(`orders:${ordersFingerprint()}`) // downloaded order PDFs and their records (names and sizes only)
  return h.digest('hex')
}

export interface AutoDeps {
  now: () => number
  fingerprint: () => string
  readPass: () => string | null
  start: (passphrase: string) => StartResult
  busy: () => boolean
  /** the finished state of the backup job: did it end well, and why not */
  outcome: () => { ok: boolean; message: string }
  /** the bills job or Kuzatuv is running: wait for them */
  working: () => boolean
}

const REAL: AutoDeps = {
  now: () => Date.now(),
  fingerprint,
  readPass,
  start: startBackup,
  busy: backupBusy,
  outcome: () => {
    const s = backupState()
    return { ok: s.phase === 'done', message: s.message }
  },
  working: () => billJobRunning() || watchRunning(),
}

const g = globalThis as unknown as { __sudAutoBackup?: { timer?: ReturnType<typeof setInterval>; pending: string | null; checkedAt: number } }
const slot = () => (g.__sudAutoBackup ??= { pending: null, checkedAt: 0 })

/** one look: record how our last backup ended, and start another when there is something new. Never throws. */
export function autoBackupTick(deps: AutoDeps = REAL): void {
  try {
    const st = { ...readAuto() }
    if (!st.enabled) return
    const sl = slot()
    const now = deps.now()
    if (sl.pending !== null) {
      if (deps.busy()) return
      const o = deps.outcome()
      if (o.ok) writeAuto({ ...st, fp: sl.pending, lastOkAt: now, failures: 0, lastError: null })
      else writeAuto({ ...st, failures: st.failures + 1, lastError: o.message.slice(0, 300) })
      sl.pending = null
      return
    }
    if (deps.busy() || deps.working()) return
    if (now - sl.checkedAt < CHECK_EVERY_MS) return
    sl.checkedAt = now
    if (st.lastAttemptAt && now - st.lastAttemptAt < (st.failures > 0 ? backoffMs(st.failures) : MIN_GAP_MS)) return
    const pass = deps.readPass()
    if (!pass) {
      writeAuto({ ...st, lastError: 'Parol fayli topilmadi: avtomatik zaxirani qayta yoqing' })
      return
    }
    const fp = deps.fingerprint()
    if (fp === st.fp) return
    const r = deps.start(pass)
    if (!r.ok) {
      writeAuto({ ...st, lastAttemptAt: now, failures: st.failures + 1, lastError: r.error })
      return
    }
    writeAuto({ ...st, lastAttemptAt: now })
    sl.pending = fp // the fingerprint taken BEFORE the backup: what changes while it runs starts the next one
  } catch (e) {
    console.warn(`[auto-backup] ${e instanceof Error ? e.message : String(e)}`)
  }
}

export type BackupNow = 'started' | 'unchanged' | 'busy' | 'unavailable'

/**
 * A backup right now, for the link with the bot (`lib/bot-link`): somebody asked from Telegram for a company to be refreshed, and it is not worth waiting
 * for the 15-minute gap. Needs the automatic backup to be on (that is what keeps the passphrase). `unchanged`: nothing new since the last automatic backup,
 * so what is in the channel already is the whole database. The result is recorded by the usual tick, like any automatic backup.
 */
export function backupNow(deps: AutoDeps = REAL): BackupNow {
  try {
    const st = readAuto()
    const pass = deps.readPass()
    if (!st.enabled || !pass) return 'unavailable'
    const sl = slot()
    if (sl.pending !== null || deps.busy()) return 'busy'
    const fp = deps.fingerprint()
    if (fp === st.fp) return 'unchanged'
    const r = deps.start(pass)
    if (!r.ok) {
      writeAuto({ ...st, lastAttemptAt: deps.now(), failures: st.failures + 1, lastError: r.error })
      return 'unavailable'
    }
    writeAuto({ ...st, lastAttemptAt: deps.now() })
    sl.pending = fp
    return 'started'
  } catch {
    return 'unavailable'
  }
}

export function startAutoBackup(): void {
  const sl = slot()
  if (sl.timer) return
  sl.timer = setInterval(() => autoBackupTick(), 60_000)
  sl.timer.unref?.()
}

export interface AutoStatus {
  enabled: boolean
  hasPassphrase: boolean
  lastOkAt: number
  lastAttemptAt: number
  failures: number
  lastError: string | null
  running: boolean
}

export const autoStatus = (): AutoStatus => {
  const s = readAuto()
  return { enabled: s.enabled, hasPassphrase: !!readPass(), lastOkAt: s.lastOkAt, lastAttemptAt: s.lastAttemptAt, failures: s.failures, lastError: s.lastError, running: slot().pending !== null }
}

/** switch it on: the passphrase is kept and the first look (within a minute) takes the first backup when the database differs from the channel */
export function enableAuto(passphrase: string): void {
  savePass(passphrase)
  const sl = slot()
  sl.pending = null
  sl.checkedAt = 0
  writeAuto({ ...IDLE, enabled: true })
}

/** switch it off: the stored passphrase is DELETED */
export function disableAuto(): void {
  forgetPass()
  slot().pending = null
  writeAuto({ ...readAuto(), enabled: false })
}
