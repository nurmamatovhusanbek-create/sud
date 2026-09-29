import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { pauseCrawl, startCrawl } from '@/lib/public-orders/crawler'
import { PUBLIC_COURT_TYPES, type PublicCourtType } from '@/core/public-orders'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/public-orders/sync   { action: 'start' | 'pause', courtTypes?: ('ECONOMIC'|'CIVIL'|'ADMINISTRATIVE')[] }
 * Starts/pauses the background crawl of the public order library (a polite, sequential date-window walk).
 */
export const POST = guard(async (req) => {
  let body: { action?: string; courtTypes?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return jsonFail('JSON tanasi kerak', 'bad_request', 400)
  }
  if (body.action === 'pause') return jsonOk({ crawl: pauseCrawl() })
  if (body.action === 'start') {
    const asked = Array.isArray(body.courtTypes) ? body.courtTypes : ['ECONOMIC']
    const types = asked.filter((t): t is PublicCourtType => typeof t === 'string' && (PUBLIC_COURT_TYPES as string[]).includes(t))
    if (!types.length) return jsonFail('Kamida bitta sud turi kerak', 'bad_request', 400)
    return jsonOk({ crawl: startCrawl(types) })
  }
  return jsonFail("action 'start' yoki 'pause' boʻlishi kerak", 'bad_request', 400)
})
