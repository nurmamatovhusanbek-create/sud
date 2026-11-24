import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { linkNow, linkStatus, setLink } from '@/lib/bot-link'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * /api/settings/bot-link: the link with the bot (lib/bot-link). Off until switched on.
 *   GET  → { enabled, url, hasBot, lastPullAt, lastPingAt, lastError, queued, running }
 *   POST { enabled: true, url }  → keeps the bot's address and switches on; the app starts asking the bot for work (outbound only)   [privileged]
 *   POST { enabled: false }      → switches off                                                                                      [privileged]
 */
export const GET = guard(async () => jsonOk(linkStatus()), { rateLimit: false })

export const POST = guard(
  async (req) => {
    const body = (await req.json().catch(() => null)) as { enabled?: unknown; url?: unknown } | null
    if (body?.enabled !== true && body?.enabled !== false) return jsonFail('enabled true yoki false boʻlishi kerak', 'bad_request', 400)
    const r = setLink(body.enabled, typeof body.url === 'string' ? body.url : undefined)
    if (!r.ok) return jsonFail(r.error, 'bad_request', 400)
    if (body.enabled) await linkNow() // the first look now: the page shows «ulandi» or the reason at once
    return jsonOk(linkStatus())
  },
  { privileged: true },
)
