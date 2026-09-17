/**
 * v158: Process-wide registry for all OriginHealthPool instances.
 *
 * Every OriginHealthPool registers itself here on construction. The health
 * API endpoint iterates all registered pools to produce a unified dashboard.
 *
 * In dev (bun run dev), Next.js HMR may re-instantiate modules, creating
 * new pool instances. The registry is idempotent on label — if a pool with
 * the same label already exists, it's replaced. This means stats reset on
 * HMR, which is acceptable for dev.
 */

import type { OriginHealthPool } from './cf-worker-pool'

interface RegisteredPool {
  label: string
  pool: OriginHealthPool
}

const _pools: RegisteredPool[] = []

/**
 * Register a health pool. Idempotent on label — re-registering with the
 * same label replaces the old instance (handles HMR).
 */
export function registerHealthPool(label: string, pool: OriginHealthPool): void {
  const idx = _pools.findIndex(p => p.label === label)
  if (idx !== -1) {
    _pools[idx] = { label, pool }
  } else {
    _pools.push({ label, pool })
  }
}

/**
 * Get all registered health pools.
 */
export function getAllHealthPools(): RegisteredPool[] {
  return [..._pools]
}

/**
 * Prune stale worker entries from ALL registered pools.
 * Called when a worker URL is removed from workers.json.
 */
export function pruneAllPools(validWorkerUrls: string[]): void {
  for (const { pool } of _pools) {
    pool.pruneWorkers(validWorkerUrls)
  }
}
