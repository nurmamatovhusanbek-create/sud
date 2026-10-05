/**
 * Security events: what the perimeter refused, and which dangerous doors were used.
 *
 * With background work running (queued scraping, `git pull` + restart, worker list, Tor) the operator should be able to
 * SEE a forged or stray request instead of it being a silent 403. Every refusal in `guard()` and every call to a
 * privileged route is noted here: a ring of the last RING_MAX events plus per-kind counters, in memory only (the
 * app keeps no new file for it; the lines also go to the server log). Nothing from the request body is kept, only the
 * method, the path (no query: it can hold a STIR or a token) and a short reason.
 *
 * One holder per process on `globalThis` (HMR re-evaluates modules). Read by `GET /api/settings/security`.
 */

import type { SecurityEvent, SecurityEventKind, SecuritySnapshot } from '@/core/security-events'
import { SECURITY_EVENT_KINDS } from '@/core/security-events'

export type { SecurityEvent, SecurityEventKind, SecuritySnapshot }

export const RING_MAX = 200

interface Holder {
  since: number
  counts: Record<SecurityEventKind, number>
  ring: SecurityEvent[]
  /** last console line per kind, so a page hammering the app cannot flood the log */
  lastLogged: Partial<Record<SecurityEventKind, number>>
}
const g = globalThis as unknown as { __sudSecurity?: Holder }
const LOG_EVERY_MS = 10_000

function holder(): Holder {
  return (g.__sudSecurity ??= {
    since: Date.now(),
    counts: Object.fromEntries(SECURITY_EVENT_KINDS.map((k) => [k, 0])) as Record<SecurityEventKind, number>,
    ring: [],
    lastLogged: {},
  })
}

/** Note one event. `url` is the full request URL (only its pathname is kept). */
export function recordSecurityEvent(kind: SecurityEventKind, method: string, url: string, detail?: string): void {
  const h = holder()
  let path = ''
  try {
    path = new URL(url, 'http://localhost').pathname
  } catch {
    path = '?'
  }
  const ev: SecurityEvent = { ts: Date.now(), kind, method: method.toUpperCase(), path: path.slice(0, 120), ...(detail ? { detail: detail.slice(0, 160) } : {}) }
  h.counts[kind]++
  h.ring.push(ev)
  if (h.ring.length > RING_MAX) h.ring.splice(0, h.ring.length - RING_MAX)
  const last = h.lastLogged[kind] ?? 0
  if (kind === 'privileged_call' || ev.ts - last >= LOG_EVERY_MS) {
    h.lastLogged[kind] = ev.ts
    console.warn(`[security] ${kind} ${ev.method} ${ev.path}${detail ? ` (${ev.detail})` : ''}`)
  }
}

export function securitySnapshot(): SecuritySnapshot {
  const h = holder()
  return { since: h.since, counts: { ...h.counts }, recent: [...h.ring].reverse() }
}

/** Tests only. */
export function __resetSecurityForTests(): void {
  delete g.__sudSecurity
}
