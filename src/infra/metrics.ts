/**
 * Per-source metrics — P2 of the rebuild blueprint (§3.8).
 *
 * The health pools already track per-worker health; this adds the missing
 * per-SOURCE request/success/failure/latency counters so the Health dashboard
 * shows real signal instead of nothing. In-memory (single-node runtime target).
 */

export interface SourceMetric {
  requests: number
  successes: number
  failures: number
  lastError: string | null
  lastErrorAt: number | null
  lastSuccessAt: number | null
  latencyMsSum: number
  latencyMsMax: number
}

const metrics = new Map<string, SourceMetric>()

function entry(source: string): SourceMetric {
  let m = metrics.get(source)
  if (!m) {
    m = { requests: 0, successes: 0, failures: 0, lastError: null, lastErrorAt: null, lastSuccessAt: null, latencyMsSum: 0, latencyMsMax: 0 }
    metrics.set(source, m)
  }
  return m
}

export function recordSuccess(source: string, latencyMs: number): void {
  const m = entry(source)
  m.requests++
  m.successes++
  m.latencyMsSum += latencyMs
  m.latencyMsMax = Math.max(m.latencyMsMax, latencyMs)
  m.lastSuccessAt = Date.now()
}

export function recordFailure(source: string, error: string, latencyMs = 0): void {
  const m = entry(source)
  m.requests++
  m.failures++
  m.latencyMsSum += latencyMs
  m.lastError = error.slice(0, 300)
  m.lastErrorAt = Date.now()
}

export type SourceHealth = 'healthy' | 'degraded' | 'dead' | 'unknown'

export function sourceHealth(source: string): SourceHealth {
  const m = metrics.get(source)
  if (!m || m.requests === 0) return 'unknown'
  const rate = m.successes / m.requests
  if (rate >= 0.9) return 'healthy'
  if (rate >= 0.5) return 'degraded'
  return 'dead'
}

export function snapshotMetrics(): Record<string, SourceMetric & { health: SourceHealth; avgLatencyMs: number }> {
  const out: Record<string, SourceMetric & { health: SourceHealth; avgLatencyMs: number }> = {}
  for (const [k, m] of metrics) {
    out[k] = {
      ...m,
      health: sourceHealth(k),
      avgLatencyMs: m.requests ? Math.round(m.latencyMsSum / m.requests) : 0,
    }
  }
  return out
}

/** Time an async source call, feeding success/failure metrics automatically. */
export async function timed<T>(source: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now()
  try {
    const v = await fn()
    recordSuccess(source, Date.now() - t0)
    return v
  } catch (e) {
    recordFailure(source, e instanceof Error ? e.message : String(e), Date.now() - t0)
    throw e
  }
}
