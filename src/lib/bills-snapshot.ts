/**
 * Bills in the daily snapshot (server). The Bills tab used to scrape billing.sud.uz (proof-of-work, a captcha, then a
 * status request per receipt) every time it opened. A finished list is now kept for a day and replayed as the SAME
 * NDJSON stream the live scrape produces, so the client cannot tell the two apart except by `cached` / `fetchedAt`.
 *
 * Kept only when no bill is left with a TRANSIENT error (a timeout would replay for a day); a receipt the origin
 * answers with a definitive error (HTTP 4xx/5xx) is a stable fact and does not block it.
 */

import { isTransientBillError, type EnrichedBill } from './billing'
import type { Snap } from './snapshot-store'

export interface BillsSnap {
  total: number
  bills: EnrichedBill[]
}

export const billsStorable = (bills: EnrichedBill[]): boolean => bills.every((b) => !b.error || !isTransientBillError(b.error))

/** The stream lines for a stored list, in the live contract's order: meta, every bill, done. */
export function replayLines(inn: string, snap: Snap<BillsSnap>, stale = false): string[] {
  return [
    { type: 'meta', inn, total: snap.data.total, cached: true, fetchedAt: snap.fetchedAt, ...(stale ? { stale: true } : {}) },
    ...snap.data.bills.map((bill, index) => ({ type: 'bill', index, bill })),
    { type: 'done', inn, fetchedAt: snap.fetchedAt },
  ].map((m) => JSON.stringify(m) + '\n')
}
