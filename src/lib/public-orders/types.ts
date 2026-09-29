/** The background download of published orders, as the UI sees it. */
export interface CaseJobStatus {
  state: 'idle' | 'running' | 'paused' | 'error' | 'done'
  /** cases still waiting in the queue (a paused run resumes with exactly these, in this order) */
  remaining: number
  /** cases queued in this run */
  total: number
  /** cases handled (looked up or skipped by the policy) */
  done: number
  /** cases actually searched upstream (the rest were skipped: already known) */
  searched: number
  /** NEW published orders found so far — the number the global loader shows */
  found: number
  errors: number
  /** cases left out of this run because they are still heard in the first instance (no decision, nothing to publish) */
  ongoing: number
  current: string | null
  startedAt: string | null
  lastError: string | null
}

export interface PublicOrdersStatus {
  job: CaseJobStatus
}

/** What the local cache holds (Settings › Qarorlar). */
export interface OrdersCacheStats {
  /** cases that were looked up at least once */
  cases: number
  /** cases with at least one published order */
  withOrders: number
  /** published orders stored */
  orders: number
  /** cases whose last lookup failed (retried automatically) */
  failed: number
  /** disk used by the cache, bytes */
  bytes: number
  /** newest lookup, ISO */
  lastCheckedAt: string | null
}
