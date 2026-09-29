import 'server-only'
import { lookupCase, type JobCase } from './engine'
import { searchCase } from './source'
import { appendOrders, getChecked, markChecked } from './store'
import type { CaseJobStatus } from './types'
import { isOngoingFirstInstance, normalizeCaseNumber } from '@/core/public-orders'

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
    status: { state: 'idle', remaining: 0, total: 0, done: 0, searched: 0, found: 0, errors: 0, ongoing: 0, current: null, startedAt: null, lastError: null },
  })

export const caseJobStatus = (): CaseJobStatus => {
  const h = holder()
  return { ...h.status, remaining: h.queue.length }
}

/** A run is «active» while it works or sits paused with cases left: new cases join it instead of restarting the counters. */
const active = (h: Holder) => h.running || h.status.state === 'paused'

export function enqueueCases(cases: JobCase[], opts: { force?: boolean; keepPaused?: boolean } = {}): { job: CaseJobStatus; added: number; ongoing: number } {
  const h = holder()
  const joining = active(h)
  let added = 0
  let ongoing = 0
  for (const c of cases) {
    const cn = normalizeCaseNumber(c.caseNumber)
    if (!cn || h.queued.has(cn)) continue
    // a case still heard in the first instance has no decision, so nothing to look for (asking one case by hand overrides)
    if (!opts.force && isOngoingFirstInstance(c)) {
      ongoing++
      continue
    }
    h.queued.add(cn)
    h.queue.push({ ...c, caseNumber: cn, force: opts.force })
    added++
  }
  if (!joining) {
    // a fresh run resets the counters
    h.status = { state: 'idle', remaining: 0, total: 0, done: 0, searched: 0, found: 0, errors: 0, ongoing, current: null, startedAt: null, lastError: null }
  } else h.status.ongoing += ongoing
  if (!added) return { job: caseJobStatus(), added, ongoing }
  h.status.total += added
  h.status.startedAt ??= new Date().toISOString()
  // an automatic feeder (Kuzatuv) must not undo a pause the user pressed while its request was in flight
  if (opts.keepPaused && h.status.state === 'paused') return { job: caseJobStatus(), added, ongoing }
  return { job: resumeCases(), added, ongoing }
}

/**
 * Pause: the case being searched finishes (an upstream search cannot be cancelled cleanly), then the loop stops
 * and the rest stays queued, in order. The state flips at once so the UI answers the click immediately.
 */
export function pauseCases(): CaseJobStatus {
  const h = holder()
  if (h.running && !h.paused) {
    h.paused = true
    h.status.state = 'paused'
  }
  return caseJobStatus()
}

/** Resume exactly where the pause left off: same queue, same order, same counters. */
export function resumeCases(): CaseJobStatus {
  const h = holder()
  h.paused = false
  if (h.running) h.status.state = 'running' // still finishing the case it was on: just keep going
  else if (h.queue.length) void loop()
  else h.status.state = h.status.done ? 'done' : 'idle'
  return caseJobStatus()
}

/** Drop what is still queued (the case being searched finishes). */
export function cancelCases(): CaseJobStatus {
  const h = holder()
  h.queue.length = 0
  h.queued.clear()
  h.paused = false
  if (!h.running) h.status.state = h.status.done ? 'done' : 'idle'
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
    if (h.paused && h.queue.length) h.status.state = 'paused' // stays paused until resumeCases(); the queue is kept
    else if (h.paused) {
      h.paused = false // paused on the very last case: nothing left to resume
      h.status.state = h.status.errors && h.status.errors >= h.status.done ? 'error' : 'done'
    } else h.status.state = h.status.errors && h.status.errors >= h.status.done ? 'error' : 'done'
  }
}
