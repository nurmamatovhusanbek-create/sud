import type { PublicCourtType } from '@/core/public-orders'

/** Crawl progress, persisted in data/public-orders/state.json. */
export interface TypeProgress {
  /** newest day covered so far (top-ups start a few days before it) */
  newest: string | null
  /** oldest day covered so far (backfill continues below it) */
  oldest: string | null
  /** consecutive empty days seen at the old end */
  emptyRun: number
  /** the backfill reached the beginning of the library */
  complete: boolean
  rows: number
  days: number
  /** days whose row count didn't match the API's own total (should stay 0) */
  mismatches: number
}

export interface CrawlState {
  version: 1
  updatedAt: string
  types: Partial<Record<PublicCourtType, TypeProgress>>
}

export const emptyProgress = (): TypeProgress => ({ newest: null, oldest: null, emptyRun: 0, complete: false, rows: 0, days: 0, mismatches: 0 })


/** The background crawl job as the UI sees it. */
export interface CrawlStatus {
  state: 'idle' | 'running' | 'paused' | 'error' | 'done'
  courtTypes: PublicCourtType[]
  current: { courtType: PublicCourtType; day: string; phase: string } | null
  startedAt: string | null
  rowsThisRun: number
  lastError: string | null
}

export interface PublicOrdersStatus {
  crawl: CrawlStatus
  types: CrawlState['types']
  updatedAt: string
}

export interface PublicOrdersCoverage {
  indexed: boolean
  since: string | null
  until: string | null
  complete: boolean
  running: boolean
}
