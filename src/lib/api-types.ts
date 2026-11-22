/**
 * Client-side API contract (arch guide §3.2). Mirrors the P4 server envelopes.
 * One place knows every response shape; components never hand-parse JSON.
 */
import type { SourceError } from '@/core/envelope'
import type { CompanyStats } from '@/lib/stats'
import type { CourtCase, FullCaseData } from '@/lib/court-case-types'
import type { BillSummary, EnrichedBill } from '@/core/billing-format'
import type { CompanyInfoPayload, UpcomingHearingsPayload } from '@/sources'

export type ApiResult<T> =
  | { ok: true; data: T; partial?: SourceError[]; meta?: { elapsedMs?: number; cached?: boolean; fetchedAt?: number; stale?: boolean; frozen?: boolean; capped?: boolean } }
  | { ok: false; error: string; code?: string; status?: number }

export type { CompanyStats, CourtCase, FullCaseData, BillSummary, EnrichedBill }
export type { BillCasesStatus, FoundEvent, JobStatus as BillJobStatus } from './bill-cases'
export type { BillRow, BillSeg, BillSort, BillsSummary, CategoryKind } from '@/core/bill-rows'
import type { BillCasesStatus, FoundEvent, JobStatus } from './bill-cases'
import type { BillsMeta, BillsPage } from './bills-store'
export type { BillsMeta, BillsPage }

/** `GET /api/bill-cases` */
export interface BillJobState {
  status: BillCasesStatus
  job: JobStatus
  events: FoundEvent[]
  behind: boolean
}

/** `GET /api/bills/query` (`bills: null` = nothing is stored yet) */
export interface BillsQueryResult {
  bills: BillsPage | null
  meta: BillsMeta | null
  job: JobStatus
}

export interface CompanyInfoData {
  company: CompanyInfoPayload['company']
  rating: CompanyInfoPayload['rating']
}
export type { CompanyInfoPayload, UpcomingHearingsPayload }

export interface UpcomingHearingsData {
  tin: string
  count: number
  hearings: UpcomingHearingsPayload['hearings']
  failed?: UpcomingHearingsPayload['failed']
}

// ---- Bills stream message union (server contract, typed) --------------------

export type BillStreamMessage =
  | { type: 'meta'; inn: string; total: number; /** replayed from the daily snapshot */ cached?: boolean; /** when the sites answered (ms) */ fetchedAt?: number; /** past its day and the sites failed */ stale?: boolean }
  | { type: 'phase'; phase: string; detail?: string }
  | { type: 'bill'; index: number; bill: EnrichedBill }
  | { type: 'done'; inn: string; fetchedAt?: number }
  | { type: 'error'; error: string }

// ---- Bill detail (single invoice) --------------------------------------------

export interface BillDetailData {
  bill: unknown
}
