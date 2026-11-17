import { guard } from '@/server/middleware'
import { jsonOk } from '@/server/envelope'
import { searchLibrary } from '@/core/public-orders'
import { allOrders } from '@/lib/public-orders/store'
import { listPdfs } from '@/lib/public-orders/pdf-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/public-orders/library?q=<case number or part>&saved=1&limit=50
 * Settings › Qarorlar search: the orders stored locally, each marked with whether its PDF is already on this computer.
 * Local disk only, never the upstream (so it is exempt from the scrape rate limit).
 */
export const GET = guard(async (req) => {
  const sp = new URL(req.url).searchParams
  const limit = Math.min(200, Math.max(1, Number(sp.get('limit')) || 50))
  const [orders, saved] = await Promise.all([allOrders(), listPdfs()])
  const r = searchLibrary(orders, saved, { q: (sp.get('q') ?? '').slice(0, 60), savedOnly: sp.get('saved') === '1', limit })
  return jsonOk({ ...r, savedPdfs: saved.size, stored: orders.length })
}, { rateLimit: false })
