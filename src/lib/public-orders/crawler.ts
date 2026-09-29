import 'server-only'
import { isoDay, PUBLIC_COURT_TYPES, type PublicCourtType } from '@/core/public-orders'
import { runCrawl, type CrawlOutcome } from './engine'
import { listPage } from './source'
import { appendOrders, loadState, saveState } from './store'
import type { CrawlState, CrawlStatus } from './types'

/**
 * The in-process crawl manager: one background job per server process, started/paused from Settings.
 * State lives on `globalThis` so dev-mode hot reloads don't lose a running job; progress itself is
 * persisted by the engine after every day, so even a killed server resumes where it stopped.
 */

interface Holder {
  status: CrawlStatus
  abort: AbortController | null
}

const g = globalThis as unknown as { __publicOrdersCrawl?: Holder }
const holder = (): Holder =>
  (g.__publicOrdersCrawl ??= {
    status: { state: 'idle', courtTypes: [], current: null, startedAt: null, rowsThisRun: 0, lastError: null },
    abort: null,
  })

export const crawlStatus = (): CrawlStatus => ({ ...holder().status })

export function startCrawl(courtTypes: PublicCourtType[]): CrawlStatus {
  const h = holder()
  if (h.status.state === 'running') return crawlStatus()
  const types = courtTypes.filter((t) => PUBLIC_COURT_TYPES.includes(t))
  if (!types.length) throw new Error('court type required')
  const abort = new AbortController()
  h.abort = abort
  h.status = { state: 'running', courtTypes: types, current: null, startedAt: new Date().toISOString(), rowsThisRun: 0, lastError: null }

  void runCrawl(
    {
      listPage,
      append: appendOrders,
      load: loadState,
      save: (s: CrawlState) => saveState(s),
      today: () => isoDay(new Date()),
      sleep: (ms) =>
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, ms)
          abort.signal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
        }),
    },
    {
      courtTypes: types,
      signal: abort.signal,
      onProgress: (e) => {
        h.status.current = { courtType: e.courtType, day: e.day, phase: e.phase }
        h.status.rowsThisRun = e.rowsThisRun
      },
    },
  ).then((out: CrawlOutcome) => {
    h.abort = null
    h.status.current = null
    if (out.status === 'error') {
      h.status.state = 'error'
      h.status.lastError = out.error
    } else h.status.state = out.status === 'paused' ? 'paused' : 'done'
  })
  return crawlStatus()
}

export function pauseCrawl(): CrawlStatus {
  holder().abort?.abort()
  return crawlStatus()
}
