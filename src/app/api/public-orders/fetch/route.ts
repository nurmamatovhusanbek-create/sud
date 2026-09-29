import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { cancelCases, enqueueCases, pauseCases, resumeCases, retryFailed } from '@/lib/public-orders/company-job'
import { normalizeCaseNumber, PUBLIC_COURT_OF, PUBLIC_COURT_TYPES, type PublicCourtType } from '@/core/public-orders'
import type { JobCase } from '@/lib/public-orders/engine'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CASE_NUMBER_RE = /^\d+-[\d-]+\/\d+$/
const MAX_CASES = 1500

/**
 * POST /api/public-orders/fetch
 *   { action: 'start', force?: boolean, hold?: boolean (detect only: leave the run «ready»), keepPaused?: boolean, cases: [{ caseNumber, courtType, sig? }] }
 *      courtType: economic|civil|administrative (or the API's ECONOMIC…); sig = caseSignature() of the case data
 *   { action: 'pause' | 'resume' | 'cancel' }   pause keeps the queue (and its order); resume continues it; cancel drops it
 *   Cases still heard in the first instance (no result, ongoing status) are left out unless `force`: nothing can be published yet.
 * Queues the given cases for a BACKGROUND lookup of their published orders and returns at once; the global
 * loader and the case drawer follow progress through /status. Requests join one queue.
 */
export const POST = guard(async (req) => {
  let body: { action?: string; cases?: unknown; force?: unknown; keepPaused?: unknown; hold?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return jsonFail('JSON tanasi kerak', 'bad_request', 400)
  }
  if (body.action === 'pause') return jsonOk({ job: pauseCases() })
  if (body.action === 'resume') return jsonOk({ job: resumeCases() })
  if (body.action === 'cancel') return jsonOk({ job: cancelCases() })
  if (body.action === 'retry') return jsonOk(await retryFailed())
  if (body.action !== 'start' || !Array.isArray(body.cases)) return jsonFail("action 'start' + cases, yoki 'pause' / 'resume' / 'cancel' / 'retry' kerak", 'bad_request', 400)

  const cases: JobCase[] = []
  for (const c of body.cases.slice(0, MAX_CASES) as { caseNumber?: unknown; courtType?: unknown; sig?: unknown; result?: unknown; caseStatus?: unknown }[]) {
    const caseNumber = normalizeCaseNumber(typeof c?.caseNumber === 'string' ? c.caseNumber : '')
    const ct = typeof c?.courtType === 'string' ? c.courtType : ''
    const courtType = (PUBLIC_COURT_OF as Record<string, PublicCourtType>)[ct] ?? ((PUBLIC_COURT_TYPES as string[]).includes(ct) ? (ct as PublicCourtType) : null)
    const sig = typeof c?.sig === 'string' ? c.sig.slice(0, 300) : ''
    const result = typeof c?.result === 'string' ? c.result.slice(0, 300) : undefined
    const caseStatus = typeof c?.caseStatus === 'string' ? c.caseStatus.slice(0, 120) : undefined
    if (CASE_NUMBER_RE.test(caseNumber) && courtType) cases.push({ caseNumber, courtType, sig, result, caseStatus })
  }
  if (!cases.length) return jsonFail('Yaroqli ish raqami topilmadi', 'bad_request', 400)
  // DETECT happens here: `queued` = cases that really need a look; `ongoing` = still heard in the first instance (nothing
  // to publish); `known` = already known / waiting out the back-off. `hold` leaves the run «ready» until it is resumed.
  const { job, added, ongoing, known } = await enqueueCases(cases, { force: body.force === true, keepPaused: body.keepPaused === true, hold: body.hold === true })
  return jsonOk({ job, queued: added, ongoing, known })
})
