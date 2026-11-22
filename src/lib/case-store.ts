/**
 * The court-case memory, on disk: `~/.sud-tizimi/cases/` (`CASE_STORE_DIR`).
 *
 * Two kinds of record, both gzip JSON, 0600, written atomically (tmp + rename):
 *
 *  - FEEDS, `<STIR>.json.gz`: what each court endpoint last said about a company, as the app's own `CourtCase` rows plus the answer's
 *    `ETag`. A bank's list (hundreds to thousands of cases, one multi-megabyte answer, 20-30 s before the first byte) is therefore
 *    asked with `If-None-Match`: «not modified» costs nothing to download or parse. A PARTIAL answer (a download that broke) is merged
 *    into the stored rows instead of replacing them, so a case once seen is never lost to a bad day, and a total failure is answered
 *    from disk.
 *  - DETAILS, `details/<court>/<number>.json.gz`: the full case (instances, hearings, judges) the drawer showed. A case that ended
 *    long ago is served from here without asking the court (`core/case-freeze`); any other is read live and falls back to this copy
 *    when the court cannot be reached; the operator's «Yangilash» fetches that one case only.
 *
 * Unlike `snapshot-store` nothing here expires: it is the memory of ended cases, and the app never deletes it (like the orders cache).
 * The STIR and the case number become file names, so each is matched against its exact shape first (no path can be smuggled in).
 * Server-only: imports `fs`.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { caseHay, registeredKey } from '@/core/bill-cases'
import type { CourtCase, CourtType, FullCaseData } from './court-case-types'
import { getDb } from './db'

const TIN_RE = /^\d{9}$/
const NUMBER_RE = /^\d+-[\d-]+\/\d+$/
const COURTS = new Set<string>(['economic', 'civil', 'criminal', 'administrative'])
const MEMORY_MAX = 12

export const caseStoreDir = (): string => process.env.CASE_STORE_DIR || path.join(os.homedir(), '.sud-tizimi', 'cases')

/** what one endpoint answered for one company */
export interface Feed {
  /** when the court answered (ms) */
  t: number
  /** the answer's `ETag`; only a COMPLETE answer has one (a broken download must be fetched in full next time) */
  etag?: string
  /** the rows are the whole list (false: some of it never arrived) */
  complete: boolean
  /** the court's list was cut at its row limit: the rows are every row ever seen, not what the court shows now */
  capped?: boolean
  items: CourtCase[]
}

interface FeedFile {
  v: 1
  tin: string
  feeds: Record<string, Feed>
}

export interface DetailRecord {
  v: 1
  /** when the court answered (ms) */
  t: number
  courtType: CourtType
  caseNumber: string
  data: FullCaseData
}

const g = globalThis as unknown as { __sudCaseStore?: { dir: string; files: Map<string, FeedFile> } }
function mem(): { dir: string; files: Map<string, FeedFile> } {
  const dir = caseStoreDir()
  if (!g.__sudCaseStore || g.__sudCaseStore.dir !== dir) g.__sudCaseStore = { dir, files: new Map() }
  return g.__sudCaseStore
}

/** forget what is held in memory (tests; the disk is untouched) */
export function forgetCaseStoreMemory(): void {
  g.__sudCaseStore = undefined
}

function writeAtomic(target: string, json: string): boolean {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
    const tmp = `${target}.${process.pid}.tmp`
    fs.writeFileSync(tmp, zlib.gzipSync(json), { mode: 0o600 })
    fs.renameSync(tmp, target)
    return true
  } catch (e) {
    console.warn(`[case-store] could not save ${target}: ${e instanceof Error ? e.message : e}`)
    return false // the answer is still served; it just is not kept
  }
}

function readJson(target: string): unknown {
  try {
    return JSON.parse(zlib.gunzipSync(fs.readFileSync(target)).toString('utf8'))
  } catch {
    return null // none yet, or damaged: the next write replaces it
  }
}

