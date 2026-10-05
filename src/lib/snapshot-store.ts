/**
 * Daily snapshots of a company's scraped data, on disk.
 *
 * Until now a company was scraped again whenever the 5-minute browser cache or the server's 60 s / 10 min memory caches
 * had lapsed, and every server restart (`bun run dev` restarts on each crash and rebuild) emptied the server ones. A
 * snapshot is the answer the sites last gave, kept for SNAPSHOT_TTL_MS (24 h): inside that window a plain open, tab
 * refresh or restart is served from disk and touches no site. A hard refresh (`force`) scrapes and overwrites.
 *
 * One small JSON file per company, `~/.sud-tizimi/snapshots/<STIR>.json` (0600, atomic write), holding PARTS
 * (stats · info · court:<type> · bills), each with its own fetch time. Upcoming hearings are deliberately not a part.
 *
 * Rules (each one is a past bug elsewhere in the app):
 *  - only a COMPLETE answer is stored (`storable`): a partial one would replay its gaps for a day without the banner;
 *  - a failed refresh never touches the old snapshot, and a plain open whose re-scrape fails serves the expired one
 *    flagged `stale` (up to keepMs) instead of an error;
 *  - the STIR is the file name, so it must be exactly 9 digits (no path can be smuggled in);
 *  - unrefreshed files and parts older than keepMs are deleted. Server-only: imports `fs`.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from '@/server/config'

export type SnapshotPart = 'stats' | 'info' | 'bills' | 'court:economic' | 'court:civil' | 'court:administrative'

interface PartRecord {
  /** when the sites answered (ms) */
  t: number
  d: unknown
}

interface SnapshotFile {
  v: 1
  tin: string
  parts: Partial<Record<SnapshotPart, PartRecord>>
}

export interface Snap<T> {
  data: T
  fetchedAt: number
}

const FILE_VERSION = 1 as const
const MEMORY_MAX = 40
const SWEEP_EVERY_MS = 60 * 60_000
const TIN_RE = /^\d{9}$/

interface Holder {
  /** parsed files by STIR, oldest first (this process is the only writer) */
  files: Map<string, SnapshotFile>
  dir: string | null
  lastSweep: number
}
const g = globalThis as unknown as { __sudSnapshots?: Holder }

export const snapshotDir = (): string => process.env.SNAPSHOT_DIR || config.snapshot.dir || path.join(os.homedir(), '.sud-tizimi', 'snapshots')

function holder(): Holder {
  const h = (g.__sudSnapshots ??= { files: new Map(), dir: null, lastSweep: 0 })
  const dir = snapshotDir()
  if (h.dir !== dir) {
    h.files = new Map()
    h.dir = dir
    h.lastSweep = 0
  }
  return h
}

const fileOf = (tin: string): string => path.join(snapshotDir(), `${tin}.json`)

function load(h: Holder, tin: string): SnapshotFile | null {
  const hit = h.files.get(tin)
  if (hit) return hit
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(fileOf(tin), 'utf8'))
  } catch {
    return null // none yet, or damaged: the next write replaces it
  }
  const f = raw as Partial<SnapshotFile>
  if (!f || f.v !== FILE_VERSION || f.tin !== tin || !f.parts || typeof f.parts !== 'object') return null
  const parts: SnapshotFile['parts'] = {}
  for (const [k, v] of Object.entries(f.parts)) {
    const r = v as Partial<PartRecord> | null
    if (r && typeof r.t === 'number' && Number.isFinite(r.t) && 'd' in r) parts[k as SnapshotPart] = { t: r.t, d: r.d }
  }
  const file: SnapshotFile = { v: FILE_VERSION, tin, parts }
  remember(h, tin, file)
  return file
}

function remember(h: Holder, tin: string, file: SnapshotFile): void {
  h.files.delete(tin)
  h.files.set(tin, file)
  while (h.files.size > MEMORY_MAX) h.files.delete(h.files.keys().next().value as string)
}

