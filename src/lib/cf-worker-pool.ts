/**
 * v150 P3: Unified CF Worker proxy pool.
 * v158: Added file-based persistence (workers.json), full health stats tracking,
 * and process-wide health registry for the Settings dashboard.
 *
 * Replaces 5 duplicate copies of the same CF_WORKER_URLS parsing + round-robin
 * logic across billing.ts, chamber.ts, court-case.ts, jadval2.ts, orginfo.ts.
 *
 * Each caller gets its own independent round-robin counter via createWorkerPool(),
 * preserving the current behavior where each module rotates independently.
 */

import { getWorkerUrls, getWorkerSource } from './workers-config'
import { registerHealthPool } from './health-registry'
import { DEFAULT_WORKERS } from './worker-defaults'

// v204 (P-A): the 4 default workers now live in worker-defaults.ts — the
// single home for hardcoded worker URLs — so cf-worker-pool, workers-config
// seeding and billing.ts can never disagree again. getCfWorkerUrls() below is
// THE one resolver: workers.json → CF_WORKER_URLS → CF_WORKER_URL → defaults.
export const FALLBACK_WORKERS: string[] = DEFAULT_WORKERS

/**
 * Parse CF_WORKER_URLS (comma-separated) + CF_WORKER_URL (single, backward compat).
 * v158: Now checks workers.json FIRST, then env, then FALLBACK_WORKERS.
 */
export function getCfWorkerUrls(): string[] {
  // v158: Check workers.json first
  const fileUrls = getWorkerUrls()
  if (fileUrls.length > 0) return fileUrls

  // Fall back to env
  const urls: string[] = []
  const multi = process.env.CF_WORKER_URLS
  if (multi) {
    for (const u of multi.split(',').map(s => s.trim()).filter(Boolean)) {
      urls.push(u.endsWith('/') ? u : u + '/')
    }
  }
  const single = process.env.CF_WORKER_URL
  if (single) {
    const normalized = single.endsWith('/') ? single : single + '/'
    if (!urls.includes(normalized)) urls.push(normalized)
  }
  return urls.length > 0 ? urls : [...FALLBACK_WORKERS]
}

/** Get the source of worker URLs ('file' | 'env' | 'fallback'). */
export function getWorkerSourceStr(): 'file' | 'env' | 'fallback' {
  return getWorkerSource()
}

/** Create an independent worker pool with its own round-robin counter. */
export function createWorkerPool() {
  let counter = 0

  /** Get the next worker URL (round-robin) prepended to the target URL. */
  function nextProxyUrl(targetUrl: string): string {
    const workers = getCfWorkerUrls()
    const worker = workers[counter % workers.length]
    counter++
    return worker + targetUrl
  }

  /** Get ALL worker URLs for the target (for parallel race). */
  function getAllProxyUrls(targetUrl: string): string[] {
    const workers = getCfWorkerUrls()
    return workers.map(w => w + targetUrl)
  }

  return { nextProxyUrl, getAllProxyUrls, getCfWorkerUrls }
}

// ---- OriginHealthPool: health-tracked worker selection for PARALLEL races ----
//
// billing.ts has a `ProxyPool` that tracks per-proxy success/failure and skips
// proxies that have failed repeatedly — proven to cut a 60-bill lookup from
// ~800s to ~150s by not wasting time retrying known-dead proxies. That pool is
// built for a SEQUENTIAL "pick one proxy, retry on fail" strategy (best for
// high-volume loops).
//
// court-case.ts instead fires ALL workers in PARALLEL for a single company
// lookup (best for latency + completeness on one request), so the same idea
// is adapted here: instead of picking ONE proxy, getRaceCandidates() returns
// the SUBSET of workers worth firing in parallel this time, excluding ones
// currently in a cooldown against THIS SPECIFIC origin (a worker can be fine
// for jadvalapi.sud.uz but blocked by jadval.sud.uz, or vice versa — health is
// tracked per origin+worker pair, not just per worker).
//
// v158: Extended with total request counts, response timing, last-failure
// reason, and a snapshot() method for the Settings dashboard. Also auto-
// registers with health-registry.ts so the /api/settings/health endpoint
// can enumerate all pools.