// ---------------- feeds ----------------

const feedFile = (tin: string): string => path.join(caseStoreDir(), `${tin}.json.gz`)

function loadFeeds(tin: string): FeedFile | null {
  if (!TIN_RE.test(tin)) return null
  const m = mem()
  const hit = m.files.get(tin)
  if (hit) {
    m.files.delete(tin) // LRU: most recent last
    m.files.set(tin, hit)
    return hit
  }
  const raw = readJson(feedFile(tin)) as Partial<FeedFile> | null
  if (!raw || raw.v !== 1 || raw.tin !== tin || !raw.feeds || typeof raw.feeds !== 'object') return null
  const feeds: Record<string, Feed> = {}
  for (const [k, f] of Object.entries(raw.feeds)) {
    const x = f as Partial<Feed> | null
    if (x && typeof x.t === 'number' && Array.isArray(x.items)) feeds[k] = { t: x.t, etag: typeof x.etag === 'string' ? x.etag : undefined, complete: x.complete === true, ...(x.capped === true ? { capped: true } : {}), items: x.items }
  }
  const file: FeedFile = { v: 1, tin, feeds }
  remember(tin, file)
  return file
}

function remember(tin: string, file: FeedFile): void {
  const m = mem()
  m.files.delete(tin)
  m.files.set(tin, file)
  while (m.files.size > MEMORY_MAX) m.files.delete(m.files.keys().next().value as string)
}

export function readFeed(tin: string, key: string): Feed | null {
  return loadFeeds(tin)?.feeds[key] ?? null
}

export function writeFeed(tin: string, key: string, feed: Feed): boolean {
  if (!TIN_RE.test(tin)) return false
  const file = loadFeeds(tin) ?? { v: 1 as const, tin, feeds: {} }
  file.feeds[key] = feed
  remember(tin, file)
  return writeAtomic(feedFile(tin), JSON.stringify(file))
}

/**
 * Add the rows that arrived to the rows already kept: by case number, the NEW row wins, the old ones that did not arrive stay.
 * Order: the stored order first (new cases at the end), so a list does not shuffle between opens.
 */
export function mergeRows(kept: readonly CourtCase[], arrived: readonly CourtCase[]): CourtCase[] {
  const out = new Map<string, CourtCase>()
  for (const r of kept) if (r.caseNumber) out.set(r.caseNumber, r)
  for (const r of arrived) if (r.caseNumber) out.set(r.caseNumber, r)
  return [...out.values()]
}

/**
 * Put one freshly fetched case row into every stored feed of the company that holds it (the operator pressed «Yangilash» on that case).
 * `courtType` limits it to that court's feeds (keys start with `<court>|`). A case no feed holds is added to the court's first feed.
 * Returns whether a stored row changed or was added.
 */
export function patchRow(tin: string, courtType: CourtType, row: CourtCase): boolean {
  const file = loadFeeds(tin)
  if (!row.caseNumber) return false
  if (patchFound(tin, courtType, row)) return true
  if (!file) return false
  const keys = Object.keys(file.feeds).filter((k) => k.startsWith(`${courtType}|`))
  if (!keys.length) return false
  let held = false
  for (const k of keys) {
    const f = file.feeds[k]
    const i = f.items.findIndex((r) => r.caseNumber === row.caseNumber)
    if (i >= 0) {
      f.items[i] = row
      held = true
    }
  }
  if (!held) file.feeds[keys[0]].items.push(row)
  remember(tin, file)
  return writeAtomic(feedFile(tin), JSON.stringify(file))
}

// ---------------- the cases found by number (from the bills) ----------------

/**
 * Cases no TIN list shows (the court cuts a list at its row limit), found by asking the court for their NUMBER (`lib/bill-cases`), in
 * `sud.db` (`found_cases`, the list row as JSON; `tried` = the numbers already asked). They are NOT merged into the TIN list the browser
 * gets: a big company has tens of thousands, so they are read in pages (`queryFound`, `/api/found-cases`).
 */
