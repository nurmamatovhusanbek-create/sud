/**
 * Single source of truth for the DEFAULT CF Worker proxy pool.
 *
 * Every worker-URL consumer (cf-worker-pool.ts FALLBACK_WORKERS,
 * workers-config.ts seeding, and transitively billing.ts via the shared
 * getCfWorkerUrls()) resolves defaults through this module. No other file
 * may hardcode worker URLs.
 *
 * These are workers the operator controls or trusts (confirmed by the owner, Nov 2026): three Cloudflare accounts,
 * `nurmamatovhusanbek`, `uzwebfox` and `najimsheikh071`. A worker sees every request in plaintext and can forge answers, so a
 * worker on any OTHER account is flagged in Settings › Workerlar (core/worker-trust.ts). Add accounts you trust with
 * TRUSTED_WORKER_ACCOUNTS=acc1,acc2. Deploy/replace via the Workers settings UI (persisted to workers.json) or CF_WORKER_URLS.
 */

export const DEFAULT_WORKERS: string[] = [
  'https://broad-field-f2b0.uzwebfox.workers.dev/',
  'https://wild-hall-04ae.uzwebfox.workers.dev/',
  'https://orange-darkness-8843.najimsheikh071.workers.dev/',
  'https://wandering-wind-1d3d.najimsheikh071.workers.dev/',
  'https://shiny-darkness-4a1f.nurmamatovhusanbek.workers.dev/',
  'https://blue-haze-3834.nurmamatovhusanbek.workers.dev/',
]
