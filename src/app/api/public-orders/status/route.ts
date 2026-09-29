import { guard } from '@/server/middleware'
import { jsonOk } from '@/server/envelope'
import { crawlStatus } from '@/lib/public-orders/crawler'
import { loadState } from '@/lib/public-orders/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/public-orders/status — the crawl job + how much of the library is indexed. */
export const GET = guard(async () => {
  const state = await loadState()
  return jsonOk({ crawl: crawlStatus(), types: state.types, updatedAt: state.updatedAt })
})
