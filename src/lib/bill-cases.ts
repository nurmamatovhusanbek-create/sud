/**
 * The long job behind «cases from the bills»: load ALL of a company's court bills, then find the cases they name that no TIN list shows,
 * by asking the court for each case NUMBER. It runs on the server, in the background, one at a time for the whole app, and the page only
 * WATCHES it (polls `jobStatus` / `eventsSince`), so leaving the screen does not stop it and coming back picks it up again.
 *
 *   LOAD  billing's search page by page (10 000 a page, one captcha each) into `lib/bills-store`. A page is stored the moment it arrives, so
 *         the Toʻlovlar tab shows the first pages while the rest load; a stopped load resumes from the next page.
 *   FILL  for every case number the bills name (`casesOfBills`: usually TWO bills per case, state duty and postal costs, so ~half as many
 *         cases as bills) that no stored list has and that was not already tried, newest first: `getCaseLean`, one request at a time, paced.
 *         A found case is stored at once as a detail and as a row of `found_cases` (`addFound`: one SQL transaction per case, so a crash loses
 *         nothing) and announced as an event. The queue is read from the database a batch at a time (`nextMissingCases`), never held whole.
 *
 * Why this cannot get the app blocked (measured, Nov 2026, docs/design-notes): one request at a time for the whole app, `PACE_MS` between
 * requests (~1 request a second with the ~1 s the court takes), the new system first and the old, rate-limited one only for numbers the new
 * one says it does not hold, «not found» from the old one believed only after two asks, and on ANY failure (HTTP 429/403/5xx, timeouts) an
 * exponential back-off (20 s, 40 s … 15 min); six failures in a row PAUSE the job instead of pressing on.
 * Server-only.
 */

import { rowFromDetail } from '@/core/bill-cases'
import { searchBillsByInn } from './billing'
import { toBillRow } from '@/core/bill-rows'
import { getCaseLean, type CaseLean } from './court-case'
import type { CourtCase, CourtType } from './court-case-types'
import { addFound, feedCaseNumbers, triedStats, writeDetail } from './case-store'
import { billCaseCount, billCountOf, countMissingCases, nextMissingCases, pageOverlap, readBillsMeta, setKnownFeed, writeBillsPage } from './bills-store'
import { ensureCompany, markRefreshed, readCompany } from './company-meta'
import { passIndexOfSize, passSize, passVerdict } from '@/core/bill-passes'

/** a case the court's APIs did not know is asked again only after this long (the old system's node is flaky: «not found» is not always true) */
export const RETRY_MISSING_MS = 14 * 24 * 60 * 60_000
/** the pause between two requests to the court (`CASE_FETCH_GAP_MS`) */
export const DEFAULT_PACE_MS = 1_200
/** a billing page that failed is tried again this many times, `PAGE_RETRY_MS` × attempt apart */
const PAGE_ATTEMPTS = 3
const PAGE_RETRY_MS = 15_000
const BACKOFF_FIRST_MS = 20_000
const BACKOFF_MAX_MS = 15 * 60_000
/** the job pauses after this many failures in a row */
export const MAX_FAILURES_IN_ROW = 6
/** the queue is read from the database this many cases at a time */
const BATCH = 100
/** the live feed keeps this many found cases (a page that fell further behind just reads again) */
const MAX_EVENTS = 60_000

export interface FoundEvent {
  seq: number
  courtType: CourtType
  row: CourtCase
}

export type JobState = 'idle' | 'running' | 'paused' | 'done' | 'stopped' | 'error'

export interface JobStatus {
  tin: string | null
  state: JobState
  phase: 'load' | 'fill' | null
  startedAt: number | null
  /** the bills pages: read / of */
  page: number
  pages: number
  /** the pass over the pages (0 = the first; more than one only when billing's paging was not stable) */
  pass: number
  /** the last finished pass saw billing's order hold for all its pages */
  stable: boolean
  bills: number
  /** the cases to ask: asked / of, how many were found, how many neither system knows */
  done: number
  total: number
  found: number
  absent: number
  errors: number
  current: string | null
  /** the last event number: a page asks for the events after the one it has */
  seq: number
  lastError: string | null
  /** a back-off or pause: when the job goes on (ms), null when not waiting */
  waitingUntil: number | null
}

