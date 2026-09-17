/**
 * Central, typed configuration surface — P0 of the rebuild blueprint.
 *
 * WHY: before this file, the only env vars were CF_WORKER_URL(S), NODE_ENV and
 * APP_GIT_SHA; every other operational knob (timeouts, retry tiers, cache TTLs,
 * dead-worker thresholds, the VLM/captcha key, the alert window) was hardcoded
 * deep in the scraper libs. That makes tuning a code change and hides a leaked
 * credential inside source. This module reads ALL of it from the environment,
 * validates it once at import, applies safe defaults, and exposes a typed object.
 *
 * RULES
 *  - No secret literals in source. Secrets come from env only (see .env.example).
 *  - Read config through `config`, never `process.env.*` scattered in libs.
 *  - Server-only. Do not import from client components (it reads process.env and
 *    may hold secrets). Client code gets values via API responses, not this file.
 *
 * This is intentionally dependency-free (no zod yet) so it could land in the P0
 * commit; P1 may swap the ad-hoc parsers for zod schemas.
 */

// ---------- primitive parsers (with defaults + light validation) ----------

function str(name: string, fallback = ''): string {
  const v = process.env[name]
  return v === undefined || v === '' ? fallback : v
}

function requiredIn(env: 'production', name: string, fallback = ''): string {
  const v = str(name, fallback)
  if (!v && process.env.NODE_ENV === env) {
    // Warn loudly at boot in prod; do not crash dev where operators iterate.
    console.warn(`[config] ${name} is empty in ${env} — set it in the environment.`)
  }
  return v
}

function int(name: string, fallback: number, { min, max }: { min?: number; max?: number } = {}): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) {
    console.warn(`[config] ${name}="${raw}" is not an integer — using ${fallback}`)
    return fallback
  }
  if (min !== undefined && n < min) return min
  if (max !== undefined && n > max) return max
  return n
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  return /^(1|true|yes|on)$/i.test(raw)
}

function list(name: string, fallback: string[] = []): string[] {
  const raw = process.env[name]
  if (!raw) return fallback
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

function csvTiers(name: string, fallback: number[]): number[] {
  const raw = process.env[name]
  if (!raw) return fallback
  const tiers = raw.split(',').map((s) => Number.parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n))
  return tiers.length ? tiers : fallback
}

// ---------- the typed config ----------

export const config = {
  env: (process.env.NODE_ENV ?? 'development') as 'development' | 'production' | 'test',
  gitSha: str('APP_GIT_SHA', 'dev'),
  logLevel: str('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',

  /** Auth for the app's own API routes (blueprint §3.7). Empty = open (dev only). */
  auth: {
    /** Shared bearer token the client must send; middleware rejects mismatches. */
    apiToken: requiredIn('production', 'APP_API_TOKEN'),
  },

  /** Per-IP rate limit for expensive scrape endpoints (blueprint §5.4). */
  rateLimit: {
    windowMs: int('RATE_LIMIT_WINDOW_MS', 60_000, { min: 1_000 }),
    max: int('RATE_LIMIT_MAX', 30, { min: 1 }),
  },

  /** Cloudflare Worker proxy pool (blueprint §3.2). NO stranger fallbacks. */
  proxy: {
    /** Operator-owned worker URLs (comma-separated). Prefer over env fallbacks. */
    workerUrls: list('CF_WORKER_URLS', str('CF_WORKER_URL') ? [str('CF_WORKER_URL')] : []),
    /** Shared secret the app sends and the worker checks (harden proxy.js to require it). */
    workerSecret: requiredIn('production', 'CF_WORKER_SECRET'),
    /** Fail fast in prod if no workers configured (instead of silently using strangers). */
    requireConfigured: bool('CF_WORKER_REQUIRE_CONFIGURED', true),
  },

  /** Resilience knobs — were hardcoded in court-case.ts / billing.ts (blueprint §5.2). */
  resilience: {
    /** 3-tier retry timeouts (ms). Was the hardcoded 10/15/20s ladder. */
    retryTiersMs: csvTiers('RETRY_TIERS_MS', [10_000, 15_000, 20_000]),
    /** Consecutive failures before a worker/origin is marked dead. */
    deadThreshold: int('WORKER_DEAD_THRESHOLD', 3, { min: 1 }),
    /** Cooldown before a dead worker is retried (ms). */
    deadCooldownMs: int('WORKER_DEAD_COOLDOWN_MS', 45_000, { min: 1_000 }),
    /** Default per-request timeout when a caller doesn't specify one (ms). */
    defaultTimeoutMs: int('DEFAULT_TIMEOUT_MS', 20_000, { min: 1_000 }),
  },

  /** Cache backend + TTLs (blueprint §4.5). 'memory' now; 'kv' when multi-instance. */
  cache: {
    backend: str('CACHE_BACKEND', 'memory') as 'memory' | 'kv',
    kvUrl: str('CACHE_KV_URL'), // e.g. redis:// or Upstash REST URL when backend=kv
    ttl: {
      statsMs: int('CACHE_TTL_STATS_MS', 60_000, { min: 0 }),
      courtCaseMs: int('CACHE_TTL_COURT_MS', 60_000, { min: 0 }),
      companyMs: int('CACHE_TTL_COMPANY_MS', 24 * 60 * 60_000, { min: 0 }), // orginfo TIN: 24h
      upcomingMs: int('CACHE_TTL_UPCOMING_MS', 5 * 60_000, { min: 0 }),
      mibSessionMs: int('CACHE_TTL_MIB_SESSION_MS', 10 * 60_000, { min: 0 }),
    },
  },

  /** Captcha/VLM solver (blueprint §3.7 — this key was committed in .z-ai-config). */
  vlm: {
    apiKey: requiredIn('production', 'VLM_API_KEY'),
    baseUrl: str('VLM_BASE_URL', ''),
  },

  /** Side-processes (blueprint §2, §5). Toggles + endpoints, not hardcoded. */
  workers: {
    torEnabled: bool('TOR_ENABLED', true),
    torSocksPort: int('TOR_SOCKS_PORT', 9050, { min: 1, max: 65535 }),
    ihamkorEnabled: bool('IHAMKOR_ENABLED', true),
    ihamkorPort: int('IHAMKOR_PORT', 3030, { min: 1, max: 65535 }),
  },

  /** Product knobs. Alert window powers "hearings due soon" (blueprint §5.3). */
  app: {
    alertWindowDays: int('ALERT_WINDOW_DAYS', 7, { min: 1, max: 90 }),
  },
} as const

export type AppConfig = typeof config

/** Redacted snapshot for safe logging at boot (never prints secret values). */
export function configSummary(): Record<string, unknown> {
  const redact = (v: string) => (v ? `set(${v.length})` : 'empty')
  return {
    env: config.env,
    gitSha: config.gitSha,
    logLevel: config.logLevel,
    apiToken: redact(config.auth.apiToken),
    workerUrls: config.proxy.workerUrls.length,
    workerSecret: redact(config.proxy.workerSecret),
    cacheBackend: config.cache.backend,
    retryTiersMs: config.resilience.retryTiersMs,
    vlmApiKey: redact(config.vlm.apiKey),
    torEnabled: config.workers.torEnabled,
    ihamkorEnabled: config.workers.ihamkorEnabled,
    alertWindowDays: config.app.alertWindowDays,
  }
}
