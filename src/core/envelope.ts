/**
 * Unified result envelope (blueprint §4.3) — the single contract every API
 * route returns and every client consumer renders from.
 *
 * `ok:true` carries data plus OPTIONAL partial errors: a multi-source route
 * (stats, company-info) reports which sources failed while still returning
 * whatever succeeded. Partial failure is NEVER shown as complete data.
 */
export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'rate_limited'
  | 'upstream_error'
  | 'timeout'
  | 'not_found'
  | 'internal'

/** A single source's failure inside a partial (or full) failure. */
export interface SourceError {
  source: string
  error: string
}

export interface EnvelopeMeta {
  elapsedMs?: number
  via?: string
  /** True when the result was served from cache rather than a live scrape. */
  cached?: boolean
}

export type Envelope<T> =
  | { ok: true; data: T; partial?: SourceError[]; meta?: EnvelopeMeta }
  | { ok: false; error: string; code: ErrorCode; status: number }

export function ok<T>(data: T, opts?: { partial?: SourceError[]; meta?: EnvelopeMeta }): Envelope<T> {
  return { ok: true, data, ...(opts?.partial ? { partial: opts.partial } : {}), ...(opts?.meta ? { meta: opts.meta } : {}) }
}

export function fail(error: string, code: ErrorCode, status: number): Envelope<never> {
  return { ok: false, error, code, status }
}