export type TriedMap = Record<string, { t: number; found: boolean }>

const hayOf = caseHay
const yymmOf = registeredKey

/** Add found rows (by case number, the new one wins) and the numbers just tried, in one transaction. */
export function addFound(tin: string, rows: ReadonlyArray<{ courtType: CourtType; row: CourtCase }>, tried: TriedMap): boolean {
  if (!TIN_RE.test(tin)) return false
  const db = getDb()
  const fc = db.prepare('INSERT OR REPLACE INTO found_cases (court, tin, num, yymm, status, hay, row, t) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const tr = db.prepare('INSERT OR REPLACE INTO tried (tin, num, t, found) VALUES (?, ?, ?, ?)')
  const now = Date.now()
  db.transaction(() => {
    for (const { courtType, row } of rows) {
      if (row.caseNumber && COURTS.has(courtType)) fc.run(courtType, tin, row.caseNumber, yymmOf(row.caseNumber), row.caseStatus, hayOf(row), JSON.stringify(row), now)
    }
    for (const [num, v] of Object.entries(tried)) tr.run(tin, num, v.t, v.found ? 1 : 0)
  })
  return true
}

/** the found cases of one court (all of them: tests and the importer; the app reads pages) */
export function readFound(tin: string, courtType: CourtType): CourtCase[] {
  if (!TIN_RE.test(tin)) return []
  return getDb().prepare('SELECT row FROM found_cases WHERE court = ? AND tin = ? ORDER BY yymm DESC, num').all(courtType, tin).map((r) => JSON.parse(String(r.row)) as CourtCase)
}

export function readTried(tin: string): TriedMap {
  if (!TIN_RE.test(tin)) return {}
  const out: TriedMap = {}
  for (const r of getDb().prepare('SELECT num, t, found FROM tried WHERE tin = ?').all(tin)) out[String(r.num)] = { t: Number(r.t), found: Number(r.found) === 1 }
  return out
}

/** how many numbers were found / asked without an answer (and not old enough to be asked again) */
export function triedStats(tin: string, retryBefore: number): { found: number; notFound: number } {
  if (!TIN_RE.test(tin)) return { found: 0, notFound: 0 }
  const r = getDb().prepare('SELECT COALESCE(SUM(found = 1), 0) AS f, COALESCE(SUM(found = 0 AND t > ?), 0) AS n FROM tried WHERE tin = ?').get(retryBefore, tin)
  return { found: Number(r?.f ?? 0), notFound: Number(r?.n ?? 0) }
}

export interface FoundQuery {
  court?: CourtType
  q?: string
  page?: number
  size?: number
  /** `new` (default): the newest registration first */
  sort?: 'new' | 'old'
}

export interface FoundPage {
  /** found cases per court type (all of them, whatever the filter) */
  byCourt: Partial<Record<CourtType, number>>
  matched: number
  rows: Array<{ courtType: CourtType; row: CourtCase }>
}

/** One PAGE of the found cases, with the counts per court type. */
export function queryFound(tin: string, f: FoundQuery): FoundPage {
  const empty: FoundPage = { byCourt: {}, matched: 0, rows: [] }
  if (!TIN_RE.test(tin)) return empty
  const db = getDb()
  const byCourt: FoundPage['byCourt'] = {}
  for (const r of db.prepare('SELECT court, COUNT(*) n FROM found_cases WHERE tin = ? GROUP BY court').all(tin)) byCourt[String(r.court) as CourtType] = Number(r.n)
  const parts = ['tin = ?']
  const params: Array<string | number> = [tin]
  if (f.court && COURTS.has(f.court)) { parts.push('court = ?'); params.push(f.court) }
  const q = f.q?.trim().toLowerCase()
  if (q) { parts.push('instr(hay, ?) > 0'); params.push(q) }
  const w = parts.join(' AND ')
  const matched = Number(db.prepare(`SELECT COUNT(*) n FROM found_cases WHERE ${w}`).get(...params)?.n ?? 0)
  if (!matched) return { byCourt, matched: 0, rows: [] }
  const size = Math.max(1, Math.min(200, Math.trunc(f.size ?? 25)))
  const page = Math.max(1, Math.min(Math.ceil(matched / size), Math.trunc(f.page ?? 1)))
  const order = f.sort === 'old' ? 'yymm ASC, num ASC' : 'yymm DESC, num ASC'
  const rows = db.prepare(`SELECT court, row FROM found_cases WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, size, (page - 1) * size)
  return { byCourt, matched, rows: rows.map((r) => ({ courtType: String(r.court) as CourtType, row: JSON.parse(String(r.row)) as CourtCase })) }
}

/** a found case replaced by a fresher row («Yangilash»): returns whether it was one of the found cases */
function patchFound(tin: string, courtType: CourtType, row: CourtCase): boolean {
  if (!TIN_RE.test(tin)) return false
  return getDb().prepare('UPDATE found_cases SET row = ?, status = ?, hay = ?, t = ? WHERE court = ? AND tin = ? AND num = ?').run(JSON.stringify(row), row.caseStatus, hayOf(row), Date.now(), courtType, tin, row.caseNumber).changes > 0
}

/** the case numbers the company's stored TIN lists show (all courts, every endpoint) */
export function feedCaseNumbers(tin: string): Set<string> {
  const out = new Set<string>()
  const file = loadFeeds(tin)
  if (file) for (const f of Object.values(file.feeds)) for (const r of f.items) if (r.caseNumber) out.add(r.caseNumber)
  return out
}

/** every case number the stored lists AND the found cases of a company hold (all courts) */
export function knownCaseNumbers(tin: string): Set<string> {
  const out = feedCaseNumbers(tin)
  if (TIN_RE.test(tin)) for (const r of getDb().prepare('SELECT num FROM found_cases WHERE tin = ?').all(tin)) out.add(String(r.num))
  return out
}

// ---------------- details ----------------

/** a case's full detail (gzip JSON in `case_details`) */
export function readDetail(courtType: CourtType, caseNumber: string): DetailRecord | null {
  if (!COURTS.has(courtType) || !NUMBER_RE.test(caseNumber)) return null
  const r = getDb().prepare('SELECT t, d FROM case_details WHERE court = ? AND num = ?').get(courtType, caseNumber)
  if (!r) return null
  try {
    const data = JSON.parse(zlib.gunzipSync(Buffer.from(r.d as Uint8Array)).toString('utf8')) as FullCaseData
    return data && typeof data === 'object' ? { v: 1, t: Number(r.t), courtType, caseNumber, data } : null
  } catch {
    return null // damaged: the next write replaces it
  }
}

export function writeDetail(courtType: CourtType, caseNumber: string, data: FullCaseData, t: number = Date.now()): boolean {
  if (!COURTS.has(courtType) || !NUMBER_RE.test(caseNumber)) return false
  getDb().prepare('INSERT OR REPLACE INTO case_details (court, num, t, d) VALUES (?, ?, ?, ?)').run(courtType, caseNumber, t, zlib.gzipSync(JSON.stringify(data)))
  return true
}

/** how much is kept (Settings / docs) */
export function caseStoreStats(): { companies: number; details: number; found: number } {
  const db = getDb()
  let companies = 0
  try {
    companies = fs.readdirSync(caseStoreDir()).filter((n) => /^\d{9}\.json\.gz$/.test(n)).length
  } catch { /* no directory */ }
  return { companies, details: Number(db.prepare('SELECT COUNT(*) n FROM case_details').get()?.n ?? 0), found: Number(db.prepare('SELECT COUNT(*) n FROM found_cases').get()?.n ?? 0) }
}
