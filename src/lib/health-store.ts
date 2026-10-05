/**
 * Worker health history that survives a restart.
 *
 * Until now every request record lived only in the pool's memory (a 500-record ring per origin and worker), so the
 * «7 kun / 30 kun / Barcha» spans on Settings → Holat could never reach further back than the last server start
 * (`bun run dev` restarts on every crash and HMR rebuild), nor further than the last 500 requests of a busy worker.
 *
 * What is kept (per worker × origin), written to ONE small JSON file:
 *  - `buckets`: counts per hour (ok · fail · summed ms) for the last HOURLY_DAYS, rolled up into per-day buckets after
 *    that and kept (a day is ~40 bytes), so «Barcha» means all time and a busy day costs no more than a quiet one;
 *  - `recent`: the last RECENT_KEEP raw records, for the drawer's «Soʻnggi soʻrovlar» and the activity bars.
 *
 * Like the orders cache this is deliberate local state, outside the project folder and never deleted by the app
 * (only a worker removed in Settings drops its own history). Server-only: it imports `fs`.
 * File: `~/.sud-tizimi/worker-health.json` (0600), override with `WORKER_HEALTH_FILE`.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addToBucket, rollUp, type Bucket, HOUR_MS } from './health-span'

export interface RecentRecord {
  ts: number
  ok: boolean
  ms: number
  origin: string
}

interface Series {
  buckets: Bucket[]
  recent: RecentRecord[]
}

interface Store {
  /** worker url → origin → series */
  workers: Map<string, Map<string, Series>>
  loadedFrom: string | null
  dirty: boolean
  timer: ReturnType<typeof setTimeout> | null
  exitHooked: boolean
}

export const RECENT_KEEP = 300
export const HOURLY_DAYS = 35
const FLUSH_MS = 15_000
const FILE_VERSION = 1

// one store per process, whichever route bundle imported this module (HMR re-evaluates it)
const g = globalThis as unknown as { __sudHealthStore?: Store }

export const healthFile = (): string => process.env.WORKER_HEALTH_FILE || path.join(os.homedir(), '.sud-tizimi', 'worker-health.json')

function store(): Store {
  const s = (g.__sudHealthStore ??= { workers: new Map(), loadedFrom: null, dirty: false, timer: null, exitHooked: false })
  const file = healthFile()
  if (s.loadedFrom !== file) {
    s.workers = new Map()
    s.loadedFrom = file
    load(s, file)
  }
  if (!s.exitHooked) {
    s.exitHooked = true
    // any exit that runs JS (normal end, Next/Bun handling Ctrl+C, the supervisor's restart): write what is pending.
    // (a hard kill loses at most FLUSH_MS of counts)
    process.once('exit', () => flushNow())
  }
  return s
}

function load(s: Store, file: string): void {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return // no file yet, or a damaged one: start empty (the next flush replaces it)
  }
  const data = raw as { version?: number; workers?: Record<string, Record<string, { b?: unknown; r?: unknown }>> }
  if (!data || data.version !== FILE_VERSION || !data.workers || typeof data.workers !== 'object') return
  for (const [url, origins] of Object.entries(data.workers)) {
    const m = new Map<string, Series>()
    for (const [origin, v] of Object.entries(origins ?? {})) {
      const buckets = (Array.isArray(v?.b) ? v.b : [])
        .filter((x): x is number[] => Array.isArray(x) && x.length === 5 && x.every((n) => Number.isFinite(n)))
        .map(([t, w, ok, fail, ms]) => ({ t, w, ok, fail, ms }))
      const recent = (Array.isArray(v?.r) ? v.r : [])
        .filter((x): x is number[] => Array.isArray(x) && x.length === 3 && x.every((n) => Number.isFinite(n)))
        .map(([ts, ok, ms]) => ({ ts, ok: ok === 1, ms, origin }))
      m.set(origin, { buckets, recent: recent.slice(-RECENT_KEEP) })
    }
    s.workers.set(url, m)
  }
}