export interface BillCasesStatus {
  /** the company's bills at billing (as of the last page stored), pages stored / of */
  totalBills: number
  pagesDone: number
  totalPages: number
  loaded: boolean
  loadedAt: number
  /** when this company was first scraped; when its last complete bills load began (the data is as of then; 0 = never completed); bills that load added */
  firstAt: number
  refreshedAt: number
  lastAdded: number
  /** distinct cases the stored bills name */
  billCases: number
  /** of those: not in the stored lists and not tried (what a fill would ask) */
  missing: number
  /** of those: found by number */
  found: number
  /** of those: asked, unknown to both systems */
  notFound: number
}

/** the two calls to the sites and the clock, injectable so the job can be tested without them */
export interface BillCasesDeps {
  searchBills: typeof searchBillsByInn
  getCase: (courtType: CourtType, caseNumber: string) => Promise<CaseLean>
  sleep: (ms: number, signal: AbortSignal) => Promise<void>
  now: () => number
}

const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted || ms <= 0) return resolve()
    const t = setTimeout(() => { signal.removeEventListener('abort', done); resolve() }, ms)
    const done = () => { clearTimeout(t); resolve() }
    signal.addEventListener('abort', done, { once: true })
  })

const REAL: BillCasesDeps = { searchBills: searchBillsByInn, getCase: (c, n) => getCaseLean(c, n), sleep: abortableSleep, now: Date.now }

interface Job {
  status: JobStatus
  events: FoundEvent[]
  abort: AbortController
  done: Promise<void>
}

const g = globalThis as unknown as { __sudBillJob?: Job | null }

const idle = (): JobStatus => ({ tin: null, state: 'idle', phase: null, startedAt: null, page: 0, pages: 0, pass: 0, stable: false, bills: 0, done: 0, total: 0, found: 0, absent: 0, errors: 0, current: null, seq: 0, lastError: null, waitingUntil: null })

/** the job of this process (one at a time for the whole app), or null */
const current = (): Job | null => g.__sudBillJob ?? null

export const billJobRunning = (): boolean => current()?.status.state === 'running'

export function jobStatus(tin: string): JobStatus {
  const j = current()
  return j && j.status.tin === tin ? { ...j.status } : idle()
}

/** the found cases after event `after`, and whether the page fell too far behind to follow (it then reads the list again) */
export function eventsSince(tin: string, after: number): { events: FoundEvent[]; behind: boolean; seq: number } {
  const j = current()
  if (!j || j.status.tin !== tin) return { events: [], behind: false, seq: 0 }
  const first = j.events[0]?.seq ?? j.status.seq + 1
  return { events: j.events.filter((e) => e.seq > after), behind: after + 1 < first && after < j.status.seq, seq: j.status.seq }
}

/** What is known about a company's bills and their cases, from the database only (no site is asked). */
export function billCasesStatus(tin: string, now: number = Date.now()): BillCasesStatus {
  const meta = readBillsMeta(tin)
  const co = readCompany(tin)
  const retryBefore = now - RETRY_MISSING_MS
  setKnownFeed(tin, feedCaseNumbers(tin))
  const tried = triedStats(tin, retryBefore)
  return {
    totalBills: meta?.totalElements ?? 0,
    pagesDone: meta?.pagesDone ?? 0,
    totalPages: meta?.totalPages ?? 0,
    loaded: meta?.complete ?? false,
    loadedAt: meta?.loadedAt ?? 0,
    firstAt: co?.firstAt ?? 0,
    refreshedAt: co?.refreshedAt ?? 0,
    lastAdded: co?.lastAdded ?? 0,
    billCases: billCaseCount(tin),
    missing: countMissingCases(tin, retryBefore),
    found: tried.found,
    notFound: tried.notFound,
  }
}

export interface StartOpts {
  /** `auto`: load the bills when none are stored or the load is unfinished; `refresh`: read every page again; `skip`: do not load */
  load?: 'auto' | 'refresh' | 'skip'
  /** after the load, ask the court for the cases the bills name */
  fill?: boolean
  deps?: Partial<BillCasesDeps>
  paceMs?: number
}

