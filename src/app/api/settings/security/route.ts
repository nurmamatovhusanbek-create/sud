import { guard } from '@/server/middleware'
import { jsonOk } from '@/server/envelope'
import { securitySnapshot } from '@/server/audit'
import { config } from '@/server/config'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/settings/security
 *   → what the perimeter refused and which dangerous doors were used since the server started (newest first),
 *     plus the posture the server runs with. Never values: no token, no host list, no query strings.
 */
export const GET = guard(
  async () => {
    const snap = securitySnapshot()
    return jsonOk({
      since: snap.since,
      counts: snap.counts,
      recent: snap.recent.slice(0, 60),
      posture: {
        tokenRequired: !!config.auth.apiToken,
        extraHosts: config.security.allowedHosts.length,
        trustProxy: config.security.trustProxy,
        supervised: !!process.env.SUD_SUPERVISED,
        production: config.env === 'production',
      },
    })
  },
  { rateLimit: false }, // memory read, polled while the tab is open
)
