import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { caseJobStatus } from '@/lib/public-orders/company-job'
import { cacheStats, clearCache } from '@/lib/public-orders/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/public-orders/cache — what the local orders cache holds (Settings › Qarorlar). */
export const GET = guard(async () => jsonOk(await cacheStats()))

/** DELETE /api/public-orders/cache — forget everything (it can all be fetched again). Refused while a download runs. */
export const DELETE = guard(async () => {
  const s = caseJobStatus().state
  if (s === 'running' || s === 'paused') return jsonFail('Yuklash davom etmoqda yoki pauzada — avval tugating yoki bekor qiling', 'conflict', 409)
  await clearCache()
  return jsonOk({ cleared: true as const })
})
