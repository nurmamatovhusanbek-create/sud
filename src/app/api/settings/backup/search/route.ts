import { guard } from '@/server/middleware'
import { jsonOk } from '@/server/envelope'
import { searchLocator } from '@/lib/telegram-index'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/settings/backup/search?q=2-1004-26   → where a case number, a bill number or a STIR is in the Telegram copy (prefix search, 3+ characters).
 * Reads only the local locator that the last «Kanaldagi kompaniyalar» brought: no Telegram, no site, a few milliseconds. `loaded` says the
 * company's data is in the local database already; if not, «Tanlanganlarni yuklash» brings it.
 */
export const GET = guard(async (req) => jsonOk(searchLocator(new URL(req.url).searchParams.get('q') ?? '')), { rateLimit: false })