export interface RequestRecord {
  ts: number // timestamp
  ok: boolean
  ms: number // response time
  origin: string
}

export interface WorkerHealthState {
  label: string
  // Consecutive (resets on success) — drives dead/cooldown
  failures: number
  successes: number
  lastFailureAt: number
  deadUntil: number // 0 = alive; timestamp = retry allowed after this time

  // v158: Totals (never reset) — for the dashboard
  totalRequests: number
  totalSuccesses: number
  totalFailures: number
  lastResponseTimeMs: number | null
  lastUsedAt: number // timestamp of last getRaceCandidates touch OR outcome record
  lastFailureReason: string | null

  // v167: Ring buffer of recent request records for time-series charts
  history: RequestRecord[]
}

export class OriginHealthPool {
  private states = new Map<string, WorkerHealthState>()
  private static readonly DEAD_THRESHOLD = 3 // mark dead after 3 consecutive failures
  private static readonly DEAD_COOLDOWN_MS = 45_000 // skip dead workers for 45s
  private static readonly MAX_HISTORY = 500 // v167: ring buffer size for time-series

  constructor(private readonly poolLabel: string) {
    // v158: Auto-register with the health registry
    registerHealthPool(poolLabel, this)
  }

  private key(originKey: string, workerUrl: string): string {
    return `${originKey}::${workerUrl}`
  }

  private stateFor(originKey: string, workerUrl: string): WorkerHealthState {
    const k = this.key(originKey, workerUrl)
    let s = this.states.get(k)
    if (!s) {
      let label: string
      try { label = new URL(workerUrl).hostname } catch { label = workerUrl.slice(0, 30) }
      s = {
        label,
        failures: 0,
        successes: 0,
        lastFailureAt: 0,
        deadUntil: 0,
        totalRequests: 0,
        totalSuccesses: 0,
        totalFailures: 0,
        lastResponseTimeMs: null,
        lastUsedAt: 0,
        lastFailureReason: null,
        history: [], // v167: ring buffer for time-series
      }
      this.states.set(k, s)
    }
    return s
  }

  /** v167: Push a request record to the history ring buffer. */
  private pushHistory(s: WorkerHealthState, origin: string, ok: boolean, ms: number): void {
    s.history.push({ ts: Date.now(), ok, ms, origin })
    // Trim to max size (ring buffer)
    if (s.history.length > OriginHealthPool.MAX_HISTORY) {
      s.history.shift()
    }
  }

  /** The workers worth firing in parallel for `originKey` right now. Never
   *  returns an empty array — see class doc for the fail-open rationale. */
  getRaceCandidates(originKey: string, workerUrls: string[]): string[] {
    const now = Date.now()
    const withState = workerUrls.map(u => ({ url: u, state: this.stateFor(originKey, u) }))
    for (const { state } of withState) {
      if (state.deadUntil > 0 && state.deadUntil < now) {
        state.deadUntil = 0
        state.failures = 0
      }
      state.lastUsedAt = now
    }
    const alive = withState.filter(w => w.state.deadUntil === 0)
    if (alive.length > 0) return alive.map(w => w.url)
    console.log(`[${this.poolLabel}] all ${workerUrls.length} workers were in cooldown for ${originKey} — reviving all for this lookup`)
    for (const { state } of withState) { state.deadUntil = 0; state.failures = 0 }
    return workerUrls
  }

  /** Call when a worker successfully reaches the origin — including a clean
   *  404 "not found", which proves the path works even with no data.
   *  v158: Now also tracks total requests, response time, and last-used. */
  markSuccess(originKey: string, workerUrl: string): void {
    this.recordSuccess(originKey, workerUrl, 0)
  }

  /** v158: Record a success with response timing. */
  recordSuccess(originKey: string, workerUrl: string, responseMs: number): void {
    const s = this.stateFor(originKey, workerUrl)
    s.successes++
    s.failures = 0
    s.deadUntil = 0
    s.totalRequests++
    s.totalSuccesses++
    s.lastResponseTimeMs = responseMs
    s.lastUsedAt = Date.now()
    this.pushHistory(s, originKey, true, responseMs) // v167
  }

