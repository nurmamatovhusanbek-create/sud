import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { MIN_PASSPHRASE } from '@/lib/backup-crypto'
import { verifyPassphrase } from '@/lib/backup'
import { autoStatus, disableAuto, enableAuto } from '@/lib/auto-backup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * /api/settings/backup/auto: the automatic backup (lib/auto-backup). Off until switched on.
 *   GET  → { enabled, hasPassphrase, lastOkAt, lastAttemptAt, failures, lastError, running }  (never the passphrase)
 *   POST { enabled: true, passphrase }  → checks the passphrase against the channel's chain, keeps it on this computer (0600) and switches on   [privileged]
 *   POST { enabled: false }             → switches off and DELETES the kept passphrase                                                      [privileged]
 */
export const GET = guard(async () => jsonOk(autoStatus()), { rateLimit: false })

export const POST = guard(
  async (req) => {
    const body = (await req.json().catch(() => null)) as { enabled?: unknown; passphrase?: unknown } | null
    if (body?.enabled === false) {
      disableAuto()
      return jsonOk(autoStatus())
    }
    if (body?.enabled !== true) return jsonFail('enabled true yoki false boʻlishi kerak', 'bad_request', 400)
    const pass = typeof body.passphrase === 'string' ? body.passphrase : ''
    if (pass.length < MIN_PASSPHRASE) return jsonFail(`Parol kamida ${MIN_PASSPHRASE} belgi boʻlishi kerak`, 'bad_request', 400)
    const v = await verifyPassphrase(pass)
    if (!v.ok) return jsonFail(v.error, 'bad_request', 400)
    enableAuto(pass)
    return jsonOk(autoStatus())
  },
  { privileged: true },
)
