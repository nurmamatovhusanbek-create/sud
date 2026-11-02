import { guard } from '@/server/middleware'
import { jsonOk, jsonFail } from '@/server/envelope'
import { StirQuery } from '@/core/schemas'
import { getQuickRating } from '@/lib/rating-service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * GET /api/rating?tin=XXXXXXXXX[&force=1]
 *
 * Only the chamber.uz contractor rating: one small request, answered in about a second, apart from the heavy stats
 * scrape (court searches). The cards and the company header ask this first so the rating never waits for the courts.
 * A source that cannot be reached is reported in `partial`; the client then keeps the rating it already has.
 */
export const GET = guard(async (req) => {
  const url = new URL(req.url)
  const tin = (url.searchParams.get('tin') || '').trim()
  const parsed = StirQuery.safeParse(tin)
  if (!parsed.success) return jsonFail('STIR aynan 9 ta raqamdan iborat boʻlishi kerak', 'bad_request', 400)
  const t0 = Date.now()
  const r = await getQuickRating(tin, { force: url.searchParams.get('force') === '1' })
  return jsonOk(
    { rating: r.category ? { category: r.category, score: r.score } : null, name: r.name },
    { partial: r.failed ? [{ source: 'chamber', error: 'chamber.uz javob bermadi (reyting olinmadi)' }] : [], meta: { elapsedMs: Date.now() - t0 } },
  )
})
