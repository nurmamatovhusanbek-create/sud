import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { backupState, lastBackup, startBackup } from '@/lib/backup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * /api/settings/backup: the encrypted copy of the database in the operator's Telegram channel.
 *   GET  → the running/last job (phase, progress, message) and the last finished backup
 *   POST → start one { passphrase }: snapshot, gzip, AES-256-GCM pieces, manifest pinned [privileged]. The passphrase is not stored.
 */
export const GET = guard(async () => jsonOk({ state: backupState(), last: lastBackup() }), { rateLimit: false })

export const POST = guard(
  async (req) => {
    const body = (await req.json().catch(() => null)) as { passphrase?: unknown } | null
    const r = startBackup(typeof body?.passphrase === 'string' ? body.passphrase : '')
    return r.ok ? jsonOk({ state: backupState(), last: lastBackup() }) : jsonFail(r.error, 'bad_request', 400)
  },
  { privileged: true },
)