/**
 * Start the job for a company. Returns at once; the work goes on in the background. Throws when a job is already running (for any company:
 * the court is asked by one job at a time).
 */
export function startJob(tin: string, opts: StartOpts = {}): JobStatus {
  const running = current()
  if (running && running.status.state === 'running') {
    throw new Error(running.status.tin === tin ? 'Bu kompaniya uchun jarayon allaqachon ketmoqda' : 'Boshqa kompaniya uchun jarayon ketmoqda: avval uni toʻxtating')
  }
  const abort = new AbortController()
  const job: Job = { status: { ...idle(), tin, state: 'running', startedAt: Date.now() }, events: [], abort, done: Promise.resolve() }
  g.__sudBillJob = job
  const deps: BillCasesDeps = { ...REAL, ...opts.deps }
  const pace = opts.paceMs ?? (Number(process.env.CASE_FETCH_GAP_MS) >= 0 && process.env.CASE_FETCH_GAP_MS ? Number(process.env.CASE_FETCH_GAP_MS) : DEFAULT_PACE_MS)
  job.done = run(job, tin, opts, deps, pace).catch((e) => {
    job.status.state = 'error'
    job.status.lastError = e instanceof Error ? e.message : String(e)
    job.status.phase = null
  })
  return { ...job.status }
}

export function stopJob(tin: string): JobStatus {
  const j = current()
  if (j && j.status.tin === tin && (j.status.state === 'running' || j.status.state === 'paused')) j.abort.abort()
  return jobStatus(tin)
}

/** wait for the job to end (tests) */
export const jobDone = (): Promise<void> => current()?.done ?? Promise.resolve()

/** forget the job (tests) */
export function forgetJob(): void {
  g.__sudBillJob = null
}

