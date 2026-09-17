import { guard, coalesce } from '@/server/middleware'
import { jsonOk, jsonFail } from '@/server/envelope'
import { companyInfoSource } from '@/sources'
import { StirQuery } from '@/core/schemas'
import { logger } from '@/infra/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const log = logger('api:company-info')

/**
 * GET /api/company-info?tin=XXXXXXXXX
 *
 * orginfo.uz profile + chamber.uz contractor rating, via the company-info
 * adapter. Both sources are independent: if either fails the other still
 * returns, with the failure listed in `partial` (arch guide §3.4 additive
 * change — errors[] finally reaches the client).
 */
export const GET = guard(async (req) => {
  const url = new URL(req.url)
  const tin = (url.searchParams.get('tin') || '').trim()
  const force = url.searchParams.get('force') === '1'

  const parsed = StirQuery.safeParse(tin)
  if (!parsed.success) {
    return jsonFail("STIR aynan 9 ta raqamdan iborat boʻlishi kerak", 'bad_request', 400)
  }

  const t0 = Date.now()
  try {
    const data = await coalesce(`company-info:${tin}:${force ? 'f' : 'c'}`, () =>
      companyInfoSource.run(tin, { force }),
    )
    log.info('company info built', { tin, elapsedMs: Date.now() - t0 })
    return jsonOk({ company: data.company, rating: data.rating }, {
      partial: data.partial,
      meta: { elapsedMs: Date.now() - t0 },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed'
    log.error('company-info failed', { tin, error: msg })
    return jsonFail(msg, 'upstream_error', 502)
  }
})
