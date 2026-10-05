/**
 * Time buckets for the worker health history — pure (no fs), shared by the server store and the Settings page.
 *
 * A bucket counts requests in one window: an hour (`w = HOUR_MS`) for recent history, a day (`w = DAY_MS`) once it is
 * older than the hourly horizon. `spanTotals` answers «how many requests, how many ok, what average latency» for the
 * Bugun / 7 kun / 30 kun / Barcha pills.
 */

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

export interface Bucket {
  /** window start (epoch ms, aligned to `w`) */
  t: number
  /** window width: HOUR_MS or DAY_MS */
  w: number
  ok: number
  fail: number
  /** summed response time of all requests in the window (ms) */
  ms: number
}

const align = (ts: number, w: number): number => Math.floor(ts / w) * w

/** Add one request to the hourly bucket of `ts` (creating it), keeping the list sorted by time. */
export function addToBucket(buckets: Bucket[], ts: number, ok: boolean, ms: number): void {
  const t = align(ts, HOUR_MS)
  let b: Bucket | undefined
  for (let i = buckets.length - 1; i >= 0 && !b; i--) if (buckets[i].w === HOUR_MS && buckets[i].t === t) b = buckets[i]
  if (!b) {
    b = { t, w: HOUR_MS, ok: 0, fail: 0, ms: 0 }
    buckets.push(b)
    buckets.sort((x, y) => x.t - y.t)
  }
  if (ok) b.ok++
  else b.fail++
  b.ms += Math.max(0, Number.isFinite(ms) ? ms : 0)
}

/** Merge hourly buckets older than `hourlyDays` into per-day buckets (counts and ms are summed, nothing is lost). */
export function rollUp(buckets: readonly Bucket[], now: number, hourlyDays: number): Bucket[] {
  const cutoff = now - hourlyDays * DAY_MS
  const out = new Map<string, Bucket>()
  for (const b of buckets) {
    const old = b.w === HOUR_MS && b.t + b.w <= cutoff
    const w = old ? DAY_MS : b.w
    const t = old ? align(b.t, DAY_MS) : b.t
    const k = `${w}:${t}`
    const m = out.get(k)
    if (m) { m.ok += b.ok; m.fail += b.fail; m.ms += b.ms } else out.set(k, { t, w, ok: b.ok, fail: b.fail, ms: b.ms })
  }
  return [...out.values()].sort((a, b) => a.t - b.t)
}

export interface SpanTotals {
  requests: number
  ok: number
  fail: number
  /** summed response time (ms) — add these up across workers, then divide by the summed requests */
  ms: number
  /** average response time (ms), null when there were no requests */
  avgMs: number | null
}

/**
 * Totals over the last `spanMs` (null = all time). A bucket counts when it overlaps the window, so a span edge is
 * accurate to its bucket (an hour for anything up to the hourly horizon).
 */
export function spanTotals(buckets: readonly Bucket[], now: number, spanMs: number | null): SpanTotals {
  const from = spanMs === null ? -Infinity : now - spanMs
  let ok = 0
  let fail = 0
  let ms = 0
  for (const b of buckets) {
    if (b.t + b.w <= from || b.t > now) continue
    ok += b.ok
    fail += b.fail
    ms += b.ms
  }
  const requests = ok + fail
  return { requests, ok, fail, ms, avgMs: requests ? Math.round(ms / requests) : null }
}

/** The same totals from raw request records (a server that does not send buckets yet). */
export function recordTotals(records: readonly { ts: number; ok: boolean; ms: number }[], now: number, spanMs: number | null): SpanTotals {
  const rs = spanMs === null ? records : records.filter((r) => now - r.ts <= spanMs)
  const ok = rs.filter((r) => r.ok).length
  const ms = rs.reduce((a, r) => a + r.ms, 0)
  return { requests: rs.length, ok, fail: rs.length - ok, ms, avgMs: rs.length ? Math.round(ms / rs.length) : null }
}
