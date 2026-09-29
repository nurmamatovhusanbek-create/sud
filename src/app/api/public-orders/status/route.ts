import { guard } from '@/server/middleware'
import { jsonOk } from '@/server/envelope'
import { caseJobStatus } from '@/lib/public-orders/company-job'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/public-orders/status — the background download of published orders. */
export const GET = guard(async () => jsonOk({ job: caseJobStatus() }))
