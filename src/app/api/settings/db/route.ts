import { guard } from '@/server/middleware'
import { jsonOk } from '@/server/envelope'
import { dbStatus } from '@/lib/db-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/settings/db → the database's size, contents per table, court type and company, and how it was opened (no site is asked) */
export const GET = guard(async () => jsonOk(dbStatus()), { rateLimit: false })
