import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { caseJobStatus } from '@/lib/public-orders/company-job'
import { getChecked, lookupOrders } from '@/lib/public-orders/store'
import { normalizeCaseNumber } from '@/core/public-orders'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CASE_NUMBER_RE = /^\d+-[\d-]+\/\d+$/

/**
 * GET /api/public-orders/orders?caseNumber=4-1001-2619/21743
 * Instant: reads the LOCAL cache only (never the slow upstream search). `checked` says whether and when this
 * case was looked up, so «none published» can be told apart from «not checked yet».
 */
export const GET = guard(async (req) => {
  const raw = new URL(req.url).searchParams.get('caseNumber') ?? ''
  const caseNumber = normalizeCaseNumber(raw)
  if (!CASE_NUMBER_RE.test(caseNumber)) return jsonFail('Ish raqami notoʻgʻri', 'bad_request', 400)
  const [orders, checked] = await Promise.all([lookupOrders(caseNumber), getChecked(caseNumber)])
  return jsonOk({
    caseNumber,
    orders,
    checked: checked ? { at: checked.at, error: checked.error ?? null, seen: checked.seen } : null,
    downloading: caseJobStatus().state === 'running',
  })
}, { rateLimit: false }) // local cache read, never the upstream
