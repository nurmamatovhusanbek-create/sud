import { guard } from '@/server/middleware'
import { jsonOk } from '@/server/envelope'
import { purgeHiddenOrders } from '@/lib/public-orders/purge-hidden'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/public-orders/purge-hidden   (no body)
 *
 * «Tozalangan» › «Butunlay oʻchirish»: every order the person cleared is removed in its entirety (record out of the metadata, PDF
 * file deleted). Destructive, so it is `privileged`. Local only; touches no site. → { purged, files }
 */
export const POST = guard(async () => jsonOk(await purgeHiddenOrders()), { privileged: true })
