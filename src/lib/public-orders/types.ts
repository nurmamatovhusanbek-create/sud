/** The background download of published orders, as the UI sees it. */
export interface CaseJobStatus {
  state: 'idle' | 'running' | 'paused' | 'error' | 'done'
  /** cases queued in this run */
  total: number
  /** cases handled (looked up or skipped by the policy) */
  done: number
  /** cases actually searched upstream (the rest were skipped: already known) */
  searched: number
  /** NEW published orders found so far — the number the global loader shows */
  found: number
  errors: number
  current: string | null
  startedAt: string | null
  lastError: string | null
}

export interface PublicOrdersStatus {
  job: CaseJobStatus
}
