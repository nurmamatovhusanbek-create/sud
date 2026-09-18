import 'server-only'
import { db, docketEnabled } from '@/lib/db/pool'
import { upsertDocketRows, type DocketRow } from '@/lib/db/docket-repo'
import { getCrawlTargets, type CrawlTarget } from './court-list'
import { fetchVka, type VkaRow } from './vka'

/**
 * v205 (§5.7): Crawl loop for the docket index.
 *
 * LIVE-VERIFIED (2026-09): vka serves ONLY today/future dockets (past date ->
 * 400). So the sweep walks today -> +WINDOW_FUTURE_DAYS and the index
 * ACCUMULATES history: a row captured while its hearing was upcoming is
 * retained for RETENTION_DAYS after the hearing passes (pruneOldDockets).
 * There is no historical backfill path via vka.
 */

const WINDOW_FUTURE_DAYS = Number(process.env.CRAWLER_FUTURE_DAYS ?? 35)
const RETENTION_DAYS = 90
const CONCURRENCY = 10 // matches the worker pool size

// Uzbekistan court holidays (MM-DD), same list jadval2.ts uses.
const COURT_HOLIDAYS = new Set([
  '01-01', '01-02', '03-08', '03-21', '03-22',
  '05-09', '09-01', '10-01', '12-08',
])

function* dateWindow(): Generator<Date> {
  const start = new Date()
  const end = new Date()
  end.setDate(end.getDate() + WINDOW_FUTURE_DAYS)
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (d.getDay() === 0 || d.getDay() === 6) continue // weekends: no hearings
    if (COURT_HOLIDAYS.has(mmdd)) continue
    yield new Date(d)
  }
}

function toDocketRows(rows: VkaRow[], t: CrawlTarget): DocketRow[] {
  return rows
    .filter((r) => r.casenumber)
    .map((r) => ({
      caseNumber: r.casenumber,
      courtType: t.courtType,
      caseId: r.case_id ?? null,
      courtId: t.courtId,
      courtName: r.court ?? t.courtName,
      plaintiff: r.claiment ?? null, // API typo "claiment" = plaintiff
      defendant: r.defendant ?? null,
      plaintiffTin: null, // vka has no TINs; TIN-confirm happens via findByTin results
      defendantTin: null,
      hearingDate: isoFromDdMmYyyy(r.hearing_date),
    }))
}

function isoFromDdMmYyyy(s?: string): string | null {
  const m = s?.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

export interface CrawlSweepResult {
  fetched: number
  notModified: number
  upserted: number
  skipped: boolean
}

/** One full sweep of the upcoming window across all targets, honoring ETags. */
export async function runCrawlSweep(signal?: AbortSignal): Promise<CrawlSweepResult> {
  if (!docketEnabled()) return { fetched: 0, notModified: 0, upserted: 0, skipped: true }
  const targets = getCrawlTargets()
  const jobs: { t: CrawlTarget; date: Date }[] = []
  for (const t of targets) for (const date of dateWindow()) jobs.push({ t, date })

  let fetched = 0
  let notModified = 0
  let upserted = 0
  // simple bounded-concurrency worker
  let i = 0
  async function worker(): Promise<void> {
    while (i < jobs.length) {
      if (signal?.aborted) return
      const { t, date } = jobs[i++]
      const dateIso = date.toISOString().slice(0, 10)
      try {
        const prior = await db().query(
          'SELECT etag FROM crawl_state WHERE court_id=$1 AND court_type=$2 AND docket_date=$3',
          [t.courtId, t.courtType, dateIso],
        )
        const priorEtag = prior.rows[0]?.etag ?? null
        const res = await fetchVka(t.courtId, t.courtType, date, priorEtag)
        fetched++
        if (res.notModified) {
          notModified++
          continue
        }
        if (res.status !== 200) continue // transient — next sweep retries
        const docketRows = toDocketRows(res.rows, t)
        await upsertDocketRows(docketRows)
        upserted += docketRows.length
        await db().query(
          `INSERT INTO crawl_state (court_id, court_type, docket_date, etag, row_count, fetched_at)
           VALUES ($1,$2,$3,$4,$5, now())
           ON CONFLICT (court_id, court_type, docket_date)
           DO UPDATE SET etag=EXCLUDED.etag, row_count=EXCLUDED.row_count, fetched_at=now()`,
          [t.courtId, t.courtType, dateIso, res.etag, docketRows.length],
        )
      } catch {
        /* transient — next sweep retries */
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return { fetched, notModified, upserted, skipped: false }
}

/** Retention: keep the rolling window tight. */
export async function pruneOldDockets(): Promise<void> {
  if (!docketEnabled()) return
  await db().query(
    `DELETE FROM case_docket WHERE hearing_date < (current_date - INTERVAL '${RETENTION_DAYS} days')`,
  )
  await db().query(
    `DELETE FROM crawl_state WHERE docket_date < (current_date - INTERVAL '${RETENTION_DAYS} days')`,
  )
}