function serialize(s: Store): string {
  const workers: Record<string, Record<string, { b: number[][]; r: number[][] }>> = {}
  for (const [url, origins] of s.workers) {
    workers[url] = {}
    for (const [origin, v] of origins) {
      workers[url][origin] = {
        b: v.buckets.map((b) => [b.t, b.w, b.ok, b.fail, b.ms]),
        r: v.recent.slice(-RECENT_KEEP).map((r) => [r.ts, r.ok ? 1 : 0, r.ms]),
      }
    }
  }
  return JSON.stringify({ version: FILE_VERSION, updatedAt: new Date().toISOString(), workers })
}

/** Write now (atomically). Returns false when the disk refused: the history then just stays in memory. */
export function flushNow(): boolean {
  const s = g.__sudHealthStore
  if (!s || !s.dirty) return true
  if (s.timer) {
    clearTimeout(s.timer)
    s.timer = null
  }
  const file = healthFile()
  try {
    // roll old hours up into days before they hit the disk
    for (const origins of s.workers.values()) for (const v of origins.values()) v.buckets = rollUp(v.buckets, Date.now(), HOURLY_DAYS)
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, serialize(s), { mode: 0o600 })
    fs.renameSync(tmp, file)
    s.dirty = false
    return true
  } catch (e) {
    console.warn(`[health-store] could not save ${file}: ${e instanceof Error ? e.message : e}`)
    return false
  }
}

function schedule(s: Store): void {
  s.dirty = true
  if (s.timer) return
  s.timer = setTimeout(() => {
    s.timer = null
    flushNow()
  }, FLUSH_MS)
  s.timer.unref?.() // never keeps the process alive on its own
}

/** Count one request against `workerUrl` × `origin`. */
export function recordRequest(origin: string, workerUrl: string, ok: boolean, ms: number, ts: number = Date.now()): void {
  const s = store()
  let origins = s.workers.get(workerUrl)
  if (!origins) s.workers.set(workerUrl, (origins = new Map()))
  let v = origins.get(origin)
  if (!v) origins.set(origin, (v = { buckets: [], recent: [] }))
  addToBucket(v.buckets, ts, ok, ms)
  v.recent.push({ ts, ok, ms, origin })
  if (v.recent.length > RECENT_KEEP) v.recent.splice(0, v.recent.length - RECENT_KEEP)
  schedule(s)
}

export interface WorkerHistory {
  /** all origins merged, oldest first */
  buckets: Bucket[]
  /** the last raw records of all origins, oldest first */
  recent: RecentRecord[]
  origins: string[]
}

/** The saved history of one worker (empty when it has none). */
export function getWorkerHistory(workerUrl: string): WorkerHistory {
  const origins = store().workers.get(workerUrl)
  if (!origins) return { buckets: [], recent: [], origins: [] }
  const merged = new Map<string, Bucket>()
  const recent: RecentRecord[] = []
  for (const v of origins.values()) {
    for (const b of v.buckets) {
      const k = `${b.w}:${b.t}`
      const m = merged.get(k)
      if (m) { m.ok += b.ok; m.fail += b.fail; m.ms += b.ms } else merged.set(k, { ...b })
    }
    recent.push(...v.recent)
  }
  return {
    buckets: [...merged.values()].sort((a, b) => a.t - b.t),
    recent: recent.sort((a, b) => a.ts - b.ts).slice(-RECENT_KEEP),
    origins: [...origins.keys()],
  }
}

/** Forget workers that are no longer configured (called when one is removed in Settings). */
export function pruneStore(validWorkerUrls: readonly string[]): void {
  const s = store()
  const valid = new Set(validWorkerUrls)
  for (const url of [...s.workers.keys()]) {
    if (!valid.has(url)) {
      s.workers.delete(url)
      schedule(s)
    }
  }
}

/** Tests only: drop the in-memory state (the file is left alone) so the next call reloads it. */
export function __resetHealthStoreForTests(): void {
  const s = g.__sudHealthStore
  if (s?.timer) clearTimeout(s.timer)
  g.__sudHealthStore = undefined
}

export { HOUR_MS }
