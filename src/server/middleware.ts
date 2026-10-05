/**
 * API middleware chain — P4 of the rebuild blueprint (§5.4):
 *   host check → cross-site check → (privileged header) → auth → rate-limit → coalesce → handler
 *  - host / cross-site / privileged: server/security.ts (DNS rebinding, CSRF, dangerous routes)
 *
 *  - auth: requires the shared bearer token when APP_API_TOKEN is configured.
 *    Open in dev (no token) so the sandbox preview works.
 *  - rate-limit: fixed-window per-IP budget for expensive scrape endpoints.
 *  - coalesce: identical in-flight requests (same route key) share ONE upstream
 *    job — the fix that lets reactStrictMode turn back on without doubling
 *    real scrapes, and collapses bursty tab switches.
 */

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { config } from '@/server/config'
import { bodyTooLarge, crossSiteReason, hostAllowed, hostnameOf, privilegedHeaderOk, safeEqual } from '@/server/security'
import { recordSecurityEvent } from '@/server/audit'

// ---------- auth ------------------------------------------------------------

export function authorized(req: Request): boolean {
  const token = config.auth.apiToken
  if (!token) return true // dev/open mode
  const header = req.headers.get('authorization') || ''
  const alt = req.headers.get('x-app-token') || ''
  // constant-time: `===` would tell a timing attacker how much of a guess was right
  return safeEqual(header, `Bearer ${token}`) || safeEqual(alt, token)
}

export function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Ruxsat yoʻq: APP_API_TOKEN sozlanmagan. Klient token yuborishi kerak.", code: 'unauthorized' },
    { status: 401 },
  )
}

// ---------- rate limit (per-IP fixed window) ----------------------------------

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

/**
 * The rate-limit key. `X-Forwarded-For` is a header the CALLER writes: believed only behind a proxy that overwrites it
 * (APP_TRUST_PROXY), otherwise one budget for the whole machine, which is what a single-operator loopback app wants.
 */
function clientIp(req: Request): string {
  if (!config.security.trustProxy) return 'local'
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim().slice(0, 64)
  return req.headers.get('x-real-ip')?.slice(0, 64) || 'local'
}

/** Drop spent windows once the map grows (a trusted-proxy deployment sees many keys). */
function sweep(map: Map<string, Bucket>, now: number): void {
  if (map.size < 256) return
  for (const [k, b] of map) if (now > b.resetAt) map.delete(k)
}

export function rateLimited(req: Request): boolean {
  const key = `rl:${clientIp(req)}`
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now > b.resetAt) {
    sweep(buckets, now)
    buckets.set(key, { count: 1, resetAt: now + config.rateLimit.windowMs })
    return false
  }
  b.count++
  return b.count > config.rateLimit.max
}

/** Tests only: forget every spent budget (bun runs all test files in one process; a test that exhausts the budget must not starve the next file). */
export function __resetRateLimitsForTests(): void {
  buckets.clear()
  privBuckets.clear()
}

export function rateLimitResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "Juda koʻp soʻrovlar. Birozdan soʻng qayta urinib koʻring.", code: 'rate_limited' },
    { status: 429 },
  )
}

// ---------- in-flight coalescing ------------------------------------------------

const inFlight = new Map<string, Promise<unknown>>()

/**
 * Run `job`, collapsing concurrent identical calls onto one promise.
 * `key` should be route + meaningful params (e.g. `stats:302678824`).
 * Results are NOT cached — each awaiter gets the same live response for this
 * single upstream job; the next request after completion re-runs (caches have
 * their own layer).
 */
export function coalesce<T>(key: string, job: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<T>
  const p = job().finally(() => {
    inFlight.delete(key)
  })
  inFlight.set(key, p)
  return p
}

// ---------- combined wrapper ---------------------------------------------------

export type ApiHandler = (req: NextRequest) => Promise<Response>

export interface GuardOptions {
  /** Set false on cheap/static endpoints (settings/version, health polls). */
  rateLimit?: boolean
  /** Overridable auth check for internal tooling. */
  auth?: boolean
  /**
   * Dangerous doors (git pull + restart, worker list, Tor): additionally need the `x-sud-action: 1` header (which a
   * cross-site page cannot send) and get a much smaller request budget.
   */
  privileged?: boolean
}

function forbidden(error: string, code: string): NextResponse {
  return NextResponse.json({ ok: false, error, code }, { status: 403 })
}

// privileged routes: at most this many calls per window per client (a click, not a loop)
const PRIVILEGED_MAX = 10
const privBuckets = new Map<string, Bucket>()
function privilegedLimited(req: Request): boolean {
  const key = clientIp(req)
  const now = Date.now()
  const b = privBuckets.get(key)
  if (!b || now > b.resetAt) {
    sweep(privBuckets, now)
    privBuckets.set(key, { count: 1, resetAt: now + config.rateLimit.windowMs })
    return false
  }
  b.count++
  return b.count > PRIVILEGED_MAX
}

/** Wrap a route handler with the middleware chain. */
export function guard(handler: ApiHandler, opts: GuardOptions = {}): ApiHandler {
  const useAuth = opts.auth !== false
  const useRl = opts.rateLimit !== false
  return async (req: NextRequest) => {
    const refuse = (kind: Parameters<typeof recordSecurityEvent>[0], detail: string | undefined, res: NextResponse) => {
      recordSecurityEvent(kind, req.method, req.url, detail)
      return res
    }
    if (!hostAllowed(req.headers.get('host'), config.security.allowedHosts)) {
      return refuse('bad_host', hostnameOf(req.headers.get('host')) || 'no Host', forbidden("Notoʻgʻri Host sarlavhasi — ilova faqat localhost orqali ochiladi (APP_ALLOWED_HOSTS bilan kengaytiriladi)", 'bad_host'))
    }
    const cross = crossSiteReason(req.method, req.headers)
    if (cross) return refuse('cross_site', cross, forbidden("Boshqa saytdan kelgan soʻrov rad etildi", 'cross_site'))
    if (bodyTooLarge(req.headers)) return refuse('too_large', req.headers.get('content-length') ?? undefined, NextResponse.json({ ok: false, error: 'Soʻrov hajmi juda katta', code: 'too_large' }, { status: 413 }))
    if (opts.privileged && !privilegedHeaderOk(req.headers)) {
      return refuse('privileged_header', undefined, forbidden("Bu amal uchun ilovaning oʻz sahifasidan yuborilgan tasdiq sarlavhasi kerak", 'privileged_header'))
    }
    if (useAuth && !authorized(req)) return refuse('unauthorized', undefined, unauthorizedResponse())
    if (opts.privileged && privilegedLimited(req)) return refuse('rate_limited', 'privileged', rateLimitResponse())
    if (useRl && rateLimited(req)) return refuse('rate_limited', undefined, rateLimitResponse())
    // a dangerous door was opened: leave a trace the operator can see (Settings › Xavfsizlik)
    if (opts.privileged) recordSecurityEvent('privileged_call', req.method, req.url)
    try {
      return await handler(req)
    } catch (e) {
      console.error('[api] unhandled route error:', e)
      return NextResponse.json(
        // the real message stays in the server log; in production a client never sees internals (paths, stack hints)
        { ok: false, error: process.env.NODE_ENV !== 'production' && e instanceof Error ? e.message : 'Ichki xatolik', code: 'internal' },
        { status: 500 },
      )
    }
  }
}
