/**
 * A company's court bills at scale, as COMPACT rows, plus the pure logic over them: the filters and sort of the Toʻlovlar tab, its summary,
 * and the bill ↔ case cross-reference.
 *
 * Why a row type of its own: a big company has hundreds of thousands of bills (a bank: 241 541 bills = 25 pages of 10 000), so the tab can no
 * longer hold every bill with a per-bill status call behind it. billing's search rows already carry everything a status call returns except
 * the usage history (`historyList`, fetched when a receipt is opened), so a row keeps only what the tab and the cross-reference use.
 * A case needs about two bills (state duty «Davlat boji» and postal costs «Pochta xarajati»), so one case number is usually on two rows.
 *
 * Pure: no network, no disk.
 */

import { categoryLabel, normalizeCourtType, type ApiCourtType, type CheckStatusResponse } from './billing-format'
import { CASE_NUMBER, courtTypeOfNumber } from './bill-cases'

export interface BillRow {
  number: string
  /** `invoiceStatus` */
  status: string
  issued: number | null
  amount: number | null
  paid: number | null
  mustPay: number | null
  balance: number | null
  overdue: number | null
  /** `payCategory` text (Cyrillic as billing sends it) */
  cat: string
  catId: number | null
  court: string
  courtId: number | null
  /** billing's own code (ECONOMIC · CITIZEN · ADMINISTRATIVE · CRIMINAL · MILITARY) */
  courtType: string
  /** the case this bill was used on, when it was */
  caseNumber: string | null
  /** the day of the ruling, ms */
  decision: number | null
  desc: string
  payer: string
  payerTin: string
  inFavor: boolean | null
  account: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** One raw search row → a compact row; null for anything that is not a bill (no 12-digit number). */
export function toBillRow(raw: unknown): BillRow | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const number = str(o.number)
  if (!/^\d{6,}$/.test(number)) return null
  const caseNumber = str(o.claimCaseNumber)
  return {
    number,
    status: str(o.invoiceStatus),
    issued: num(o.issued),
    amount: num(o.amount),
    paid: num(o.paidAmount),
    mustPay: num(o.mustPayAmount),
    balance: num(o.balance),
    overdue: num(o.overdue),
    cat: str(o.payCategory),
    catId: num(o.payCategoryId),
    court: str(o.court),
    courtId: num(o.courtId),
    courtType: str(o.courtType),
    caseNumber: CASE_NUMBER.test(caseNumber) ? caseNumber : null,
    decision: num(o.decisionDate),
    desc: str(o.description),
    payer: str(o.payer),
    payerTin: str(o.payerTin),
    inFavor: typeof o.isInFavor === 'boolean' ? o.isInFavor : null,
    account: str(o.forAccount),
  }
}

/** A row as the status response the receipt drawer reads (the usage history is not in a list row: it is asked for when the receipt opens). */
export function rowAsDetail(r: BillRow): CheckStatusResponse {
  return {
    requestStatus: { code: 0, message: '' },
    number: r.number,
    invoiceStatus: r.status,
    amount: r.amount,
    paidAmount: r.paid,
    mustPayAmount: r.mustPay,
    balance: r.balance,
    overdue: r.overdue,
    court: r.court || null,
    courtId: r.courtId,
    courtType: r.courtType || null,
    payCategory: r.cat || null,
    payCategoryId: r.catId,
    description: r.desc || null,
    purpose: null,
    purposeId: null,
    instance: null,
    payer: r.payer || null,
    payerId: null,
    payerTin: r.payerTin || null,
    forAccount: r.account || null,
    isInFavor: r.inFavor,
    claimCaseNumber: r.caseNumber,
    decisionDate: r.decision,
    issued: r.issued,
    historyList: null,
  } as CheckStatusResponse
}

/** the case API's court type of a bill: billing's own code, else what the case number says */
export function billCourtType(r: Pick<BillRow, 'courtType' | 'caseNumber'>): ApiCourtType | null {
  return normalizeCourtType(r.courtType) ?? (r.caseNumber ? courtTypeOfNumber(r.caseNumber) : null)
}

// ---------------- the tab's filters, sort and summary ----------------

export type BillSeg = 'all' | 'paid' | 'overdue'
/** the tab's sort menu: newest / oldest first, bill number A→Z / Z→A */
export type BillSort = 'new' | 'old' | 'az' | 'za'
export type CategoryKind = 'davlat_boji' | 'pochta' | 'other'

