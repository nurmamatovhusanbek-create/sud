import { guard } from '@/server/middleware'
import { jsonOk } from '@/server/envelope'
import { PUBLIC_COURT_TYPES, searchLibrary, type LibraryStatus, type PublicCourtType } from '@/core/public-orders'
import { allOrders } from '@/lib/public-orders/store'
import { listPdfs, syncDownloads } from '@/lib/public-orders/pdf-store'
import { readHidden } from '@/lib/public-orders/hidden-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_PAGE = 100
const INSTANCES = ['FIRST', 'APPEAL', 'CASSATION', 'INSPECTION']

/**
 * GET /api/public-orders/library?q=&status=saved|gone|never|hidden|all&court=ECONOMIC|CIVIL|ADMINISTRATIVE|CRIMINAL&instance=FIRST|…&page=1&size=25
 * The Qarorlar page: the orders stored locally, each marked with whether its PDF is already on this computer, filtered
 * and paged on the server. Local disk only, never the upstream (so it is exempt from the scrape rate limit). Every
 * filter value is checked against a fixed list: nothing the client sends is used as anything but a comparison.
 */
export const GET = guard(async (req) => {
  const sp = new URL(req.url).searchParams
  const size = Math.min(MAX_PAGE, Math.max(1, Math.trunc(Number(sp.get('size'))) || 25))
  const page = Math.max(1, Math.trunc(Number(sp.get('page'))) || 1)
  const st = sp.get('status')
  const status: LibraryStatus = st === 'saved' || st === 'gone' || st === 'never' || st === 'hidden' ? st : 'all'
  const court = sp.get('court') ?? ''
  const instance = sp.get('instance') ?? ''
  const [orders, saved, hidden] = await Promise.all([allOrders(), listPdfs(), readHidden()])
  const history = await syncDownloads(saved) // the log of what was ever saved (+ files found on disk that it did not know)
  const r = searchLibrary(orders, saved, history, {
    q: (sp.get('q') ?? '').slice(0, 80),
    status,
    courtType: (PUBLIC_COURT_TYPES as string[]).includes(court) ? (court as PublicCourtType) : '',
    instance: INSTANCES.includes(instance) ? instance : '',
    hidden,
    offset: (page - 1) * size,
    limit: size,
  })
  return jsonOk({ ...r, page, size, savedPdfs: saved.size, stored: orders.length })
}, { rateLimit: false })
