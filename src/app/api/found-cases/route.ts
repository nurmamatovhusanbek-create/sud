import { guard } from '@/server/middleware'
import { jsonOk, jsonFail } from '@/server/envelope'
import { StirQuery } from '@/core/schemas'
import { queryFound } from '@/lib/case-store'
import type { CourtType } from '@/lib/court-case-types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const COURTS = new Set<string>(['economic', 'civil', 'criminal', 'administrative'])

/**
 * GET /api/found-cases?tin=…&court=civil&q=…&page=1&size=25&sort=new|old
 *   → ONE PAGE of the cases found by number from the company's bills (`lib/bill-cases`): the cases its TIN lists do not show. A big company
 *     has tens of thousands, so they are never sent whole. `byCourt` counts them per court type whatever the filter. Database only: no site
 *     is asked.
 */
export const GET = guard(async (req) => {
  const sp = new URL(req.url).searchParams
  const tin = sp.get('tin') ?? ''
  if (!StirQuery.safeParse(tin).success) return jsonFail('STIR aynan 9 ta raqamdan iborat boʻlishi kerak', 'bad_request', 400)
  const court = sp.get('court')
  const sort = sp.get('sort') ?? 'new'
  if ((court && !COURTS.has(court)) || (sort !== 'new' && sort !== 'old')) return jsonFail('Soʻrov parametrlari notoʻgʻri', 'bad_request', 400)
  return jsonOk(
    queryFound(tin, {
      ...(court ? { court: court as CourtType } : {}),
      q: (sp.get('q') ?? '').slice(0, 80),
      page: Number(sp.get('page') ?? 1) || 1,
      size: Number(sp.get('size') ?? 25) || 25,
      sort,
    }),
  )
})
