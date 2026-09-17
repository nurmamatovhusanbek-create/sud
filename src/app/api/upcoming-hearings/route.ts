import { guard, coalesce } from '@/server/middleware'
import { jsonOk, jsonFail } from '@/server/envelope'
import { upcomingHearingsSource } from '@/sources'
import { StirQuery } from '@/core/schemas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * GET /api/upcoming-hearings?tin=302678824
 *
 * Searches economic/civil/administrative courts for cases with upcoming
 * hearings (criminal skipped for TINs — v121 rule preserved inside the
 * adapter), sorted by date+time. Partial source failures surface in `partial`.
 */
export const GET = guard(async (req) => {
  const url = new URL(req.url)
  const tin = (url.searchParams.get('tin') || '').trim()

  const parsed = StirQuery.safeParse(tin)
  if (!parsed.success) {
    return jsonFail("STIR aynan 9 ta raqamdan iborat boʻlishi kerak", 'bad_request', 400)
  }

  try {
    const data = await coalesce(`upcoming:${tin}`, () => upcomingHearingsSource.run(tin))
    return jsonOk({ tin, count: data.count, hearings: data.hearings })
  } catch (e) {
    return jsonFail(e instanceof Error ? e.message : "Majlislarni olib boʻlmadi", 'upstream_error', 502)
  }
})
