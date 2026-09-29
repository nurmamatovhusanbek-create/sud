import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { enqueueCases, pauseCases } from '@/lib/public-orders/company-job'
import { normalizeCaseNumber, PUBLIC_COURT_OF, PUBLIC_COURT_TYPES, type PublicCourtType } from '@/core/public-orders'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CASE_NUMBER_RE = /^\d+-[\d-]+\/\d+$/
const MAX_CASES = 500

/**
 * POST /api/public-orders/fetch
 *   { action: 'start', cases: [{ caseNumber, courtType }] }   courtType: economic|civil|administrative (or the API's ECONOMIC…)
 *   { action: 'pause' }
 * Queues the given cases for a BACKGROUND lookup of their published orders and returns at once; the global
 * loader and the case drawer follow progress through /status. Requests join one queue.
 */
export const POST = guard(async (req) => {
  let body: { action?: string; cases?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return jsonFail('JSON tanasi kerak', 'bad_request', 400)
  }
  if (body.action === 'pause') return jsonOk({ job: pauseCases() })
  if (body.action !== 'start' || !Array.isArray(body.cases)) return jsonFail("action 'start' + cases yoki 'pause' kerak", 'bad_request', 400)

  const cases: { caseNumber: string; courtType: PublicCourtType }[] = []
  for (const c of body.cases.slice(0, MAX_CASES) as { caseNumber?: unknown; courtType?: unknown }[]) {
    const caseNumber = normalizeCaseNumber(typeof c?.caseNumber === 'string' ? c.caseNumber : '')
    const ct = typeof c?.courtType === 'string' ? c.courtType : ''
    const courtType = (PUBLIC_COURT_OF as Record<string, PublicCourtType>)[ct] ?? ((PUBLIC_COURT_TYPES as string[]).includes(ct) ? (ct as PublicCourtType) : null)
    if (CASE_NUMBER_RE.test(caseNumber) && courtType) cases.push({ caseNumber, courtType })
  }
  if (!cases.length) return jsonFail('Yaroqli ish raqami topilmadi', 'bad_request', 400)
  return jsonOk({ job: enqueueCases(cases), queued: cases.length })
})