  /** Call on a transport-level failure (timeout, 5xx/521, parse error).
   *  v158: Now also tracks total requests, response time, and failure reason. */
  markFailed(originKey: string, workerUrl: string): void {
    this.recordFailure(originKey, workerUrl, 0, 'unknown')
  }

  /** v158: Record a failure with response timing and reason. */
  recordFailure(originKey: string, workerUrl: string, responseMs: number, reason: string): void {
    const s = this.stateFor(originKey, workerUrl)
    s.failures++
    s.lastFailureAt = Date.now()
    s.lastFailureReason = reason
    s.totalRequests++
    s.totalFailures++
    s.lastResponseTimeMs = responseMs
    s.lastUsedAt = Date.now()
    this.pushHistory(s, originKey, false, responseMs) // v167
    if (s.failures >= OriginHealthPool.DEAD_THRESHOLD && s.deadUntil === 0) {
      s.deadUntil = Date.now() + OriginHealthPool.DEAD_COOLDOWN_MS
      console.log(`[${this.poolLabel}] ${s.label} marked DEAD for ${originKey} for ${OriginHealthPool.DEAD_COOLDOWN_MS / 1000}s (${s.failures} consecutive failures)`)
    }
  }

  /** Human-readable health snapshot for a given origin, for debug logging. */
  stats(originKey: string): string {
    const entries = [...this.states.entries()].filter(([k]) => k.startsWith(`${originKey}::`))
    if (entries.length === 0) return 'no data yet'
    return entries
      .map(([, s]) => `${s.label}:${s.successes}\u2713/${s.failures}\u2717${s.deadUntil > Date.now() ? ' DEAD' : ''}`)
      .join(' | ')
  }

  /** v158: Serializable snapshot of ALL health data, for the Settings dashboard. */
  snapshot() {
    const origins = new Map<string, any[]>()

    for (const [key, s] of this.states) {
      const [origin, workerUrl] = key.split('::')
      if (!origins.has(origin)) origins.set(origin, [])
      const now = Date.now()
      origins.get(origin)!.push({
        workerUrl,
        label: s.label,
        totalRequests: s.totalRequests,
        totalSuccesses: s.totalSuccesses,
        totalFailures: s.totalFailures,
        consecutiveFailures: s.failures,
        successRate: s.totalRequests > 0 ? s.totalSuccesses / s.totalRequests : 0,
        lastResponseTimeMs: s.lastResponseTimeMs,
        lastUsedAt: s.lastUsedAt > 0 ? new Date(s.lastUsedAt).toISOString() : null,
        lastFailureAt: s.lastFailureAt > 0 ? new Date(s.lastFailureAt).toISOString() : null,
        lastFailureReason: s.lastFailureReason,
        deadUntil: s.deadUntil > now ? new Date(s.deadUntil).toISOString() : null,
        status: s.deadUntil > now ? 'dead' : 'alive',
        history: s.history, // v167: include request history for time-series
      })
    }

    const originsArray = [...origins.entries()].map(([origin, workers]) => {
      const totals = workers.reduce(
        (acc, w) => ({
          requests: acc.requests + w.totalRequests,
          successes: acc.successes + w.totalSuccesses,
          failures: acc.failures + w.totalFailures,
        }),
        { requests: 0, successes: 0, failures: 0 },
      )
      return {
        origin,
        workers,
        totals: {
          ...totals,
          successRate: totals.requests > 0 ? totals.successes / totals.requests : 0,
        },
      }
    })

    return {
      label: this.poolLabel,
      origins: originsArray,
    }
  }

  /** v158: Remove health entries for workers no longer in the pool. */
  pruneWorkers(validWorkerUrls: string[]): void {
    const validSet = new Set(validWorkerUrls)
    for (const [key] of this.states) {
      const [, workerUrl] = key.split('::')
      if (!validSet.has(workerUrl)) {
        this.states.delete(key)
      }
    }
  }
}
