import { guard, coalesce } from '@/server/middleware'
import { jsonOk, jsonFail } from '@/server/envelope'
import { StirQuery } from '@/core/schemas'
import { getCompanyCases } from '@/lib/court-aggregate'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * v205 (§6.4): GET /api/company-cases?tin=302678824
 *
 * ONE merged case list for a company STIR:
 *   1) live findByTin across economic + civil + administrative (existing engine),
 *   2) name discovery from the docket index (only when DATABASE_URL is set).
 *
 * Response envelope: { cases: AggCase[], partial: CourtType[] } — `partial`
 * lists court types whose live search failed entirely (drives the partial
 * banner; name discovery is best-effort and never reported as failure).
 */
export const GET = guard(async (req: Request) => {
  const tin = new URL(req.url).searchParams.get('tin')?.trim() || ''
  if (!StirQuery.safeParse(tin).success) {
    return jsonFail("STIR aynan 9 ta raqamdan iborat boʻlishi kerak", 'bad_request', 400)
  }
  try {
    const result = await coalesce(`company-cases:${tin}`, () => getCompanyCases(tin))
    return jsonOk(result)
  } catch (e) {
    return jsonFail(
      e instanceof Error ? e.message : "Sud ishlarini olib boʻlmadi",
      'upstream_error',
      502,
    )
  }
})
