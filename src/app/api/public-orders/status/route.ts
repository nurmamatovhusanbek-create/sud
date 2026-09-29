import { guard } from '@/server/middleware'
import { jsonOk } from '@/server/envelope'
import { crawlStatus } from '@/lib/public-orders/crawler'
import { caseJobStatus } from '@/lib/public-orders/company-job'
import { loadState } from '@/lib/public-orders/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/public-orders/status — the per-case download, the optional library crawl, and how much is indexed. */
export const GET = guard(async () => {
  const state = await loadState()
  return jsonOk({ crawl: crawlStatus(), job: caseJobStatus(), types: state.types, updatedAt: state.updatedAt })
})
