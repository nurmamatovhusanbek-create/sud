import 'server-only'
import { db } from './pool'
import { normalizeName } from '@/lib/name-match'
import type { CourtCase, CourtType } from '@/lib/court-case-types'

/**
 * v205 (§5.4): Docket index repo — minimal discovery-only rows keyed by
 * (case_number, court_type). Full detail is fetched on demand by case number
 * through the existing getCaseDetails flow.
 */

export interface DocketRow {
  caseNumber: string
  courtType: CourtType
  caseId?: string | null
  courtId?: string | null
  courtName?: string | null
  plaintiff?: string | null
  plaintiffTin?: string | null
  defendant?: string | null
  defendantTin?: string | null
  hearingDate?: string | null // 'YYYY-MM-DD'
}

/** Upsert a batch of docket rows (idempotent on (case_number, court_type)).
 *  Per-row inside one transaction — simple and correct; batches are small
 *  (one court/date docket ≈ a few hundred rows). */
export async function upsertDocketRows(rows: DocketRow[]): Promise<void> {
  if (rows.length === 0) return
  const client = await db().connect()
  try {
    await client.query('BEGIN')
    for (const r of rows) {
      await client.query(
        `INSERT INTO case_docket
           (case_number, court_type, case_id, court_id, court_name,
            plaintiff, plaintiff_norm, plaintiff_tin,
            defendant, defendant_norm, defendant_tin, hearing_date, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
         ON CONFLICT (case_number, court_type) DO UPDATE SET
           case_id = COALESCE(EXCLUDED.case_id, case_docket.case_id),
           court_id = COALESCE(EXCLUDED.court_id, case_docket.court_id),
           court_name = COALESCE(EXCLUDED.court_name, case_docket.court_name),
           plaintiff = COALESCE(EXCLUDED.plaintiff, case_docket.plaintiff),
           plaintiff_norm = COALESCE(EXCLUDED.plaintiff_norm, case_docket.plaintiff_norm),
           plaintiff_tin = COALESCE(EXCLUDED.plaintiff_tin, case_docket.plaintiff_tin),
           defendant = COALESCE(EXCLUDED.defendant, case_docket.defendant),
           defendant_norm = COALESCE(EXCLUDED.defendant_norm, case_docket.defendant_norm),
           defendant_tin = COALESCE(EXCLUDED.defendant_tin, case_docket.defendant_tin),
           hearing_date = COALESCE(EXCLUDED.hearing_date, case_docket.hearing_date),
           last_seen = now()`,
        [
          r.caseNumber, r.courtType, r.caseId ?? null, r.courtId ?? null,
          r.courtName ?? null,
          r.plaintiff ?? null, normalizeName(r.plaintiff), r.plaintiffTin ?? null,
          r.defendant ?? null, normalizeName(r.defendant), r.defendantTin ?? null,
          r.hearingDate ?? null,
        ],
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export interface DocketMatch {
  caseNumber: string
  courtType: CourtType
  courtName: string | null
  plaintiff: string | null
  defendant: string | null
  hearingDate: string | null
  side: 'plaintiff' | 'defendant'
  similarity: number
  tinConfirmed?: boolean
}

/**
 * Find cases where `name` (and optionally `tin`) matches either party.
 * Trigram similarity ≥ threshold; a TIN exact-match is always included and
 * ranked first (TIN-confirmed).
 *
 * Note: `%` is the pg_trgm similarity operator (GIN-indexed prefilter at the
 * session default 0.3); the explicit `similarity >= threshold` filter below
 * then applies the stricter cutoff, so results are exact for `threshold`.
 */
export async function findCasesByName(
  name: string,
  tin?: string,
  threshold = 0.45,
): Promise<DocketMatch[]> {
  const norm = normalizeName(name)
  if (!norm) return []
  const { rows } = await db().query(
    `WITH q AS (SELECT $1::text AS norm, $2::text AS tin)
     SELECT case_number, court_type, court_name, plaintiff, defendant, hearing_date,
            side, similarity, tin_confirmed
     FROM (
       SELECT case_number, court_type, court_name, plaintiff, defendant, hearing_date,
              'plaintiff'::text AS side,
              similarity(plaintiff_norm, (SELECT norm FROM q)) AS similarity,
              (plaintiff_tin IS NOT NULL AND plaintiff_tin = (SELECT tin FROM q)) AS tin_confirmed
       FROM case_docket
       WHERE plaintiff_norm % (SELECT norm FROM q)
          OR (plaintiff_tin IS NOT NULL AND plaintiff_tin = (SELECT tin FROM q))
       UNION ALL
       SELECT case_number, court_type, court_name, plaintiff, defendant, hearing_date,
              'defendant'::text AS side,
              similarity(defendant_norm, (SELECT norm FROM q)) AS similarity,
              (defendant_tin IS NOT NULL AND defendant_tin = (SELECT tin FROM q)) AS tin_confirmed
       FROM case_docket
       WHERE defendant_norm % (SELECT norm FROM q)
          OR (defendant_tin IS NOT NULL AND defendant_tin = (SELECT tin FROM q))
     ) m
     WHERE m.tin_confirmed OR m.similarity >= $3
     ORDER BY m.tin_confirmed DESC, m.similarity DESC
     LIMIT 500`,
    [norm, tin ?? null, threshold],
  )
  // Keep the session threshold in sync with the explicit `>= $3` filter.
  return rows.map((r: Record<string, unknown>) => ({
    caseNumber: r.case_number as string,
    courtType: r.court_type as CourtType,
    courtName: (r.court_name as string | null) ?? null,
    plaintiff: (r.plaintiff as string | null) ?? null,
    defendant: (r.defendant as string | null) ?? null,
    hearingDate: r.hearing_date
      ? new Date(r.hearing_date as string).toISOString().slice(0, 10)
      : null,
    side: r.side as 'plaintiff' | 'defendant',
    similarity: Number(r.similarity),
    tinConfirmed: Boolean(r.tin_confirmed),
  }))
}

/**
 * v205 (§6.2): Map an index match to a CourtCase-shaped row so name-discovery
 * results flow through the existing Cases UI (table + detail drawer unchanged).
 * Discovered rows are thin: fields the docket does not store render as '-'.
 */
export function docketMatchToCourtCase(
  m: DocketMatch,
): CourtCase & { source: 'name'; courtType: CourtType; matchScore: number } {
  return {
    caseNumber: m.caseNumber,
    caseType: '-',
    caseStatus: '-',
    result: '-',
    courtName: m.courtName || '-',
    dateFiled: m.hearingDate || '-',
    plaintiff: m.plaintiff || '-',
    defendant: m.defendant || '-',
    claimAmount: '-',
    hearingDate: m.hearingDate || '',
    hearingTime: '',
    judge: '',
    source: 'name',
    courtType: m.courtType,
    matchScore: m.similarity,
  }
}
