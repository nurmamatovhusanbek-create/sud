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
import type { CourtCase, CourtType, FullCaseData } from './court-case-types'

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
  ;(globalThis as unknown as { __sudFound?: unknown }).__sudFound = undefined
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
 * Cases no TIN list shows (the court cuts a list at its row limit), found by asking the court for their NUMBER (`lib/bill-cases`):
 * `<STIR>.found.json.gz`, the list rows per court type. It is a file of its own so that saving thousands of found cases never rewrites the
 * company's big TIN lists, and `court-case` merges it into each court's list. `tried` says which numbers were already asked.
 */
interface FoundFile {
  v: 1
  tin: string
  courts: Partial<Record<CourtType, CourtCase[]>>
  /** a number already asked of the court: `found` false = neither system knows it (asked again after a while, see lib/bill-cases) */
  tried: Record<string, { t: number; found: boolean }>
}

const gf = globalThis as unknown as { __sudFound?: { dir: string; files: Map<string, FoundFile> } }
function foundMem(): { dir: string; files: Map<string, FoundFile> } {
  const dir = caseStoreDir()
  if (!gf.__sudFound || gf.__sudFound.dir !== dir) gf.__sudFound = { dir, files: new Map() }
  return gf.__sudFound
}

const foundPath = (tin: string): string => path.join(caseStoreDir(), `${tin}.found.json.gz`)

function loadFound(tin: string): FoundFile | null {
  if (!TIN_RE.test(tin)) return null
  const m = foundMem()
  const hit = m.files.get(tin)
  if (hit) return hit
  const raw = readJson(foundPath(tin)) as Partial<FoundFile> | null
  let file: FoundFile
  if (raw && raw.v === 1 && raw.tin === tin && raw.courts && typeof raw.courts === 'object') {
    file = { v: 1, tin, courts: raw.courts, tried: raw.tried && typeof raw.tried === 'object' ? raw.tried : {} }
  } else file = { v: 1, tin, courts: {}, tried: {} }
  m.files.set(tin, file)
  while (m.files.size > 4) m.files.delete(m.files.keys().next().value as string)
  return file
}

/** the found cases of one court (empty when none) */
export function readFound(tin: string, courtType: CourtType): CourtCase[] {
  return loadFound(tin)?.courts[courtType] ?? []
}

export function readTried(tin: string): Record<string, { t: number; found: boolean }> {
  return loadFound(tin)?.tried ?? {}
}

/** Add found rows (by case number, the new one wins) and the numbers just tried, and save. */
export function addFound(tin: string, rows: ReadonlyArray<{ courtType: CourtType; row: CourtCase }>, tried: Record<string, { t: number; found: boolean }>): boolean {
  const file = loadFound(tin)
  if (!file) return false
  const by = new Map<CourtType, CourtCase[]>()
  for (const { courtType, row } of rows) (by.get(courtType) ?? by.set(courtType, []).get(courtType)!).push(row)
  for (const [ct, list] of by) file.courts[ct] = mergeRows(file.courts[ct] ?? [], list)
  Object.assign(file.tried, tried)
  return writeAtomic(foundPath(tin), JSON.stringify(file))
}

/** a found case that is also in a stored TIN list or here: one row of «Yangilash» replaces it in the found rows too */
function patchFound(tin: string, courtType: CourtType, row: CourtCase): boolean {
  const file = loadFound(tin)
  const list = file?.courts[courtType]
  if (!file || !list) return false
  const i = list.findIndex((r) => r.caseNumber === row.caseNumber)
  if (i < 0) return false
  list[i] = row
  return writeAtomic(foundPath(tin), JSON.stringify(file))
}

/** every case number the stored lists AND the found cases of a company hold (all courts) */
export function knownCaseNumbers(tin: string): Set<string> {
  const out = new Set<string>()
  const file = loadFeeds(tin)
  if (file) for (const f of Object.values(file.feeds)) for (const r of f.items) if (r.caseNumber) out.add(r.caseNumber)
  const found = loadFound(tin)
  if (found) for (const list of Object.values(found.courts)) for (const r of list ?? []) if (r.caseNumber) out.add(r.caseNumber)
  return out
}

// ---------------- details ----------------

function detailFile(courtType: string, caseNumber: string): string | null {
  if (!COURTS.has(courtType) || !NUMBER_RE.test(caseNumber)) return null
  return path.join(caseStoreDir(), 'details', courtType, `${caseNumber.replace('/', '@')}.json.gz`)
}

export function readDetail(courtType: CourtType, caseNumber: string): DetailRecord | null {
  const file = detailFile(courtType, caseNumber)
  if (!file) return null
  const raw = readJson(file) as Partial<DetailRecord> | null
  if (!raw || raw.v !== 1 || typeof raw.t !== 'number' || !raw.data || typeof raw.data !== 'object') return null
  return { v: 1, t: raw.t, courtType, caseNumber, data: raw.data }
}

export function writeDetail(courtType: CourtType, caseNumber: string, data: FullCaseData, t: number = Date.now()): boolean {
  const file = detailFile(courtType, caseNumber)
  if (!file) return false
  const rec: DetailRecord = { v: 1, t, courtType, caseNumber, data }
  return writeAtomic(file, JSON.stringify(rec))
}

/** how much is kept (Settings / docs); counts files, reads nothing */
export function caseStoreStats(): { companies: number; details: number } {
  const count = (dir: string, re: RegExp): number => {
    try {
      return fs.readdirSync(dir).filter((n) => re.test(n)).length
    } catch {
      return 0
    }
  }
  let details = 0
  for (const c of COURTS) details += count(path.join(caseStoreDir(), 'details', c), /\.json\.gz$/)
  return { companies: count(caseStoreDir(), /^\d{9}\.json\.gz$/), details }
}
