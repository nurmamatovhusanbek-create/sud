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
import { tallyLinks } from '@/core/bill-link'
import { searchBillsByInn } from './billing'
import { toBillRow } from '@/core/bill-rows'
import { getCaseLean, type CaseLean } from './court-case'
import type { CourtCase, CourtType } from './court-case-types'
import { addFound, feedCaseNumbers, openFoundQueue, readFoundRow, triedStats, writeDetail } from './case-store'
import { billCaseCount, billCountOf, countMissingCases, nextMissingCases, pageOverlap, readBillsMeta, readPasses, recordPass, type PassLog, setKnownFeed, writeBillsPage } from './bills-store'
import { ensureCompany, markRefreshed, readCompany } from './company-meta'
import { estimateCoverage, passIndexOfSize, passSize, passVerdict } from '@/core/bill-passes'

/** a refresh skips the cases fetched more recently than this */
export const REFRESH_MIN_AGE_MS = 6 * 3_600_000

/** a case the court's APIs did not know is asked again only after this long (the old system's node is flaky: «not found» is not always true) */
export const RETRY_MISSING_MS = 14 * 24 * 60 * 60_000
/** the pause between two requests to the court (`CASE_FETCH_GAP_MS`) */
export const DEFAULT_PACE_MS = 1_200
/**
 * a billing page that failed is tried again this many times, `PAGE_RETRY_MS` × attempt apart (30 s, 60 s … about 15 minutes in all). Billing's captcha is
 * flaky for a client it scores low (a solved picture can still end in «Failed captcha check», measured on a 123 255-bill company: pages 11+ failed for
 * minutes while page 0 and others passed), so a background load waits and tries again for a long while before it gives up; what is stored stays.
 */
const PAGE_ATTEMPTS = 8
const PAGE_RETRY_MS = 30_000
/**
 * A big page that keeps failing is asked in SPLIT smaller requests of the same window (page index × SPLIT + j, size / SPLIT): measured on 207275139,
 * a 9 000-10 000 row page at an offset above ~100 000 was rejected («Failed captcha check») again and again, while 100-row pages at offsets up to
 * 123 000 passed at once. Billing's page sizes divide by SPLIT (see core/bill-passes), so the window is exactly the same rows' range.
 */
const SPLIT = 5
const SPLIT_AFTER = 3
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
  phase: 'load' | 'fill' | 'refresh' | null
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
  /** refresh: how many of the asked cases came back with a different status or hearing */
  changed: number
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
  /** what each pass of the load added (evidence that the union converges) and the estimated share of the company's bills with a case that is stored */
  passes: PassLog[]
  coverage: number | null
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

