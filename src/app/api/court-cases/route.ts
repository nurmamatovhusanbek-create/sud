import { guard, coalesce } from '@/server/middleware'
import { jsonOk, jsonFail } from '@/server/envelope'
import { courtCasesSource, courtListSource, caseDetailSource } from '@/sources'
import { viaSnapshot, type SnapshotPart } from '@/lib/snapshot-store'
import { StirQuery, PinflQuery, CourtTypeQuery } from '@/core/schemas'
import { logger } from '@/infra/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const log = logger('api:court-cases')

const SNAPSHOT_COURTS = new Set(['economic', 'civil', 'administrative'])
const CASE_NUMBER_RE = /^\d+-[\d-]+\/\d+$/

/**
 * GET /api/court-cases?courtType=economic&mode=tin&value=302678824
 *   → case search via the court-cases adapter (worker-routed racing preserved)
 * GET /api/court-cases?courtType=economic&detail=4-1001-2605/14720
 *   → full case detail (instances, hearings, decisions)
 */
export const GET = guard(async (req) => {
  const url = new URL(req.url)
  const courtTypeRaw = url.searchParams.get('courtType')
  const modeRaw = url.searchParams.get('mode')
  const value = url.searchParams.get('value')
  const detail = url.searchParams.get('detail')

  // Case-detail mode
  if (detail) {
    const ct = CourtTypeQuery.safeParse(courtTypeRaw)
    if (!ct.success) return jsonFail("courtType notoʻgʻri", 'bad_request', 400)
    // the number becomes part of an upstream URL path: only the case-number shape gets there
    if (!CASE_NUMBER_RE.test(detail)) return jsonFail('Ish raqami formati: X-XXXX-XXXX/XXXXX', 'bad_request', 400)
    try {
      const data = await coalesce(`case-detail:${ct.data}:${detail}`, () =>
        caseDetailSource.run({ courtType: ct.data, caseNumber: detail }),
      )
      return jsonOk(data)
    } catch (e) {
      return jsonFail(e instanceof Error ? e.message : "Ish tafsilotlarini olib boʻlmadi", 'upstream_error', 502)
    }
  }

  // Search mode
  if (!courtTypeRaw || !modeRaw || !value) {
    return jsonFail('Missing parameters. Required: courtType, mode, value', 'bad_request', 400)
  }
  const ct = CourtTypeQuery.safeParse(courtTypeRaw)
  if (!ct.success) return jsonFail("courtType notoʻgʻri", 'bad_request', 400)
  if (!['tin', 'caseNumber', 'pinfl'].includes(modeRaw)) {
    return jsonFail("mode notoʻgʻri", 'bad_request', 400)
  }
  const mode = modeRaw as 'tin' | 'caseNumber' | 'pinfl'

  if (mode === 'tin') {
    const v = StirQuery.safeParse(value)
    if (!v.success) return jsonFail("STIR aynan 9 ta raqamdan iborat boʻlishi kerak", 'bad_request', 400)
  }
  if (mode === 'pinfl') {
    const v = PinflQuery.safeParse(value)
    if (!v.success) return jsonFail("PINFL aynan 14 ta raqamdan iborat boʻlishi kerak", 'bad_request', 400)
  }
  if (mode === 'caseNumber' && !CASE_NUMBER_RE.test(value)) {
    return jsonFail(
      'Ish raqami formati: X-XXXX-XXXX/XXXXX (masalan, 4-1001-2605/14720 yoki 4-10-2514/671)',
      'bad_request',
      400,
    )
  }

  try {
    // a company's court list (economic / civil / administrative) is kept for a day; `force=1` is the hard refresh
    if (mode === 'tin' && SNAPSHOT_COURTS.has(ct.data)) {
      const force = url.searchParams.get('force') === '1'
      const served = await coalesce(`court-snap:${ct.data}:${value}:${force ? 'f' : 'c'}`, () =>
        viaSnapshot(
          value,
          `court:${ct.data}` as SnapshotPart,
          { force, storable: (r) => !r.incomplete },
          () => courtListSource.run({ courtType: ct.data, mode, value }, { force }),
        ),
      )
      return jsonOk({ cases: served.data.cases }, {
        meta: { cached: served.fromSnapshot, fetchedAt: served.fetchedAt, ...(served.stale ? { stale: true } : {}) },
      })
    }
    const cases = await coalesce(`court:${ct.data}:${mode}:${value}`, () =>
      courtCasesSource.run({ courtType: ct.data, mode, value }),
    )
    return jsonOk({ cases })
  } catch (e) {
    log.error('court search failed', { courtType: ct.data, error: e instanceof Error ? e.message : String(e) })
    return jsonFail(e instanceof Error ? e.message : "Sud ishlarini qidirib boʻlmadi", 'upstream_error', 502)
  }
})
