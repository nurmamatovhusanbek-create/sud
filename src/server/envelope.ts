/**
 * Envelope helpers for route handlers — the single response contract
 * (blueprint §4.3). Every multi-source route reports partial failures instead
 * of collapsing them into pass/fail.
 */

import { NextResponse } from 'next/server'
import type { Envelope, SourceError, EnvelopeMeta } from '@/core/envelope'

export function jsonOk<T>(data: T, opts?: { partial?: SourceError[]; meta?: EnvelopeMeta; status?: number }): NextResponse {
  const body: Envelope<T> = {
    ok: true,
    data,
    ...(opts?.partial?.length ? { partial: opts.partial } : {}),
    ...(opts?.meta ? { meta: opts.meta } : {}),
  }
  return NextResponse.json(body, { status: opts?.status ?? 200 })
}

export function jsonFail(error: string, code: string, status: number): NextResponse {
  return NextResponse.json({ ok: false, error, code, status }, { status })
}

/** Back-compat helper: the legacy routes spread `{ ok: true, ...result }`. */
export function jsonOkCompat<T extends Record<string, unknown>>(result: T): NextResponse {
  return NextResponse.json({ ok: true, ...result })
}
