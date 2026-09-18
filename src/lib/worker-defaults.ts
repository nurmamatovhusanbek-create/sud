/**
 * Single source of truth for the DEFAULT CF Worker proxy pool.
 *
 * Every worker-URL consumer (cf-worker-pool.ts FALLBACK_WORKERS,
 * workers-config.ts seeding, and transitively billing.ts via the shared
 * getCfWorkerUrls()) resolves defaults through this module. No other file
 * may hardcode worker URLs.
 *
 * These are the operator's own workers — deploy/replace via the Workers
 * settings UI (persisted to workers.json) or CF_WORKER_URLS env.
 */

export const DEFAULT_WORKERS: string[] = [
  'https://broad-field-f2b0.uzwebfox.workers.dev/',
  'https://wild-hall-04ae.uzwebfox.workers.dev/',
  'https://orange-darkness-8843.najimsheikh071.workers.dev/',
  'https://wandering-wind-1d3d.najimsheikh071.workers.dev/',
]