export interface BillQuery {
  q?: string
  seg?: BillSeg
  /** a case API court type (`civil`, `economic` …) */
  court?: ApiCourtType
  /** davlat boji / pochta / other */
  kind?: CategoryKind
  /** exactly this case */
  caseNumber?: string
  sort?: BillSort
}

export const isPaidStatus = (s: string): boolean => s === 'PAID' || s === 'USED'

export const categoryKind = (r: Pick<BillRow, 'cat'>): CategoryKind => categoryLabel(r.cat).kind

export function matchesBill(r: BillRow, f: BillQuery): boolean {
  if (f.seg === 'paid' && !isPaidStatus(r.status)) return false
  if (f.seg === 'overdue' && r.status !== 'OVERDUE') return false
  if (f.caseNumber && r.caseNumber !== f.caseNumber) return false
  if (f.court && billCourtType(r) !== f.court) return false
  if (f.kind && categoryKind(r) !== f.kind) return false
  const q = f.q?.trim().toLowerCase()
  if (q) {
    // number and case number are digits: no lower-casing needed for them
    if (!(r.number.includes(q) || (r.caseNumber ?? '').includes(q) || r.court.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q))) return false
  }
  return true
}

export function compareBills(sort: BillSort): (a: BillRow, b: BillRow) => number {
  switch (sort) {
    case 'old': return (a, b) => (a.issued ?? 0) - (b.issued ?? 0) || (a.number < b.number ? -1 : 1)
    case 'az': return (a, b) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0)
    case 'za': return (a, b) => (a.number < b.number ? 1 : a.number > b.number ? -1 : 0)
    default: return (a, b) => (b.issued ?? 0) - (a.issued ?? 0) || (a.number < b.number ? -1 : 1)
  }
}

export interface BillsSummary {
  count: number
  paid: number
  overdue: number
  partial: number
  /** tiyins */
  totalAmount: number
  totalPaid: number
  /** tiyins: the overdue sum (balance of overdue bills) */
  overdueSum: number
  /** bills that were used on a case */
  withCase: number
  /** distinct cases they name */
  cases: number
  byCourt: Record<string, number>
  byKind: Record<CategoryKind, number>
}

export function summarizeBills(rows: readonly BillRow[]): BillsSummary {
  const s: BillsSummary = { count: rows.length, paid: 0, overdue: 0, partial: 0, totalAmount: 0, totalPaid: 0, overdueSum: 0, withCase: 0, cases: 0, byCourt: {}, byKind: { davlat_boji: 0, pochta: 0, other: 0 } }
  const cases = new Set<string>()
  for (const r of rows) {
    if (isPaidStatus(r.status)) s.paid++
    else if (r.status === 'OVERDUE') {
      s.overdue++
      s.overdueSum += r.overdue ?? r.balance ?? 0
    } else if (r.status === 'PARTIALLY_PAID') s.partial++
    s.totalAmount += r.amount ?? 0
    s.totalPaid += r.paid ?? 0
    if (r.caseNumber) {
      s.withCase++
      cases.add(r.caseNumber)
    }
    const ct = billCourtType(r)
    if (ct) s.byCourt[ct] = (s.byCourt[ct] ?? 0) + 1
    s.byKind[categoryKind(r)]++
  }
  s.cases = cases.size
  return s
}

// ---------------- bill ↔ case ----------------

export interface CaseBills {
  caseNumber: string
  courtType: ApiCourtType
  /** the court as the bills name it (a TIN list names it too, from the court's side) */
  court: string
  decision: number | null
  bills: BillRow[]
}

/**
 * The cases the bills name, with THEIR bills (usually two: state duty and postal costs), keyed by case number. A number whose court type
 * neither billing nor the number's first digit can place is skipped.
 */
export function casesOfBills(rows: Iterable<BillRow>): Map<string, CaseBills> {
  const out = new Map<string, CaseBills>()
  for (const r of rows) {
    if (!r.caseNumber) continue
    const courtType = billCourtType(r)
    if (!courtType) continue
    let c = out.get(r.caseNumber)
    if (!c) out.set(r.caseNumber, (c = { caseNumber: r.caseNumber, courtType, court: r.court, decision: r.decision, bills: [] }))
    if (!c.court && r.court) c.court = r.court
    if (!c.decision && r.decision) c.decision = r.decision
    c.bills.push(r)
  }
  return out
}