function save(file: SnapshotFile): boolean {
  const target = fileOf(file.tin)
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
    const tmp = `${target}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(file), { mode: 0o600 })
    fs.renameSync(tmp, target)
    return true
  } catch (e) {
    console.warn(`[snapshot] could not save ${target}: ${e instanceof Error ? e.message : e}`)
    return false // the answer is still served; it just is not kept
  }
}

/** Delete files nobody refreshed for keepMs (by mtime; every write bumps it). At most once an hour. */
function sweep(h: Holder, now: number, keepMs: number): void {
  if (now - h.lastSweep < SWEEP_EVERY_MS) return
  h.lastSweep = now
  try {
    for (const name of fs.readdirSync(snapshotDir())) {
      const m = /^(\d{9})\.json$/.exec(name)
      if (!m) continue
      const full = path.join(snapshotDir(), name)
      if (now - fs.statSync(full).mtimeMs > keepMs) {
        fs.rmSync(full, { force: true })
        h.files.delete(m[1])
      }
    }
  } catch {
    /* no directory yet */
  }
}

/** What was last stored for a part, however old (up to keepMs). Null when nothing usable. */
export function readSnapshot<T>(tin: string, part: SnapshotPart, now: number = Date.now(), keepMs: number = config.snapshot.keepMs): Snap<T> | null {
  if (!TIN_RE.test(tin)) return null
  const h = holder()
  sweep(h, now, keepMs)
  const r = load(h, tin)?.parts[part]
  if (!r || now - r.t > keepMs) return null
  return { data: r.d as T, fetchedAt: r.t }
}

/** Store a part (replacing the old one). Returns false when the disk refused. */
export function writeSnapshot(tin: string, part: SnapshotPart, data: unknown, now: number = Date.now(), keepMs: number = config.snapshot.keepMs): boolean {
  if (!TIN_RE.test(tin)) return false
  const h = holder()
  const file: SnapshotFile = load(h, tin) ?? { v: 1, tin, parts: {} }
  file.parts[part] = { t: now, d: data }
  for (const [k, r] of Object.entries(file.parts)) if (r && now - r.t > keepMs) delete file.parts[k as SnapshotPart]
  remember(h, tin, file)
  return save(file)
}

/** Forget parts of one company: all of them, or those whose name starts with `prefix` («court:»). */
export function dropSnapshot(tin: string, prefix?: string): void {
  if (!TIN_RE.test(tin)) return
  const h = holder()
  const file = load(h, tin)
  if (!file) return
  if (prefix) {
    for (const k of Object.keys(file.parts)) if (k.startsWith(prefix)) delete file.parts[k as SnapshotPart]
    if (Object.keys(file.parts).length) {
      save(file)
      return
    }
  }
  h.files.delete(tin)
  try {
    fs.rmSync(fileOf(tin), { force: true })
  } catch {
    /* already gone */
  }
}

export interface Served<T> {
  data: T
  /** when the sites answered for this data (ms) */
  fetchedAt: number
  /** true when it came from disk, not from a scrape done for this request */
  fromSnapshot: boolean
  /** the snapshot was past its day and the sites failed, so the old one is shown */
  stale?: boolean
}

export interface ViaSnapshotOpts<T> {
  /** hard refresh: scrape now, replace the snapshot on success, keep it on failure */
  force?: boolean
  /** decide whether an answer is complete enough to keep for a day (default: yes) */
  storable?: (data: T) => boolean
  ttlMs?: number
  keepMs?: number
}

export async function viaSnapshot<T>(tin: string, part: SnapshotPart, opts: ViaSnapshotOpts<T>, produce: () => Promise<T>): Promise<Served<T>> {
  const ttl = opts.ttlMs ?? config.snapshot.ttlMs
  const keep = opts.keepMs ?? config.snapshot.keepMs
  const snap = readSnapshot<T>(tin, part, Date.now(), keep)
  if (!opts.force && snap && Date.now() - snap.fetchedAt < ttl) return { data: snap.data, fetchedAt: snap.fetchedAt, fromSnapshot: true }
  try {
    const data = await produce()
    const at = Date.now()
    if (!opts.storable || opts.storable(data)) writeSnapshot(tin, part, data, at, keep)
    return { data, fetchedAt: at, fromSnapshot: false }
  } catch (e) {
    if (!opts.force && snap) return { data: snap.data, fetchedAt: snap.fetchedAt, fromSnapshot: true, stale: true }
    throw e
  }
}

/** Tests only: drop the in-memory copies (the files are left alone) so the next call reloads from disk. */
export function __resetSnapshotsForTests(): void {
  delete g.__sudSnapshots
}
