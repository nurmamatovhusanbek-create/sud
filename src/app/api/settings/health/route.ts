/**
 * v158: GET /api/settings/health (history now saved on disk: lib/health-store)
 *
 * Returns aggregated health stats from all registered OriginHealthPool instances.
 * v163: Simplified — only returns pure CF Worker data (no proxies/direct).
 * Removed "allSources" and pool labels — just aggregated worker stats.
 *
 * Response:
 *   {
 *     workers: [{ workerUrl, label, totalRequests, ... }],
 *     summary: { totalRequests, totalSuccesses, totalFailures, ... },
 *     fetchedAt: ISO string
 *   }
 */

import { NextResponse } from 'next/server'
import { getAllHealthPools } from '@/lib/health-registry'
import { getWorkerHistory } from '@/lib/health-store'
import { getCfWorkerUrls } from '@/lib/cf-worker-pool'
import { guard } from '@/server/middleware'
import { snapshotMetrics } from '@/infra/metrics'
import { configSummary } from '@/server/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** one worker, as the Settings page reads it */
interface WorkerOut {
  workerUrl: string
  label: string
  totalRequests: number
  totalSuccesses: number
  totalFailures: number
  consecutiveFailures: number
  successRate: number
  lastResponseTimeMs: number | null
  lastUsedAt: string | null
  lastFailureAt: string | null
  lastFailureReason: string | null
  deadUntil: string | null
  status: 'alive' | 'dead'
  origins: string[]
  /** the last raw requests (saved across restarts) */
  history: Array<{ ts: number; ok: boolean; ms: number; origin: string }>
  /** counts per hour (recent) / per day (older): [start, width, ok, fail, summed ms] — what the 7 kun / 30 kun / Barcha spans read */
  buckets: Array<[number, number, number, number, number]>
}

async function GET_impl() {
  const pools = getAllHealthPools().map(({ pool }) => pool.snapshot())
  const configured = getCfWorkerUrls()

  // live state (cooldowns, last failure) comes from the pools in memory; the numbers come from the saved history,
  // so a restart does not empty the dashboard and a worker that has not been used since still shows up
  const live = new Map<string, { consecutiveFailures: number; lastUsedAt: string | null; lastFailureAt: string | null; lastFailureReason: string | null; deadUntil: string | null; dead: boolean; origins: Set<string>; label: string; lastMs: number | null }>()
  for (const pool of pools) {
    for (const o of pool.origins) {
      for (const w of o.workers) {
        const l = live.get(w.workerUrl) ?? { consecutiveFailures: 0, lastUsedAt: null, lastFailureAt: null, lastFailureReason: null, deadUntil: null, dead: false, origins: new Set<string>(), label: w.label, lastMs: null }
        l.consecutiveFailures = Math.max(l.consecutiveFailures, w.consecutiveFailures)
        if (w.lastUsedAt && (!l.lastUsedAt || w.lastUsedAt > l.lastUsedAt)) l.lastUsedAt = w.lastUsedAt
        if (w.lastFailureAt && (!l.lastFailureAt || w.lastFailureAt > l.lastFailureAt)) { l.lastFailureAt = w.lastFailureAt; l.lastFailureReason = w.lastFailureReason }
        if (w.deadUntil) l.deadUntil = w.deadUntil
        if (w.status === 'dead') l.dead = true
        if (w.lastResponseTimeMs !== null) l.lastMs = w.lastResponseTimeMs
        l.origins.add(o.origin)
        live.set(w.workerUrl, l)
      }
    }
  }

  let totalRequests = 0
  let totalSuccesses = 0
  let totalFailures = 0
  const workers: WorkerOut[] = configured.map((url) => {
    const h = getWorkerHistory(url)
    const l = live.get(url)
    const ok = h.buckets.reduce((a, b) => a + b.ok, 0)
    const fail = h.buckets.reduce((a, b) => a + b.fail, 0)
    totalRequests += ok + fail
    totalSuccesses += ok
    totalFailures += fail
    const last = h.recent[h.recent.length - 1]
    let label: string
    try { label = new URL(url).hostname } catch { label = url.slice(0, 30) }
    const lastUsedAt = [l?.lastUsedAt, last ? new Date(last.ts).toISOString() : null].filter((x): x is string => !!x).sort().pop() ?? null
    return {
      workerUrl: url,
      label: l?.label ?? label,
      totalRequests: ok + fail,
      totalSuccesses: ok,
      totalFailures: fail,
      consecutiveFailures: l?.consecutiveFailures ?? 0,
      successRate: ok + fail > 0 ? ok / (ok + fail) : 0,
      lastResponseTimeMs: l?.lastMs ?? last?.ms ?? null,
      lastUsedAt,
      lastFailureAt: l?.lastFailureAt ?? null,
      lastFailureReason: l?.lastFailureReason ?? null,
      deadUntil: l?.deadUntil ?? null,
      status: l?.dead ? 'dead' : 'alive',
      origins: [...new Set([...h.origins, ...(l?.origins ?? [])])],
      history: h.recent,
      buckets: h.buckets.map((b) => [b.t, b.w, b.ok, b.fail, b.ms]),
    }
  })
  workers.sort((a, b) => b.totalRequests - a.totalRequests)
  const activeWorkers = workers.filter((w) => w.status !== 'dead').length
  const deadWorkers = workers.length - activeWorkers
  const configuredWorkers = new Set(configured)

  return NextResponse.json({
    workers,
    configuredWorkerCount: configuredWorkers.size,
    summary: {
      totalRequests,
      totalSuccesses,
      totalFailures,
      overallSuccessRate: totalRequests > 0 ? totalSuccesses / totalRequests : 0,
      activeWorkers,
      deadWorkers,
      totalWorkers: activeWorkers + deadWorkers,
    },
    // P7 observability: real per-source metrics (requests/success/failure/latency)
    // from the infra metrics registry, plus the redacted boot config.
    sourceMetrics: snapshotMetrics(),
    config: configSummary(),
    fetchedAt: new Date().toISOString(),
  })
}

export const GET = guard(GET_impl)
