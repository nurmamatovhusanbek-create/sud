import 'server-only'
import { getCfWorkerUrls, OriginHealthPool } from '@/lib/cf-worker-pool'

/**
 * v206 — Worker Firing Sequence (rate-limit fix).
 *
 * Problem this replaces: every scraper (court-case, chamber, billing, jadval2)
 * built `getCfWorkerUrls().map(fetch)` and fired ALL workers for ALL jobs at
 * once. One company open burst ~40-60 concurrent requests over 3-4 origins,
 * each worker took ~7-10 simultaneous hits, Cloudflare + the sud/chamber
 * origins throttled, OriginHealthPool marked workers dead, everything retried
 * across 3 tiers, and the burst repeated.
 *
 * Strategy — hedge, don't flood:
 *   1. Health-ordered selection: try the BEST worker first (fewest recent
 *      failures, not in cooldown, least in-flight) — not all of them.
 *   2. Hedging: fire ONE request; only if it hasn't answered within `hedgeMs`
 *      fire a second to the next-best worker, capped at `maxAttempts`. First
 *      good response wins; the rest are aborted. A dead worker is still
 *      covered — you just stop paying 6× for every call.
 *   3. Bounded concurrency: global semaphore + per-worker cap + per-origin
 *      cap + per-origin minimum spacing — across ALL jobs, not just one.
 *   4. Priority lanes: live user lookups run in `interactive`; jadval2 scans
 *      run in `background` and yield, so a scan never starves a live search.
 *
 * Net effect: a court search goes from ~6 requests/endpoint to ~1-2, the
 * per-open burst drops to ~10-12 well-spaced requests, and rate-limit deaths
 * stop. All rate control lives in THIS file — future tuning is one place.
 *
 * Deviations from the pasted guide (both required, behavior-preserving):
 *   - `method` + `body` options: billing's PoW/captcha endpoints are POSTs
 *     routed through the same workers (proxy.js forwards method/body), so
 *     the scheduler must support them or billing can't use the one choke point.
 *   - Every attempt's outcome is recorded into a shared OriginHealthPool
 *     ('worker-fetch') so the Settings › Holat dashboard keeps showing
 *     per-worker health for scheduler traffic.
 */

// ---------------- tunables (env-overridable) ----------------
// v208 (API limits report): the worker pool (workers.json) now has 6 workers,
// not the 4 this was originally tuned against — GLOBAL_MAX matches PER_WORKER_MAX
// × pool size (6 × 2 = 12) so the global cap and real capacity stay pinned
// equal, per the report's §2 finding (raising one without the other did nothing).
const GLOBAL_MAX = int('NET_GLOBAL_MAX', 12) // total in-flight worker reqs (interactive)
const BACKGROUND_MAX = int('NET_BACKGROUND_MAX', 3) // total in-flight for background scans
const PER_WORKER_MAX = int('NET_PER_WORKER_MAX', 2) // in-flight per worker URL
const PER_ORIGIN_MAX = int('NET_PER_ORIGIN_MAX', 4) // in-flight per origin host — conservative default (jadval.sud.uz's per-TIN bucket + billing.sud.uz's PoW gate punish concurrency)
const ORIGIN_SPACING = int('NET_ORIGIN_SPACING_MS', 120) // min ms between reqs to one origin — conservative default

// v208: jadvalapi.sud.uz is confirmed open/unauthenticated/per-TIN-independent
// (live probe in the API limits report — different TINs and repeated calls all
// succeeded with no throttling). It is NOT a bottleneck, so it doesn't need the
// jadval.sud.uz/billing.sud.uz conservative pacing above — loosen only it.
// jadval.sud.uz keeps ORIGIN_SPACING/PER_ORIGIN_MAX: it runs a per-TIN token
// bucket, so more concurrency there burns quota instead of buying speed.
const OPEN_ORIGINS = new Set(list('NET_OPEN_ORIGINS', ['jadvalapi.sud.uz']))
const OPEN_ORIGIN_MAX = int('NET_PER_ORIGIN_MAX_OPEN', 6)
const OPEN_ORIGIN_SPACING = int('NET_ORIGIN_SPACING_MS_OPEN', 60)

const DEAD_COOLDOWN = int('NET_DEAD_COOLDOWN_MS', 30_000)
const DEAD_THRESHOLD = int('NET_DEAD_THRESHOLD', 3)

function int(k: string, d: number) {
  const v = Number(process.env[k])
  return Number.isFinite(v) && v > 0 ? v : d
}

