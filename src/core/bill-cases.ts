/**
 * Case numbers from a company's court bills (billing.sud.uz), for the cases the court's TIN lists do not show.
 *
 * The TIN lists are cut at a row limit (100 / 200 rows, see `lib/court-case` LIST_CAPS), so for a big company most of its history is
 * invisible there. The bills are not cut: the search answers `page` / `size` (up to 10 000 rows a page, measured Nov 2026) and every row of
 * it that belongs to a case carries `claimCaseNumber`, `courtType`, `court` and `decisionDate` (131 026 bills = 14 pages of 10 000 for a
 * water utility; about one bill in nine names a case, the rest were never used on one). The case numbers are then asked by number
 * (`findByNumber`, which has no cap).
 *
 * Pure: no network, no disk. The row is read as `unknown` because billing's own TypeScript shape only declares number, status and date.
 */

import { normalizeCourtType, type ApiCourtType } from './billing-format'
import type { CourtCase, FullCaseData } from '@/lib/court-case-types'

/** the same shape the routes accept (`X-XXXX-XXXX/XXXXX`) */
export const CASE_NUMBER = /^\d+-[\d-]+\/\d+$/

export interface BillCase {
  caseNumber: string
  courtType: ApiCourtType
  /** the court's name as the bill gives it */
  court?: string
  /** the day of the ruling the bill belongs to (ms), when billing knows it */
  decisionDate?: number
}

/** the first digit of a case number is its court type (observed: 1 criminal, 2 civil, 3 administrative, 4 economic) */
const BY_PREFIX: Record<string, ApiCourtType> = { '1': 'criminal', '2': 'civil', '3': 'administrative', '4': 'economic' }

export function courtTypeOfNumber(caseNumber: string): ApiCourtType | null {
  return BY_PREFIX[caseNumber.charAt(0)] ?? null
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** The distinct cases named by one page of bills, keyed by case number. A bill that names no case (most of them) adds nothing. */
export function extractBillCases(rows: readonly unknown[], into: Map<string, BillCase> = new Map()): Map<string, BillCase> {
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const caseNumber = str(o.claimCaseNumber)
    if (!CASE_NUMBER.test(caseNumber)) continue
    // billing's own court type first; a type the case API has no word for (MILITARY, unknown) falls back to what the number says
    const courtType = normalizeCourtType(str(o.courtType)) ?? courtTypeOfNumber(caseNumber)
    if (!courtType) continue
    const court = str(o.court)
    const decision = typeof o.decisionDate === 'number' && Number.isFinite(o.decisionDate) ? o.decisionDate : undefined
    const prev = into.get(caseNumber)
    if (!prev) into.set(caseNumber, { caseNumber, courtType, ...(court ? { court } : {}), ...(decision ? { decisionDate: decision } : {}) })
    else {
      // the same case on several bills: keep whatever the first one lacked
      if (!prev.court && court) prev.court = court
      if (!prev.decisionDate && decision) prev.decisionDate = decision
    }
  }
  return into
}

/** `yymm` of a case number («2-1004-2603/8020» → 2603): bigger is newer; unreadable numbers sort last */
export function registeredKey(caseNumber: string): number {
  const m = /^\d+-\d+-(\d{4})\//.exec(caseNumber)
  return m ? Number(m[1]) : -1
}

export interface MissingOpts {
  /** a number already settled (found or tried): not asked again */
  skip?: (caseNumber: string) => boolean
}

/** Bill cases the list does not have, newest first (a recent case matters more than a 2021 one). */
export function missingCases(billCases: Iterable<BillCase>, known: ReadonlySet<string>, opts: MissingOpts = {}): BillCase[] {
  const out: BillCase[] = []
  for (const c of billCases) if (!known.has(c.caseNumber) && !opts.skip?.(c.caseNumber)) out.push(c)
  return out.sort((a, b) => registeredKey(b.caseNumber) - registeredKey(a.caseNumber) || (a.caseNumber < b.caseNumber ? -1 : 1))
}

/**
 * A list row built from a case's detail, for a case the court's list endpoint never returned (older ones live only in the old system, which
 * has details but no `findByNumber` list row). The next hearing and the result are the ones the detail shows.
 */
export function rowFromDetail(d: FullCaseData, fallback: { caseNumber: string; court?: string }): CourtCase {
  const g = d.general
  const insts = [d.inspection, d.cassation, d.appellate, d.firstInstance]
  const decided = insts.find((i) => i?.decision?.text)?.decision?.text ?? ''
  return {
    caseNumber: g?.caseNumber || fallback.caseNumber,
    caseType: g?.caseType && g.caseType !== '-' ? g.caseType : '',
    caseStatus: g?.caseStatus && g.caseStatus !== '-' ? g.caseStatus : '',
    result: decided && decided !== '-' ? decided : '',
    courtName: g?.court && g.court !== '-' ? g.court : fallback.court ?? '',
    dateFiled: g?.applicationDate && g.applicationDate !== '-' ? g.applicationDate : '',
    plaintiff: g?.plaintiff && g.plaintiff !== '-' ? g.plaintiff : '',
    defendant: g?.defendant && g.defendant !== '-' ? g.defendant : '',
    claimAmount: g?.claimAmount ?? '',
    hearingDate: '',
    hearingTime: '',
    judge: g?.judge && g.judge !== '-' ? g.judge : '',
  }
}
