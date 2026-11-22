/**
 * What the case drawer is shown: the policy between the court and the disk copy (`lib/case-store`), apart from the route so it can be
 * tested with a fake court.
 *
 *  - a case that ended long ago (`core/case-freeze`) is served from disk and the court is not asked;
 *  - any other case is read live, and the answer is stored;
 *  - the court cannot be reached (or answers nothing) → the stored copy, flagged `stale`; with no copy the error is the answer;
 *  - the operator's «Yangilash» (`refresh`) asks the court about THIS case only; if that fails it THROWS, so the caller can say so and
 *    keep showing what it already shows (the stored copy is never replaced by a failure);
 *  - a fresh answer also replaces the case's row in the company's stored list (`patchRow`), so the list agrees with the drawer.
 */

import { caseFreeze } from '@/core/case-freeze'
import type { CourtCase, CourtType, FullCaseData } from './court-case-types'
import { patchRow, readDetail, writeDetail } from './case-store'
import { readSnapshot, writeSnapshot, type SnapshotPart } from './snapshot-store'

export interface ServedDetail {
  data: FullCaseData
  /** when the court answered (ms) */
  fetchedAt: number
  /** served from the disk copy */
  fromStore: boolean
  /** the court could not be reached, this is the last copy */
  stale: boolean
  /** an old, settled case: it is not asked again unless the operator refreshes it */
  frozen: boolean
}

export type CaseFetcher = (courtType: CourtType, caseNumber: string) => Promise<{ data: FullCaseData; row: CourtCase | null }>

export interface ServeOptions {
  /** the operator pressed «Yangilash» on this case */
  refresh?: boolean
  /** the company the case was opened from: its stored list gets the fresh row */
  tin?: string
  now?: Date
}

/** every date the detail carries: the case's freeze depends on the newest one that has passed (and on none being ahead) */
export function detailDates(d: FullCaseData): string[] {
  const out: string[] = [d.general?.applicationDate ?? '', d.general?.initiatedDate ?? '']
  for (const inst of [d.firstInstance, d.appellate, d.cassation, d.inspection]) {
    if (!inst) continue
    for (const h of inst.hearings) out.push(h.date)
    if (inst.decision) out.push(inst.decision.date)
  }
  return out
}

export const freezeOf = (d: FullCaseData, now?: Date) => caseFreeze({ status: d.general?.caseStatus, dates: detailDates(d) }, now)

/**
 * The company's day snapshot of this court's list holds the old row: replace it, keeping the snapshot's OWN age (the rest of that list
 * is not any fresher than it was).
 */
function patchSnapshot(tin: string, courtType: CourtType, row: CourtCase): void {
  if (courtType === 'criminal') return // not snapshotted
  const part = `court:${courtType}` as SnapshotPart
  const snap = readSnapshot<{ cases: CourtCase[] }>(tin, part)
  if (!snap || !Array.isArray(snap.data?.cases)) return
  const cases = snap.data.cases.some((c) => c.caseNumber === row.caseNumber)
    ? snap.data.cases.map((c) => (c.caseNumber === row.caseNumber ? row : c))
    : [...snap.data.cases, row]
  writeSnapshot(tin, part, { ...snap.data, cases }, snap.fetchedAt)
}

const hasCase = (d: FullCaseData): boolean => d.general !== null

export async function servedCaseDetail(courtType: CourtType, caseNumber: string, fetchCase: CaseFetcher, opts: ServeOptions = {}): Promise<ServedDetail> {
  const stored = readDetail(courtType, caseNumber)
  if (stored && !opts.refresh) {
    const f = freezeOf(stored.data, opts.now)
    if (f.frozen) return { data: stored.data, fetchedAt: stored.t, fromStore: true, stale: false, frozen: true }
  }
  let live: { data: FullCaseData; row: CourtCase | null }
  try {
    live = await fetchCase(courtType, caseNumber)
  } catch (e) {
    if (stored && !opts.refresh) return { data: stored.data, fetchedAt: stored.t, fromStore: true, stale: true, frozen: false }
    throw e
  }
  if (!hasCase(live.data)) {
    // «nothing found» can be a failed source, not an erased case: it must not replace a case we know
    if (stored && !opts.refresh) return { data: stored.data, fetchedAt: stored.t, fromStore: true, stale: true, frozen: false }
    if (stored) throw new Error('Sud saytidan bu ish boʻyicha javob olinmadi')
    return { data: live.data, fetchedAt: Date.now(), fromStore: false, stale: false, frozen: false }
  }
  const t = Date.now()
  writeDetail(courtType, caseNumber, live.data, t)
  if (opts.tin && live.row) {
    patchRow(opts.tin, courtType, live.row)
    patchSnapshot(opts.tin, courtType, live.row)
  }
  return { data: live.data, fetchedAt: t, fromStore: false, stale: false, frozen: freezeOf(live.data, opts.now).frozen }
}
