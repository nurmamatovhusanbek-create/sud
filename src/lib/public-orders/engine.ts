import {
  addDays,
  compactPublication,
  type PublicCourtType,
  type StoredOrder,
} from '@/core/public-orders'
import { emptyProgress, type CrawlState, type TypeProgress } from './types'
import type { ListPage, ListParams } from './source'

/**
 * The crawl engine — I/O injected, so it is tested without a network or a disk.
 *
 * The library's date-window query is the fast, indexed one (≈0.15 s a page of 100), so we walk it one
 * DAY at a time, newest first, page by page, and append every row to the local index:
 *   1. top-up  — days from today back to (newest covered − 2): catches orders published late;
 *   2. backfill — continue below the oldest covered day until `emptyLimit` empty days in a row
 *      (the start of the library) or the `floor` date.
 * A day counts as covered only after ALL its pages arrived, and progress is saved after every day, so a
 * pause, a crash or a restart resumes exactly where it stopped. Each day's row count is checked against
 * the API's own total; a mismatch is recorded, never hidden.
 */

export interface CrawlDeps {
  listPage(p: ListParams): Promise<ListPage>
  append(orders: StoredOrder[]): Promise<void>
  load(): Promise<CrawlState>
  save(s: CrawlState): Promise<void>
  today(): string
  sleep(ms: number): Promise<void>
}

export interface CrawlProgressEvent {
  courtType: PublicCourtType
  day: string
  phase: 'top-up' | 'backfill'
  rowsThisRun: number
  progress: TypeProgress
}

export interface CrawlOptions {
  courtTypes: PublicCourtType[]
  signal: AbortSignal
  onProgress?: (e: CrawlProgressEvent) => void
  /** consecutive empty days that mean «the library starts here» */
  emptyLimit?: number
  /** never go below this day */
  floor?: string
  pageDelayMs?: number
  retryDelaysMs?: number[]
  pageSize?: number
}

export type CrawlOutcome = { status: 'done' | 'paused' } | { status: 'error'; error: string }

const PAGE = 100

export async function runCrawl(deps: CrawlDeps, opts: CrawlOptions): Promise<CrawlOutcome> {
  const emptyLimit = opts.emptyLimit ?? 60
  const floor = opts.floor ?? '2015-01-01'
  const pageDelay = opts.pageDelayMs ?? 120
  const retries = opts.retryDelaysMs ?? [1000, 3000, 8000]
  const size = opts.pageSize ?? PAGE
  const state = await deps.load()
  let rowsThisRun = 0

  const stopped = () => opts.signal.aborted

  async function withRetry<T>(job: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
      try {
        return await job()
      } catch (e) {
        if (stopped() || i >= retries.length) throw e
        await deps.sleep(retries[i])
      }
    }
  }

  /** every page of one day; returns the rows seen */
  async function crawlDay(ct: PublicCourtType, day: string, prog: TypeProgress): Promise<number> {
    let page = 0
    let got = 0
    let total: number | null = null
    for (;;) {
      if (stopped()) throw new PausedSignal()
      const p = await withRetry(() => deps.listPage({ courtType: ct, startDate: day, endDate: day, page, size }))
      if (page === 0) total = p.total
      await deps.append(p.rows.map((r) => compactPublication(r, ct)).filter((o): o is StoredOrder => o !== null))
      got += p.rows.length
      if (p.rows.length < size || (total !== null && got >= total)) break
      page++
      await deps.sleep(pageDelay)
    }
    if (total !== null && got !== total) prog.mismatches++
    return got
  }

  const done = async (ct: PublicCourtType, day: string, phase: 'top-up' | 'backfill', prog: TypeProgress, rows: number, countRows = true) => {
    // a top-up re-reads the last 2 covered days: those rows are not new, don't count them twice
    if (countRows) prog.rows += rows
    prog.days++
    rowsThisRun += rows
    state.types[ct] = prog
    await deps.save(state)
    opts.onProgress?.({ courtType: ct, day, phase, rowsThisRun, progress: { ...prog } })
  }

  try {
    for (const ct of opts.courtTypes) {
      const prog: TypeProgress = { ...(state.types[ct] ?? emptyProgress()) }
      const today = deps.today()

      // 1. top-up: today → (newest − 2)
      if (prog.newest) {
        const oldNewest = prog.newest
        for (let day = today; day >= addDays(oldNewest, -2); day = addDays(day, -1)) {
          const rows = await crawlDay(ct, day, prog)
          await done(ct, day, 'top-up', prog, rows, day > oldNewest)
        }
        prog.newest = today
        state.types[ct] = prog
        await deps.save(state)
      }

      // 2. backfill below the oldest covered day
      if (!prog.complete) {
        let day = prog.oldest ? addDays(prog.oldest, -1) : today
        for (; ; day = addDays(day, -1)) {
          if (day < floor) {
            prog.complete = true
            break
          }
          const rows = await crawlDay(ct, day, prog)
          if (!prog.newest) prog.newest = today
          prog.oldest = day
          prog.emptyRun = rows === 0 ? prog.emptyRun + 1 : 0
          if (prog.emptyRun >= emptyLimit) prog.complete = true
          await done(ct, day, 'backfill', prog, rows)
          if (prog.complete) break
        }
        state.types[ct] = prog
        await deps.save(state)
      }
    }
    return { status: 'done' }
  } catch (e) {
    await deps.save(state)
    if (e instanceof PausedSignal) return { status: 'paused' }
    return { status: 'error', error: e instanceof Error ? e.message : String(e) }
  }
}

class PausedSignal extends Error {}
