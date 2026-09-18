import 'server-only'
import { Pool } from 'pg'

/**
 * Postgres pool for the docket index (name-based case discovery).
 *
 * The index is OPTIONAL: when DATABASE_URL is unset, docketEnabled() is false
 * and every consumer degrades gracefully — live TIN search still works, the
 * crawler no-ops, name discovery is simply skipped (guide §8).
 */

let _pool: Pool | null = null

export function db(): Pool {
  if (_pool) return _pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set (docket index requires Postgres)')
  }
  _pool = new Pool({ connectionString, max: 8, idleTimeoutMillis: 30_000 })
  return _pool
}

/** True when the index is configured. Callers degrade gracefully when false.
 *  v205 hardening: only a REAL postgres URL enables the index — some hosts
 *  ship placeholder DATABASE_URLs (e.g. `file:...` from SQLite scaffolds) that
 *  pg cannot dial; treating those as "not configured" keeps every consumer on
 *  the graceful no-index path instead of spewing connection errors. */
export function docketEnabled(): boolean {
  const u = process.env.DATABASE_URL
  return !!u && /^postgres(ql)?:\/\//.test(u)
}
