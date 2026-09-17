/**
 * Client-safe pure billing helpers (P1 core extraction).
 *
 * MOVED VERBATIM from src/lib/billing.ts so client components can format
 * bills without importing the server-only SDK there. src/lib/billing.ts
 * re-exports these — one source of truth, zero behavior change.
 */

export type InvoiceStatus =
  | 'CREATED'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CHECKING'
  | 'CANCELLED'
  | 'USED'
  | 'BREAKED'
  | 'SENT_TO_MIB'
  | string

export interface BillListItem {
  number: string
  invoiceStatus: InvoiceStatus
  issued: number | null
}

export interface HistoryEntry {
  id: number | null
  caseId: number | null
  caseNumber: string | null
  amount: number | null // tiyins
  invoiceId: number | null
  usedUserId: number | null
  rolledBackAt: number | null
  invoiceStatus: InvoiceStatus | null
  createdAt: number | null
}

export interface CheckStatusResponse {
  requestStatus: { code: number; message: string }
  number: string | null
  invoiceStatus: InvoiceStatus | null
  amount: number | null
  paidAmount: number | null
  mustPayAmount: number | null
  balance: number | null
  overdue: number | null
  court: string | null
  courtId: number | null
  courtType: string | null
  payCategory: string | null
  payCategoryId: number | null
  description: string | null
  purpose: string | null
  purposeId: number | null
  instance: string | null
  payer: string | null
  payerId: number | null
  payerTin: string | null
  forAccount: string | null
  isInFavor: boolean | null
  claimCaseNumber: string | null
  decisionDate: number | null
  issued: number | null
  historyList: HistoryEntry[] | null
}

export interface SearchResponse {
  content: BillListItem[]
  pageNumber: number
  pageSize: number
  totalElements: number
  totalPages: number
  last: boolean
}

export interface EnrichedBill extends BillListItem {
  detail: CheckStatusResponse | null
  error?: string
}

// ---- Status helpers ----------------------------------------------------

// `uz` is Latin-Uzbek (display). `ru` is Russian (kept for reference). `en` is English.
export const COURT_TYPES: Record<string, { uz: string; ru: string; en: string }> = {
  CRIMINAL: { uz: 'Jinoyat ishlari boʻyicha sud', ru: 'Sud po ugolovnym delam', en: 'Criminal court' },
  CITIZEN: { uz: 'Fuqarolik ishlari boʻyicha sud', ru: 'Sud po grazhdanskim delam', en: 'Civil court' },
  ADMINISTRATIVE: { uz: "Maʼmuriy sud", ru: 'Administrativnyy sud', en: 'Administrative court' },
  ECONOMIC: { uz: 'Iqtisodiy sud', ru: 'Ekonomicheskiy sud', en: 'Economic court' },
  MILITARY: { uz: 'Harbiy sud', ru: 'Voennyy sud', en: 'Military court' },
}

export function courtTypeLabel(type: string | null | undefined): string {
  if (!type) return '-'
  return COURT_TYPES[type]?.uz ?? type
}

export const INVOICE_STATUSES: Record<string, { uz: string; ru: string; en: string }> = {
  CREATED: { uz: "Toʻlanmagan", ru: 'Ne oplacheno', en: 'Not paid' },
  PARTIALLY_PAID: { uz: 'Qisman toʻlangan', ru: 'Chastichno oplacheno', en: 'Partially paid' },
  PAID: { uz: 'Toʻliq toʻlangan', ru: 'Polnostyu oplacheno', en: 'Fully paid' },
  CHECKING: { uz: 'Tranzaksiya tasdiqlanishi kutilmoqda', ru: 'Ozhidaetsya podtverzhdenie', en: 'Awaiting confirmation' },
  CANCELLED: { uz: 'Bekor qilingan', ru: 'Otmenena', en: 'Cancelled' },
  USED: { uz: 'Foydalanilgan', ru: 'Ispolzovana', en: 'Used' },
  BREAKED: { uz: 'Nomaʼlum xatolik', ru: 'Neizvestnaya oshibka', en: 'Error' },
  SENT_TO_MIB: { uz: 'MIBga yuborilgan', ru: 'Otpravlen v BPI', en: 'Sent to BPI' },
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown'
  return INVOICE_STATUSES[status]?.uz ?? INVOICE_STATUSES[status]?.en ?? status
}

/** Map a status to a coarse "payment" bucket for badges. */
export function paymentBucket(status: string | null | undefined): 'paid' | 'partial' | 'unpaid' | 'other' {
  switch (status) {
    case 'PAID':
    case 'USED':
      return 'paid'
    case 'PARTIALLY_PAID':
      return 'partial'
    case 'CREATED':
      return 'unpaid'
    default:
      return 'other'
  }
}

/** Normalize the payCategory string to a friendly "davlat boji / pochta / other". */
export function categoryLabel(category: string | null | undefined): {
  label: string
  kind: 'davlat_boji' | 'pochta' | 'other'
} {
  if (!category) return { label: '-', kind: 'other' }
  const c = category.toLowerCase()
  if (c.includes('pochta') || c.includes('почта')) return { label: 'Pochta', kind: 'pochta' }
  if (c.includes('boj') || c.includes('boji') || c.includes('бож') || c.includes('пошлин')) {
    if (c.includes('davlat') || c.includes('давлат') || c.includes('госуд')) {
      return { label: 'Davlat boji', kind: 'davlat_boji' }
    }
    return { label: 'Davlat boji', kind: 'davlat_boji' }
  }
  return { label: category, kind: 'other' }
}

// Amounts on billing.sud.uz are expressed in tiyins (1/100 of a sum).
export function tiyinsToSum(tiyins: number | null | undefined): number {
  if (tiyins == null) return 0
  return tiyins / 100
}

export function formatSum(tiyins: number | null | undefined): string {
  const sum = tiyinsToSum(tiyins)
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(sum)
}

export function formatDate(ts: number | null | undefined): string {
  if (!ts) return '-'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ---- Aggregations for the UI ------------------------------------------

export interface BillSummary {
  total: number
  paid: number
  partial: number
  unpaid: number
  totalAmount: number
  totalPaid: number
  totalBalance: number
}

export function summarizeBills(bills: EnrichedBill[]): BillSummary {
  const s: BillSummary = {
    total: bills.length,
    paid: 0,
    partial: 0,
    unpaid: 0,
    totalAmount: 0,
    totalPaid: 0,
    totalBalance: 0,
  }
  for (const b of bills) {
    const status = b.detail?.invoiceStatus ?? b.invoiceStatus
    const bucket = paymentBucket(status)
    if (bucket === 'paid') s.paid++
    else if (bucket === 'partial') s.partial++
    else if (bucket === 'unpaid') s.unpaid++
    const d = b.detail
    if (d) {
      s.totalAmount += d.amount ?? 0
      s.totalPaid += d.paidAmount ?? 0
      s.totalBalance += d.balance ?? 0
    }
  }
  return s
}
