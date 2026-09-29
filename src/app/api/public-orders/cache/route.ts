import { guard } from '@/server/middleware'
import { jsonOk } from '@/server/envelope'
import { cacheStats } from '@/lib/public-orders/store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/public-orders/cache — what the local orders cache holds (Settings › Qarorlar). Read-only: the cache is never deleted through the app. */
export const GET = guard(async () => jsonOk(await cacheStats()), { rateLimit: false }) // local disk read
