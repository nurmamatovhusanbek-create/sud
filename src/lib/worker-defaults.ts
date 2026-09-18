/**
 * v204 (P-A): The single source of truth for built-in default CF Worker URLs.
 *
 * Precedence everywhere: workers.json  ->  CF_WORKER_URLS/CF_WORKER_URL  ->  these.
 * Operators add/remove more via Settings > Workers (persists to workers.json).
 * When you rotate/replace workers, edit ONLY this list.
 */
export const DEFAULT_WORKERS: string[] = [
  'https://broad-field-f2b0.uzwebfox.workers.dev/',
  'https://wild-hall-04ae.uzwebfox.workers.dev/',
  'https://orange-darkness-8843.najimsheikh071.workers.dev/',
  'https://wandering-wind-1d3d.najimsheikh071.workers.dev/',
]
