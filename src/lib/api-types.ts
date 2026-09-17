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
  | { ok: true; data: T; partial?: SourceError[]; meta?: { elapsedMs?: number; cached?: boolean } }
  | { ok: false; error: string; code?: string; status?: number }

export type { CompanyStats, CourtCase, FullCaseData, BillSummary, EnrichedBill }

export interface CompanyInfoData {
  company: CompanyInfoPayload['company']
  rating: CompanyInfoPayload['rating']
}
export type { CompanyInfoPayload, UpcomingHearingsPayload }

export interface UpcomingHearingsData {
  tin: string
  count: number
  hearings: UpcomingHearingsPayload['hearings']
}

// ---- Bills stream message union (server contract, typed) --------------------

export type BillStreamMessage =
  | { type: 'meta'; inn: string; total: number }
  | { type: 'phase'; phase: string; detail?: string }
  | { type: 'bill'; index: number; bill: EnrichedBill }
  | { type: 'done'; inn: string }
  | { type: 'error'; error: string }

// ---- Bill detail (single invoice) --------------------------------------------

export interface BillDetailData {
  bill: unknown
}

// ---- MIB -----------------------------------------------------------------------

export interface MibPrepareData {
  sessionId: string
  captchaUrl: string
}
