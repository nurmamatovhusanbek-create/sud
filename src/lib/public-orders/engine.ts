import {
  compactPublication,
  normalizeCaseNumber,
  planCheck,
  type CaseCheck,
  type CheckReason,
  type PublicCourtType,
  type RawPublication,
  type StoredOrder,
} from '@/core/public-orders'

/**
 * The per-case lookup — I/O injected, so it is tested without a network or a disk.
 *
 * The library's search is slow (≈10 s with an `instance` filter, a minute or more without), so it only runs in
 * the BACKGROUND, for the cases the user cares about. The policy (core/public-orders → planCheck) is:
 *  - a published order is permanent: an instance that has one is never asked about again;
 *  - a case is re-checked only when it changed (its signature) or after a publication-lag back-off;
 *  - a failed search is an error to retry — never a false «no orders».
 */

export interface JobCase {
  caseNumber: string
  courtType: PublicCourtType
  /** caseSignature() of the case data at the time — a change triggers a re-check */
  sig: string
}

export interface CaseLookupDeps {
  search(caseNumber: string, courtType: PublicCourtType, instance: string): Promise<RawPublication[]>
  append(orders: StoredOrder[]): Promise<void>
  getChecked(caseNumber: string): Promise<CaseCheck | null>
  markChecked(c: CaseCheck): Promise<void>
  now(): Date
}

export interface CaseLookupResult {
  caseNumber: string
  /** true = the policy said «nothing to ask»; no request was made */
  skipped: boolean
  reason: CheckReason
  /** NEW published orders found by this run */
  found: number
  error?: string
}

export async function lookupCase(deps: CaseLookupDeps, job: JobCase, opts: { force?: boolean } = {}): Promise<CaseLookupResult> {
  const cn = normalizeCaseNumber(job.caseNumber)
  const prev = await deps.getChecked(cn)
  const now = deps.now()
  const plan = planCheck(prev, job.sig, now.getTime(), opts.force)
  if (!plan.run) return { caseNumber: cn, skipped: true, reason: plan.reason, found: 0 }

  const settled = await Promise.allSettled(plan.instances.map((i) => deps.search(cn, job.courtType, i)))
  const orders: StoredOrder[] = []
  const gotInstance = new Set<string>()
  let failed = 0
  let firstError = ''
  for (const s of settled) {
    if (s.status === 'rejected') {
      failed++
      firstError ||= s.reason instanceof Error ? s.reason.message : String(s.reason)
      continue
    }
    for (const raw of s.value) {
      const o = compactPublication(raw, job.courtType)
      if (o && o.caseNumber === cn) {
        // the search is a «contains»: keep only THIS case
        orders.push(o)
        gotInstance.add(o.instance)
      }
    }
  }
  if (orders.length) await deps.append(orders)

  const error = failed ? (orders.length ? `${failed}/${plan.instances.length} so‘rov bajarilmadi` : firstError || 'so‘rov bajarilmadi') : undefined
  const seen = [...new Set([...(prev?.seen ?? []), ...gotInstance])]
  // misses = fruitless back-off re-checks so far: the first check (or a changed case) starts the ladder at 0;
  // a failed check must not eat a step
  const fresh = plan.reason === 'sig-changed' || plan.reason === 'new'
  // (retrying a failed check is that same step, so it does not climb either)
  const misses = orders.length ? 0 : error || plan.reason === 'retry-error' ? (prev?.misses ?? 0) : fresh ? 0 : (prev?.misses ?? 0) + 1
  await deps.markChecked({ caseNumber: cn, at: now.toISOString(), sig: job.sig, seen, misses, error })
  return { caseNumber: cn, skipped: false, reason: plan.reason, found: orders.length, error }
}
