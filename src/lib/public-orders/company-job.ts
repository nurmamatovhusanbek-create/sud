import 'server-only'
import { lookupCase, type JobCase } from './engine'
import { searchCase } from './source'
import { appendOrders, getChecked, markChecked } from './store'
import type { CaseJobStatus } from './types'
import { normalizeCaseNumber } from '@/core/public-orders'

/**
 * Background download of the published orders of the cases the user asked for (a company's list, the whole
 * watchlist, or one case). One case at a time (its instance searches run in parallel); new requests join
 * the queue, so the user can keep working. Whether a case actually needs a request is decided by the
 * policy in core/public-orders (planCheck): published orders are permanent and only a changed case or a
 * publication-lag back-off triggers another look — so re-running this over the same cases is cheap.
 * State is in-process (globalThis, survives dev hot reloads); the per-case records on disk survive restarts.
 */

interface Holder {
  queue: (JobCase & { force?: boolean })[]
  queued: Set<string>
  status: CaseJobStatus
  running: boolean
  paused: boolean
}

const g = globalThis as unknown as { __publicOrdersJob?: Holder }
const holder = (): Holder =>
  (g.__publicOrdersJob ??= {
    queue: [],
    queued: new Set(),
    running: false,
    paused: false,
    status: { state: 'idle', total: 0, done: 0, searched: 0, found: 0, errors: 0, current: null, startedAt: null, lastError: null },
  })

export const caseJobStatus = (): CaseJobStatus => ({ ...holder().status })

export function enqueueCases(cases: JobCase[], opts: { force?: boolean } = {}): CaseJobStatus {
  const h = holder()
  let added = 0
  for (const c of cases) {
    const cn = normalizeCaseNumber(c.caseNumber)
    if (!cn || h.queued.has(cn)) continue
    h.queued.add(cn)
    h.queue.push({ ...c, caseNumber: cn, force: opts.force })
    added++
  }
  if (!added && h.running) return caseJobStatus()
  h.paused = false
  if (!h.running) {
    // a fresh run resets the counters; joining an active run just raises `total`
    h.status = { state: 'running', total: h.queue.length, done: 0, searched: 0, found: 0, errors: 0, current: null, startedAt: new Date().toISOString(), lastError: null }
    void loop()
  } else h.status.total += added
  return caseJobStatus()
}

export function pauseCases(): CaseJobStatus {
  const h = holder()
  if (h.running) h.paused = true
  return caseJobStatus()
}

async function loop() {
  const h = holder()
  h.running = true
  h.status.state = 'running'
  try {
    while (h.queue.length && !h.paused) {
      const job = h.queue.shift()!
      try {
        // a skipped case makes no request and must not flash in the loader: only name what is really searched
        const r = await lookupCase(
          {
            search: (cn, ct, inst) => {
              h.status.current = cn
              return searchCase(cn, ct, inst)
            },
            append: appendOrders,
            getChecked,
            markChecked,
            now: () => new Date(),
          },
          job,
          { force: job.force },
        )
        if (!r.skipped) h.status.searched++
        h.status.found += r.found
        if (r.error) {
          h.status.errors++
          h.status.lastError = r.error
        }
      } catch (e) {
        h.status.errors++
        h.status.lastError = e instanceof Error ? e.message : String(e)
      }
      h.queued.delete(job.caseNumber)
      h.status.done++
    }
  } finally {
    h.running = false
    h.status.current = null
    if (h.paused) h.status.state = 'paused'
    else h.status.state = h.status.errors && h.status.errors >= h.status.done ? 'error' : 'done'
    h.paused = false
    // anything still queued after a pause stays queued for the next start
  }
}
