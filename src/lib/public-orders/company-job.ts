import 'server-only'
import { lookupCase, type JobCase } from './engine'
import { searchCase } from './source'
import { appendOrders, getChecked, markChecked } from './store'
import type { CaseJobStatus } from './types'
import { isOngoingFirstInstance, normalizeCaseNumber, planCheck } from '@/core/public-orders'

/**
 * Background download of the published orders of the cases the user asked for (a company's list, the whole
 * watchlist, or one case). One case at a time (its instance searches run in parallel); new requests join
 * the queue, so the user can keep working. Whether a case actually needs a request is decided by the
 * policy in core/public-orders (planCheck): published orders are permanent and only a changed case or a
 * publication-lag back-off triggers another look — so re-running this over the same cases is cheap.
 * The sequence is: DETECT (which cases really need a look — planCheck, ongoing filter — decided at queue time,
 * no request made) → the run sits «ready» (held) until started, or starts at once for an explicit / idle run →
 * SCRAPE → failed cases stay listed so «retry» needs no refresh. State is in-process (globalThis, survives dev hot reloads); the per-case records on disk survive restarts.
 */

interface Holder {
  queue: (JobCase & { force?: boolean })[]
  queued: Set<string>
  status: CaseJobStatus
  running: boolean
  paused: boolean
  /** cases whose last lookup failed in this run — «Qayta urinish» re-queues exactly these */
  failed: JobCase[]
}

const g = globalThis as unknown as { __publicOrdersJob?: Holder }
const holder = (): Holder =>
  (g.__publicOrdersJob ??= {
    queue: [],
    queued: new Set(),
    running: false,
    paused: false,
    failed: [],
    status: { state: 'idle', remaining: 0, failed: 0, total: 0, done: 0, searched: 0, found: 0, errors: 0, ongoing: 0, known: 0, current: null, startedAt: null, lastError: null },
  })

export const caseJobStatus = (): CaseJobStatus => {
  const h = holder()
  return { ...h.status, remaining: h.queue.length, failed: h.failed.length }
}

/** A run is «active» while it works, sits paused, or is held ready with cases in it: new cases join it instead of restarting the counters. */
const active = (h: Holder) => h.running || h.status.state === 'paused' || h.status.state === 'ready'

const fresh = (ongoing: number, known: number): CaseJobStatus => ({
  state: 'idle', remaining: 0, failed: 0, total: 0, done: 0, searched: 0, found: 0, errors: 0, ongoing, known, current: null, startedAt: null, lastError: null,
})

export interface EnqueueOpts {
  /** ask about the case even if it is known / ongoing (a drawer's «Tekshirish») */
  force?: boolean
  /** an automatic feeder must not undo a pause the user pressed while its request was in flight */
  keepPaused?: boolean
  /** DETECT only: queue what needs a look and leave it «ready» — nothing is scraped until resume */
  hold?: boolean
}

export async function enqueueCases(cases: JobCase[], opts: EnqueueOpts = {}): Promise<{ job: CaseJobStatus; added: number; ongoing: number; known: number }> {
  // DETECT (async, no upstream request): which cases need a look at all?
  const now = Date.now()
  const need: JobCase[] = []
  const seen = new Set<string>()
  let ongoing = 0
  let known = 0
  for (const c of cases) {
    const cn = normalizeCaseNumber(c.caseNumber)
    if (!cn || seen.has(cn)) continue
    seen.add(cn)
    // a case still heard in the first instance has no decision, so nothing to look for (asking one case by hand overrides)
    if (!opts.force && isOngoingFirstInstance(c)) {
      ongoing++
      continue
    }
    // already known (published orders are permanent) or waiting out its back-off: no request will be made, so it is not work
    const plan = planCheck(await getChecked(cn), c.sig, now, opts.force)
    if (!plan.run) {
      known++
      continue
    }
    need.push({ ...c, caseNumber: cn })
  }

  // everything below is synchronous: the queue is never observed half-updated
  const h = holder()
  const joining = active(h)
  let added = 0
  for (const c of need) {
    if (h.queued.has(c.caseNumber)) continue
    h.queued.add(c.caseNumber)
    h.queue.push({ ...c, force: opts.force })
    added++
  }
  if (!joining) {
    h.status = fresh(ongoing, known) // a fresh run resets the counters
    h.failed = []
  } else {
    h.status.ongoing += ongoing
    h.status.known += known
  }
  // nothing new — but an explicit start over a run that was only held «ready» (by detection) still starts it
  if (!added && !(h.status.state === 'ready' && !opts.hold)) return { job: caseJobStatus(), added, ongoing, known }
  h.status.total += added
  h.status.startedAt ??= new Date().toISOString()
  if (opts.hold && !h.running && h.status.state !== 'paused') {
    h.status.state = 'ready'
    return { job: caseJobStatus(), added, ongoing, known }
  }
  if (opts.keepPaused && h.status.state === 'paused') return { job: caseJobStatus(), added, ongoing, known }
  return { job: resumeCases(), added, ongoing, known }
}

/** Re-queue exactly the cases whose lookup failed in this run (worker/upstream trouble), without any refresh. */
export async function retryFailed(): Promise<{ job: CaseJobStatus; added: number }> {
  const h = holder()
  const again = h.failed.splice(0)
  if (!again.length) return { job: caseJobStatus(), added: 0 }
  const r = await enqueueCases(again, { force: true })
  return { job: r.job, added: r.added }
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
  else if (h.queue.length) void loop() // also starts a run that was only held «ready»
  else h.status.state = h.status.done ? 'done' : 'idle'
  return caseJobStatus()
}

/** Drop what is still queued (the case being searched finishes). */
export function cancelCases(): CaseJobStatus {
  const h = holder()
  h.queue.length = 0
  h.queued.clear()
  h.paused = false
  h.status.total = h.status.done + (h.running ? 1 : 0) // what was dropped no longer counts as work
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
          h.failed.push({ caseNumber: job.caseNumber, courtType: job.courtType, sig: job.sig, result: job.result, caseStatus: job.caseStatus })
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
