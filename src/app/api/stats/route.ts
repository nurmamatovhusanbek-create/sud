import { guard, coalesce } from '@/server/middleware'
import { jsonOk, jsonFail } from '@/server/envelope'
import { statsSource } from '@/sources'
import { StirQuery } from '@/core/schemas'
import { logger } from '@/infra/logger'
import { config } from '@/server/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

const log = logger('api:stats')

/**
 * GET /api/stats?tin=302678824&force=1
 *
 * Aggregates all court cases (economic + civil + administrative) for a TIN via
 * the stats source adapter (orginfo + chamber + 3 court searches in parallel,
 * each classified WIN/LOSE/NEUTRAL/PENDING). Partial failures per court type
 * surface in `partial` — never silently dropped (arch guide A3).
 *
 * P4: auth + rate-limit + in-flight coalescing per TIN.
 */
export const GET = guard(async (req) => {
  const url = new URL(req.url)
  const tin = (url.searchParams.get('tin') || '').trim()
  const force = url.searchParams.get('force') === '1'

  const parsed = StirQuery.safeParse(tin)
  if (!parsed.success) {
    return jsonFail(parsed.error.issues[0]?.message ?? "STIR 9 ta raqam boʻlishi kerak", 'bad_request', 400)
  }

  const t0 = Date.now()
  try {
    const data = await coalesce(`stats:${tin}:${force ? 'f' : 'c'}`, () =>
      statsSource.run(tin, { force }),
    )
    log.info('stats built', { tin, elapsedMs: Date.now() - t0, cases: data.cases.length })
    return jsonOk(data, {
      partial: data.errors.map((e) => ({ source: `court:${e.courtType}`, error: e.error })),
      meta: { elapsedMs: Date.now() - t0 },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Statistikani olib bo\'lmadi'
    if (/vaqti tugadi|timed out/i.test(msg)) {
      return jsonFail(`Soʻrov vaqti tugadi (${Math.round(config.resilience.defaultTimeoutMs / 1000)}s+). Qayta urinib koʻring.`, 'timeout', 504)
    }
    log.error('stats failed', { tin, error: msg })
    return jsonFail(msg, 'upstream_error', 502)
  }
})