async function run(job: Job, tin: string, opts: StartOpts, deps: BillCasesDeps, pace: number): Promise<void> {
  const s = job.status
  const signal = job.abort.signal
  const stopped = () => {
    if (!signal.aborted) return false
    s.state = 'stopped'
    s.phase = null
    s.current = null
    s.waitingUntil = null
    return true
  }

  // ---- LOAD ----
  // billing's paging is not stable (core/bill-passes): the bills are read in PASSES with different page sizes until a pass agrees with itself
  const mode = opts.load ?? 'auto'
  if (mode !== 'skip') {
    const meta = readBillsMeta(tin)
    const unfinished = !!meta && !meta.complete
    if (mode === 'refresh' || !meta || unfinished) {
      s.phase = 'load'
      // the first scrape's date is set once; a load that finishes is «as of» the moment it BEGAN (a resumed one keeps the date it began on)
      ensureCompany(tin, deps.now())
      const loadStartedAt = unfinished && mode !== 'refresh' ? (readCompany(tin)?.firstAt ?? deps.now()) : deps.now()
      const before = billCountOf(tin)
      // resume an unfinished pass where it stopped; otherwise a new pass (a new generation of files, so the stored rows keep being served)
      let pass = meta ? (unfinished && mode !== 'refresh' ? meta.pass : meta.pass + 1) : 0
      let passIndex = unfinished && mode !== 'refresh' && meta ? passIndexOfSize(meta.pageSize) : 0
      let page = unfinished && mode !== 'refresh' && meta ? meta.pagesDone : 0
      for (;;) {
        if (stopped()) return
        const size = passSize(passIndex)
        const counts = { rows: 0, overlap: 0, added: 0, total: 0 }
        let totalPages = 0
        s.pass = passIndex
        for (;;) {
          if (stopped()) return
          s.page = page
          // a page can fail on the captcha (billing hands out a token only when it scores the client high enough, or when the math is solved):
          // try again after a pause before giving the load up; the pages already stored stay and the next start resumes after them
          let res: Awaited<ReturnType<BillCasesDeps['searchBills']>> | null = null
          for (let attempt = 1; !res; attempt++) {
            try {
              res = await deps.searchBills(tin, { page, size })
            } catch (e) {
              if (attempt >= PAGE_ATTEMPTS || signal.aborted) throw e
              s.lastError = e instanceof Error ? e.message : String(e)
              s.waitingUntil = deps.now() + PAGE_RETRY_MS * attempt
              await deps.sleep(PAGE_RETRY_MS * attempt, signal)
              s.waitingUntil = null
              if (stopped()) return
            }
          }
          s.lastError = null
          totalPages = res.totalPages
          counts.total = res.totalElements
          s.pages = totalPages
          s.bills = res.totalElements
          if (!res.content.length) {
            // an empty page inside the range is billing refusing us, not the end: say so instead of calling the load complete
            if (page < totalPages) throw new Error(`billing.sud.uz ${page + 1}-sahifani boʻsh qaytardi`)
            break
          }
          const rows = res.content.map(toBillRow).filter((r): r is NonNullable<typeof r> => !!r)
          // against what is stored (before this page is written): distinct bills an EARLIER page of this pass already had, and bills no pass had
          // (repeats inside a page are one bill used twice)
          const ov = pageOverlap(tin, pass, rows.map((r) => r.number))
          counts.rows += rows.length
          counts.overlap += ov.overlap
          counts.added += ov.added
          const last = page + 1 >= totalPages
          const verdict = last ? passVerdict(counts, passIndex) : { done: false, stable: false }
          writeBillsPage(tin, pass, page, rows, { totalElements: res.totalElements, totalPages, pageSize: size }, verdict, deps.now())
          s.page = page + 1
          if (last) {
            s.stable = verdict.stable
            if (verdict.done) { page = -1; break }
            // another pass, other page boundaries
            pass++
            passIndex++
            page = 0
            break
          }
          page++
        }
        if (page === -1) break
        if (!totalPages) break
      }
      markRefreshed(tin, loadStartedAt, Math.max(0, billCountOf(tin) - before))
    }
  }
  if (stopped()) return
  if (!opts.fill) {
    s.state = 'done'
    s.phase = null
    return
  }

  // ---- FILL ----
  s.phase = 'fill'
  setKnownFeed(tin, feedCaseNumbers(tin)) // what the company's TIN lists already show is not asked for again
  const retryBefore = deps.now() - RETRY_MISSING_MS
  s.total = countMissingCases(tin, retryBefore)
  let failures = 0
  for (;;) {
    // the queue lives in the database: a batch at a time, newest registration first; everything answered is recorded, so it never comes back
    const batch = nextMissingCases(tin, retryBefore, BATCH)
    if (!batch.length) break
    for (const c of batch) {
      let r: CaseLean
      for (;;) {
        if (stopped()) return
        s.current = c.caseNumber
        try {
          r = await deps.getCase(c.courtType, c.caseNumber)
        } catch (e) {
          r = { kind: 'error', message: e instanceof Error ? e.message : String(e) }
        }
        if (r.kind !== 'error') break
        // proves nothing about the case: it is not marked tried, and the SAME case is asked again after the wait
        s.errors++
        failures++
        s.lastError = r.message
        if (failures >= MAX_FAILURES_IN_ROW) {
          s.state = 'paused'
          s.phase = null
          s.current = null
          s.lastError = `Sud tizimi ${failures} marta ketma-ket javob bermadi (${r.message}). Jarayon toʻxtatildi: keyinroq davom ettiring.`
          return
        }
        const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_FIRST_MS * 2 ** (failures - 1))
        s.waitingUntil = deps.now() + wait
        await deps.sleep(wait, signal)
        s.waitingUntil = null
      }
      failures = 0
      s.lastError = null
      s.done++
      const t = deps.now()
      if (r.kind === 'found') {
        const row = r.row ?? rowFromDetail(r.data, { caseNumber: c.caseNumber, court: c.court })
        writeDetail(c.courtType, c.caseNumber, r.data, t)
        addFound(tin, [{ courtType: c.courtType, row }], { [c.caseNumber]: { t, found: true } })
        s.found++
        s.seq++
        job.events.push({ seq: s.seq, courtType: c.courtType, row })
        if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS)
      } else {
        addFound(tin, [], { [c.caseNumber]: { t, found: false } })
        s.absent++
      }
      await deps.sleep(pace, signal)
    }
  }
  s.state = 'done'
  s.phase = null
  s.current = null
}
