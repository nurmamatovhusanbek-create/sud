import 'server-only'
import { getDb } from './db'
import { WATCH_DEFAULT, parseWatchConfig, type SeenRow, type WatchConfig } from '@/core/watch'

/** Kuzatuv's memory: the setting, what each watched court list row looked like, and how the last run went. All in the one SQLite file. */

const META_CONFIG = 'watch_config'
const META_LAST = 'watch_last'

export function readWatchConfig(): WatchConfig {
  try {
    const r = getDb().prepare('SELECT v FROM meta WHERE k = ?').get(META_CONFIG)
    return (r && parseWatchConfig(JSON.parse(String(r.v)))) || WATCH_DEFAULT
  } catch {
    return WATCH_DEFAULT
  }
}

export function saveWatchConfig(c: WatchConfig): void {
  getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(META_CONFIG, JSON.stringify(c))
}

export interface WatchRunSummary {
  at: number
  ms: number
  companies: number
  /** rows read this run, changes announced, messages sent, first reads (silent), and what went wrong */
  rows: number
  events: number
  sent: number
  baselines: number
  errors: string[]
}

export function readLastRun(): WatchRunSummary | null {
  try {
    const r = getDb().prepare('SELECT v FROM meta WHERE k = ?').get(META_LAST)
    return r ? (JSON.parse(String(r.v)) as WatchRunSummary) : null
  } catch {
    return null
  }
}

export function saveLastRun(s: WatchRunSummary): void {
  getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(META_LAST, JSON.stringify(s))
}

// ---- what was seen ------------------------------------------------------------------------------------------------------------------------

export function readSeen(tin: string): Map<string, SeenRow & { court: string; checkedAt: number }> {
  const out = new Map<string, SeenRow & { court: string; checkedAt: number }>()
  for (const r of getDb().prepare('SELECT num, court, sig, ins, checked_at FROM watch_seen WHERE tin = ?').all(tin)) {
    out.set(String(r.num), { sig: String(r.sig), ins: r.ins === null ? null : String(r.ins), court: String(r.court), checkedAt: Number(r.checked_at) })
  }
  return out
}

/** Remember a row. `ins` undefined keeps what was known about the instances; `checked` sets when the detail was last read. */
export function writeSeen(tin: string, num: string, court: string, sig: string, opts: { ins?: string | null; checkedAt?: number; now: number }): void {
  const db = getDb()
  const old = db.prepare('SELECT ins, checked_at FROM watch_seen WHERE tin = ? AND num = ?').get(tin, num)
  const ins = opts.ins !== undefined ? opts.ins : old ? (old.ins === null ? null : String(old.ins)) : null
  const checked = opts.checkedAt ?? (old ? Number(old.checked_at) : 0)
  db.prepare('INSERT OR REPLACE INTO watch_seen (tin, num, court, sig, ins, seen_at, checked_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(tin, num, court, sig, ins, opts.now, checked)
}

/** has this company's court list ever been read for this court (the first read is silent) */
export const hasBaseline = (tin: string, court: string): boolean => !!getDb().prepare('SELECT 1 FROM meta WHERE k = ?').get(`watch_base:${tin}:${court}`)
export const markBaseline = (tin: string, court: string): void => void getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(`watch_base:${tin}:${court}`, '1')

/** the companies the database knows (scraped at least once): the default watch list */
export function knownTins(): string[] {
  const db = getDb()
  const s = new Set<string>()
  for (const t of ['companies', 'bill_loads']) for (const r of db.prepare(`SELECT tin FROM ${t}`).all()) s.add(String(r.tin))
  return [...s].sort()
}

// ---- announced transitions: a list that flaps between two answers is announced twice, not every run ---------------------------------------------

const TRANSITION_KEEP_MS = 3 * 86_400_000
const TRANSITION_MAX = 8

const trKey = (tin: string, num: string): string => `watch_tr:${tin}:${num}`

function readTransitions(tin: string, num: string, now: number): Array<[string, number]> {
  try {
    const r = getDb().prepare('SELECT v FROM meta WHERE k = ?').get(trKey(tin, num))
    const list = r ? (JSON.parse(String(r.v)) as unknown) : []
    return Array.isArray(list) ? (list as Array<[string, number]>).filter((e) => Array.isArray(e) && typeof e[0] === 'string' && now - Number(e[1]) < TRANSITION_KEEP_MS) : []
  } catch {
    return []
  }
}

/** was this exact change («old signature>new signature») of this case already announced in the last three days */
export const transitionAnnounced = (tin: string, num: string, key: string, now: number): boolean => readTransitions(tin, num, now).some((e) => e[0] === key)

export function rememberTransition(tin: string, num: string, key: string, now: number): void {
  const list = [...readTransitions(tin, num, now).filter((e) => e[0] !== key), [key, now] as [string, number]].slice(-TRANSITION_MAX)
  getDb().prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(trKey(tin, num), JSON.stringify(list))
}
