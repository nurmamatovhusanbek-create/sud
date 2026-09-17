/**
 * v158: GET /api/settings/health
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
import { getCfWorkerUrls } from '@/lib/cf-worker-pool'
import { guard } from '@/server/middleware'
import { snapshotMetrics } from '@/infra/metrics'
import { configSummary } from '@/server/config'

async function GET_impl() {
  const pools = getAllHealthPools()
  const poolsData = pools.map(({ label, pool }) => pool.snapshot())

  // Get all configured worker URLs (to filter out non-worker entries)
  const configuredWorkers = new Set(getCfWorkerUrls())

  // Aggregate per-worker stats across all origins
  const workerAggregates = new Map<string, {
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
    history: Array<{ ts: number; ok: boolean; ms: number; origin: string }>
  }>()

  let totalRequests = 0
  let totalSuccesses = 0
  let totalFailures = 0
  let activeWorkers = 0
  let deadWorkers = 0

  for (const pool of poolsData) {
    for (const originData of pool.origins) {
      for (const w of originData.workers) {
        // Only count actual CF Workers (not "direct" or CORS proxies)
        if (!configuredWorkers.has(w.workerUrl)) continue

        totalRequests += w.totalRequests
        totalSuccesses += w.totalSuccesses
        totalFailures += w.totalFailures

        const existing = workerAggregates.get(w.workerUrl) || {
          workerUrl: w.workerUrl,
          label: w.label,
          totalRequests: 0,
          totalSuccesses: 0,
          totalFailures: 0,
          consecutiveFailures: 0,
          successRate: 0,
          lastResponseTimeMs: null as number | null,
          lastUsedAt: null as string | null,
          lastFailureAt: null as string | null,
          lastFailureReason: null as string | null,
          deadUntil: null as string | null,
          status: 'alive' as 'alive' | 'dead',
          origins: [] as string[],
          history: [] as Array<{ ts: number; ok: boolean; ms: number; origin: string }>,
        }

        existing.totalRequests += w.totalRequests
        existing.totalSuccesses += w.totalSuccesses
        existing.totalFailures += w.totalFailures
        if (w.consecutiveFailures > existing.consecutiveFailures) existing.consecutiveFailures = w.consecutiveFailures
        existing.successRate = existing.totalRequests > 0 ? existing.totalSuccesses / existing.totalRequests : 0
        if (w.lastResponseTimeMs !== null) existing.lastResponseTimeMs = w.lastResponseTimeMs
        if (w.lastUsedAt && (!existing.lastUsedAt || w.lastUsedAt > existing.lastUsedAt)) existing.lastUsedAt = w.lastUsedAt
        if (w.lastFailureAt && (!existing.lastFailureAt || w.lastFailureAt > existing.lastFailureAt)) existing.lastFailureAt = w.lastFailureAt
        // v167: Merge history arrays
        if (w.history && Array.isArray(w.history)) {
          existing.history.push(...w.history)
        }
        if (w.lastFailureReason) existing.lastFailureReason = w.lastFailureReason
        if (w.deadUntil) existing.deadUntil = w.deadUntil
        if (w.status === 'dead') existing.status = 'dead'
        if (!existing.origins.includes(originData.origin)) existing.origins.push(originData.origin)

        workerAggregates.set(w.workerUrl, existing)
      }
    }
  }

  const workers = [...workerAggregates.values()].sort((a, b) => b.totalRequests - a.totalRequests)

  for (const w of workers) {
    if (w.status === 'dead') deadWorkers++
    else activeWorkers++
  }

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
