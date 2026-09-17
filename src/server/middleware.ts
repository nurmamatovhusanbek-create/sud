/**
 * API middleware chain — P4 of the rebuild blueprint (§5.4):
 *   auth → rate-limit → coalesce → handler
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

// ---------- auth ------------------------------------------------------------

export function authorized(req: Request): boolean {
  const token = config.auth.apiToken
  if (!token) return true // dev/open mode
  const header = req.headers.get('authorization') || ''
  const alt = req.headers.get('x-app-token') || ''
  return header === `Bearer ${token}` || alt === token
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

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'local'
}

export function rateLimited(req: Request): boolean {
  const key = `rl:${clientIp(req)}`
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now > b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + config.rateLimit.windowMs })
    return false
  }
  b.count++
  return b.count > config.rateLimit.max
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
}

/** Wrap a route handler with the P4 middleware chain. */
export function guard(handler: ApiHandler, opts: GuardOptions = {}): ApiHandler {
  const useAuth = opts.auth !== false
  const useRl = opts.rateLimit !== false
  return async (req: NextRequest) => {
    if (useAuth && !authorized(req)) return unauthorizedResponse()
    if (useRl && rateLimited(req)) return rateLimitResponse()
    try {
      return await handler(req)
    } catch (e) {
      console.error('[api] unhandled route error:', e)
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : 'Ichki xatolik', code: 'internal' },
        { status: 500 },
      )
    }
  }
}