function list(k: string, d: string[]): string[] {
  const v = process.env[k]
  if (!v) return d
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36'

// ---------------- tiny async semaphore ----------------
class Sem {
  private cur = 0
  private q: (() => void)[] = []
  constructor(private max: number) {}
  async acquire() {
    if (this.cur < this.max) {
      this.cur++
      return
    }
    await new Promise<void>((r) => this.q.push(r))
    this.cur++
  }
  release() {
    this.cur--
    this.q.shift()?.()
  }
}
const interactive = new Sem(GLOBAL_MAX)
const background = new Sem(BACKGROUND_MAX)
const perWorkerSem = new Map<string, Sem>()
const perOriginSem = new Map<string, Sem>()
function wSem(u: string) {
  let s = perWorkerSem.get(u)
  if (!s) {
    s = new Sem(PER_WORKER_MAX)
    perWorkerSem.set(u, s)
  }
  return s
}
function oSem(o: string) {
  let s = perOriginSem.get(o)
  if (!s) {
    s = new Sem(OPEN_ORIGINS.has(o) ? OPEN_ORIGIN_MAX : PER_ORIGIN_MAX)
    perOriginSem.set(o, s)
  }
  return s
}

// ---------------- per-origin spacing ----------------
const originNextAt = new Map<string, number>()
async function space(origin: string) {
  const spacing = OPEN_ORIGINS.has(origin) ? OPEN_ORIGIN_SPACING : ORIGIN_SPACING
  const now = Date.now()
  const next = Math.max(now, originNextAt.get(origin) ?? 0)
  originNextAt.set(origin, next + spacing)
  const wait = next - now
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
}

// ---------------- worker health (local, for ordering) ----------------
interface WState {
  fails: number
  deadUntil: number
  inFlight: number
  lastMs: number
}
const wstate = new Map<string, WState>()
function st(u: string): WState {
  let s = wstate.get(u)
  if (!s) {
    s = { fails: 0, deadUntil: 0, inFlight: 0, lastMs: 0 }
    wstate.set(u, s)
  }
  return s
}
function recordOk(u: string, ms: number) {
  const s = st(u)
  s.fails = 0
  s.deadUntil = 0
  s.lastMs = ms
}
function recordFail(u: string) {
  const s = st(u)
  s.fails++
  if (s.fails >= DEAD_THRESHOLD) s.deadUntil = Date.now() + DEAD_COOLDOWN
}

/**
 * Health-ordered worker list: alive first, then by (inFlight, fails, lastMs).
 * Fail-open: everyone cooling down → try all.
 */
function orderedWorkers(): string[] {
  const now = Date.now()
  const all = getCfWorkerUrls()
  const alive = all.filter((u) => st(u).deadUntil <= now)
  const pool = alive.length ? alive : all
  return [...pool].sort((a, b) => {
    const A = st(a)
    const B = st(b)
    return A.inFlight - B.inFlight || A.fails - B.fails || A.lastMs - B.lastMs
  })
}

// ---------------- dashboard health (shared OriginHealthPool) ----------------
// One pool for ALL scheduler traffic; the Settings › Holat endpoint enumerates
// registered pools, so per-worker success/failure/latency stays visible.
const healthPool = new OriginHealthPool('worker-fetch')

// ---------------- options ----------------
export interface WorkerFetchOptions {
  /** Rate/health bucket; default = target hostname. */
  originKey?: string
  headers?: Record<string, string>
  /** HTTP method (default GET). POST needed for billing's PoW/captcha flow. */
  method?: string
  /** Request body (string — the scrapers only ever send JSON strings). */
  body?: string
  /** Per attempt (default 12000). */
  timeoutMs?: number
  /** Escalate to next worker after this (default 800). */
  hedgeMs?: number
  /** Cap on worker attempts (default 3). */
  maxAttempts?: number
  /** Lane: default interactive; background scans yield to live lookups. */
  priority?: 'interactive' | 'background'
}
function hostOf(t: string) {
  try {
    return new URL(t).hostname
  } catch {
    return t
  }
}

/** A worker "worked" if it reached the origin — 2xx/3xx and definitive 4xx count.
 *  Only >=500 / network / timeout mean the worker or origin failed → hedge/failover. */
function workerReached(status: number) {
  return status < 500
}

async function attempt(
  worker: string,
  target: string,
  origin: string,
  opts: WorkerFetchOptions,
  outerSignal: AbortSignal,
): Promise<Response> {
  const lane = opts.priority === 'background' ? background : interactive
  await lane.acquire()
  const ws = wSem(worker)
  const os = oSem(origin)
  await ws.acquire()
  await os.acquire()
  const s = st(worker)
  s.inFlight++
  const t0 = Date.now()

  // v206 fix: chain the outer (scheduler) signal through a PER-ATTEMPT
  // controller instead of AbortSignal.any([outer, timeout]). Why: the fetch
  // promise resolves at HEADERS while the body keeps streaming. On success
  // the scheduler aborts the LOSER attempts — with a shared composite that
  // abort also killed the winner's in-flight body, so the caller's
  // res.text() threw AbortError (reproduced on Node 24 + Bun 1.3). Here the
  // outer→own link is removed the moment this attempt settles, so aborting
  // losers can never touch the winner's body.
  const own = new AbortController()
  const onOuterAbort = () => own.abort(outerSignal.reason)
  if (outerSignal.aborted) onOuterAbort()
  else outerSignal.addEventListener('abort', onOuterAbort, { once: true })

  const init: RequestInit = {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': UA,
      Origin: 'https://my.sud.uz',
      Referer: 'https://my.sud.uz/',
      ...opts.headers,
    },
    signal: AbortSignal.any([own.signal, AbortSignal.timeout(opts.timeoutMs ?? 12_000)]),
  }
  if (opts.method) init.method = opts.method
  if (opts.body !== undefined) init.body = opts.body
  try {
    await space(origin)
    if (process.env.NET_DEBUG === '1') console.error(`[dbg] attempt ${hostOf(worker)} → ${origin} fired`)
    const res = await fetch(worker + target, init)
    const ms = Date.now() - t0
    if (!workerReached(res.status)) {
      recordFail(worker)
      healthPool.recordFailure(origin, worker, ms, `HTTP ${res.status}`)
      throw new Error(`HTTP ${res.status}`)
    }
    recordOk(worker, ms)
    // 404 still proves the worker reached the origin — record as success
    // (mirrors OriginHealthPool's "definitive not-found = healthy" rule).
    if (res.ok || res.status === 404) healthPool.recordSuccess(origin, worker, ms)
    return res
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) {
      recordFail(worker)
      const ms = Date.now() - t0
      const isTimeout = e instanceof DOMException && e.name === 'TimeoutError'
      healthPool.recordFailure(origin, worker, ms, isTimeout ? 'timeout' : (e as Error)?.message?.slice(0, 100) || 'error')
    }
    throw e
  } finally {
    // Detach from the scheduler-level abort — the winner's body survives it.
    outerSignal.removeEventListener('abort', onOuterAbort)
    s.inFlight--
    os.release()
    ws.release()
    lane.release()
  }
}

