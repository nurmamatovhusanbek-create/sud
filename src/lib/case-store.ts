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
  if (!file || !row.caseNumber) return false
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