const idle = (): JobStatus => ({ tin: null, state: 'idle', phase: null, startedAt: null, page: 0, pages: 0, pass: 0, stable: false, bills: 0, done: 0, total: 0, found: 0, absent: 0, changed: 0, errors: 0, current: null, seq: 0, lastError: null, waitingUntil: null })

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
/** the latest estimate of how much of the company's bills with a case is stored (capture-recapture over the passes), null before a second pass */
function coverageOf(tin: string): number | null {
  const p = readPasses(tin)
  const last = p.at(-1)
  if (!last || p.length < 2) return null
  const stored = billCountOf(tin)
  const est = estimateCoverage(stored - last.added, last.rows - last.overlap, last.added)
  return est ? Math.round(est.coverage * 1000) / 1000 : null
}

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
    passes: readPasses(tin),
    coverage: coverageOf(tin),
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
  /** `open`: INSTEAD of a load and a fill, ask the court again for the cases found earlier that are not concluded (a manual refresh; what changed is counted) */
  refresh?: 'open'
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
  const mode = opts.refresh ? 'skip' : (opts.load ?? 'auto')
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
      // the first offset at which a full-size window had to be split: deeper windows start split (a full-size try there only costs minutes)
      let splitFrom: number | null = null
      for (;;) {
        if (stopped()) return
        const size = passSize(passIndex)
        const counts = { rows: 0, overlap: 0, added: 0, total: 0 }
        const links = tallyLinks([])
        // every bill number this pass has read (bills WITHOUT a case are not stored, so the database cannot tell a repeat): kept here. A pass resumed in
        // another process has lost the earlier pages' numbers: it is never called stable (another pass follows)
        const seen = new Set<string>()
        const resumedMidPass = page > 0
        let totalPages = 0
        s.pass = passIndex
        for (;;) {
          if (stopped()) return
          s.page = page
          // a page can fail on the captcha (billing hands out a token only when it scores the client high enough, or when the math is solved):
          // try again after a pause before giving the load up; the pages already stored stay and the next start resumes after them
          let res: Awaited<ReturnType<BillCasesDeps['searchBills']>> | null = null
          const parts: Array<Awaited<ReturnType<BillCasesDeps['searchBills']>> | undefined> = [] // answers of a split window, kept across attempts
          for (let attempt = 1; !res; attempt++) {
            try {
              const preSplit = splitFrom !== null && page * size >= splitFrom
              if (size % SPLIT !== 0 || (attempt <= SPLIT_AFTER && !preSplit)) {
                res = await deps.searchBills(tin, { page, size })
              } else {
                for (let j = 0; j < SPLIT; j++) parts[j] ??= await deps.searchBills(tin, { page: page * SPLIT + j, size: size / SPLIT })
                if (splitFrom === null || page * size < splitFrom) splitFrom = page * size
                const first = parts[0]!
                res = { ...first, content: parts.flatMap((x) => x?.content ?? []), pageNumber: page, pageSize: size, totalPages: Math.ceil(first.totalElements / size) }
              }
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
          const all = res.content.map(toBillRow).filter((r): r is NonNullable<typeof r> => !!r)
          // only a bill that names a case is kept: the others are of no use (and about a third of a bank's bills are such)
          const rows = all.filter((r) => r.caseNumber)
          // instability: distinct bills of this page that an EARLIER page of this pass already had (repeats inside a page are one bill used twice)
          const onPage = new Set(all.map((r) => r.number))
          let repeated = 0
          for (const nbr of onPage) if (seen.has(nbr)) repeated++
          for (const nbr of onPage) seen.add(nbr)
          // novelty: bills with a case that no earlier read stored (before this page is written)
          const ov = pageOverlap(tin, pass, rows.map((r) => r.number))
          counts.rows += all.length
          tallyLinks(res.content, links)
          counts.overlap += repeated
          counts.added += ov.added
          const last = page + 1 >= totalPages
          let verdict = last ? passVerdict(counts, passIndex) : { done: false, stable: false }
          if (last && resumedMidPass && verdict.stable) verdict = { done: false, stable: false }
          writeBillsPage(tin, pass, page, rows, { totalElements: res.totalElements, totalPages, pageSize: size }, verdict, deps.now())
          if (last) recordPass(tin, { pass: passIndex, size, rows: counts.rows, added: counts.added, overlap: counts.overlap, at: deps.now(), links: { text: links.text, claimCost: links.claimCost, unlinked: links.unlinked } })
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
  if (opts.refresh) return refreshOpen(job, tin, deps, pace, stopped)
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

/**
 * REFRESH: the cases found earlier that are not concluded are asked again, the longest unrefreshed first. Concluded cases (finished, archived,
 * refused) are never asked: they do not change. A case the court no longer answers for keeps its stored row (nothing is marked «tried»), a failed
 * request backs off like the fill does. What the court answers replaces the stored detail and row; a different status or hearing counts as changed.
 */
async function refreshOpen(job: Job, tin: string, deps: BillCasesDeps, pace: number, stopped: () => boolean): Promise<void> {
  const s = job.status
  const signal = job.abort.signal
  s.phase = 'refresh'
  // only cases not fetched in the last 6 hours: a refresh that was stopped and started again goes on where it was, a second click right after one does nothing
  const queue = openFoundQueue(tin, deps.now() - REFRESH_MIN_AGE_MS)
  s.total = queue.length
  let failures = 0
  for (const c of queue) {
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
    if (r.kind === 'found') {
      const before = readFoundRow(tin, c.courtType, c.caseNumber)
      const row = r.row ?? rowFromDetail(r.data, { caseNumber: c.caseNumber, court: before?.courtName ?? '' })
      writeDetail(c.courtType, c.caseNumber, r.data, deps.now())
      addFound(tin, [{ courtType: c.courtType, row }], {}, deps.now())
      s.found++
      if (!before || before.caseStatus !== row.caseStatus || before.hearingDate !== row.hearingDate || before.hearingTime !== row.hearingTime || before.result !== row.result) {
        s.changed++
        s.seq++
        job.events.push({ seq: s.seq, courtType: c.courtType, row })
        if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS)
      }
    } else {
      s.absent++
    }
    await deps.sleep(pace, signal)
  }
  s.state = 'done'
  s.phase = null
  s.current = null
}