/**
 * Fetch `target` through a CF worker with hedged escalation + shared limits.
 * Returns the first Response whose worker reached the origin (incl. 404).
 * Throws AggregateError only if every attempt failed at transport level.
 */
export async function fetchViaWorkers(target: string, opts: WorkerFetchOptions = {}): Promise<Response> {
  const origin = opts.originKey ?? hostOf(target)
  const order = orderedWorkers()
  const maxAttempts = Math.max(1, Math.min(opts.maxAttempts ?? 3, order.length || 1))
  const hedgeMs = opts.hedgeMs ?? 800
  const abort = new AbortController()
  const active = new Set<Promise<Response>>()
  const errors: unknown[] = []
  let idx = 0

  const startOne = () => {
    const worker = order[idx % order.length]
    idx++
    const p = attempt(worker, target, origin, opts, abort.signal)
    active.add(p)
    p.catch(() => {}).finally(() => active.delete(p))
    return p
  }

  startOne()
  const DBG = process.env.NET_DEBUG === '1'
  for (;;) {
    let hedgeT: ReturnType<typeof setTimeout> | undefined
    const racers: Promise<Response | 'HEDGE'>[] = [...active]
    if (DBG) console.error(`[dbg] loop active=${active.size} idx=${idx} max=${maxAttempts}`)
    if (idx < maxAttempts) racers.push(new Promise<'HEDGE'>((r) => { hedgeT = setTimeout(() => r('HEDGE'), hedgeMs) }))
    let outcome: Response | 'HEDGE'
    try {
      outcome = await Promise.race(racers)
    } catch (e) {
      clearTimeout(hedgeT!)
      if (DBG) console.error(`[dbg] race rejected: ${(e as Error)?.name} active=${active.size} idx=${idx}`)
      errors.push(e)
      if (active.size === 0) {
        if (idx < maxAttempts) {
          startOne()
          continue
        }
        abort.abort()
        throw new AggregateError(errors, `all ${idx} worker attempts failed for ${origin}`)
      }
      continue // other attempts still racing
    }
    clearTimeout(hedgeT!)
    if (outcome === 'HEDGE') {
      if (DBG) console.error(`[dbg] hedge fired, idx=${idx}`)
      if (idx < maxAttempts) startOne()
      continue
    }
    if (DBG) console.error(`[dbg] success → abort others`)
    abort.abort() // success — cancel the other hedges
    return outcome
  }
}

/** Convenience: fetch + JSON parse (the common scraper shape). */
export async function fetchJsonViaWorkers<T = unknown>(
  target: string,
  opts?: WorkerFetchOptions,
): Promise<{ status: number; data: T | null }> {
  const res = await fetchViaWorkers(target, opts)
  if (!res.ok) return { status: res.status, data: null } // e.g. 404 not-found — caller decides
  const text = await res.text()
  try {
    return { status: res.status, data: JSON.parse(text) as T }
  } catch {
    return { status: res.status, data: null }
  }
}
