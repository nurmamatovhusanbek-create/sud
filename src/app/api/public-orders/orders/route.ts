import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { crawlStatus } from '@/lib/public-orders/crawler'
import { getChecked, loadState, lookupOrders } from '@/lib/public-orders/store'
import { caseJobStatus } from '@/lib/public-orders/company-job'
import { normalizeCaseNumber } from '@/core/public-orders'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const CASE_NUMBER_RE = /^\d+-[\d-]+\/\d+$/

/**
 * GET /api/public-orders/orders?caseNumber=4-1001-2619/21743
 * Instant: reads the LOCAL index only (never the slow upstream search). `coverage` says how much of the
 * library has been indexed, so «no orders» can be told apart from «not indexed yet».
 */
export const GET = guard(async (req) => {
  const raw = new URL(req.url).searchParams.get('caseNumber') ?? ''
  const caseNumber = normalizeCaseNumber(raw)
  if (!CASE_NUMBER_RE.test(caseNumber)) return jsonFail('Ish raqami notoʻgʻri', 'bad_request', 400)
  const [orders, state, checked] = await Promise.all([lookupOrders(caseNumber), loadState(), getChecked(caseNumber)])
  const progress = Object.values(state.types)
  const dated = progress.filter((p) => p && p.oldest)
  return jsonOk({
    caseNumber,
    orders,
    /** when THIS case was looked up in the library (null = never) — tells «none published» from «not checked» */
    checked: checked ? { at: checked.at, found: checked.found, error: checked.error ?? null } : null,
    downloading: caseJobStatus().state === 'running',
    coverage: {
      indexed: dated.length > 0,
      since: dated.map((p) => p!.oldest!).sort()[0] ?? null,
      until: dated.map((p) => p!.newest ?? '').sort().at(-1) || null,
      complete: progress.length > 0 && progress.every((p) => p?.complete),
      running: crawlStatus().state === 'running',
    },
  })
})
