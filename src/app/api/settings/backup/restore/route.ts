import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { backupState, lastBackup, startRestore } from '@/lib/backup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/settings/backup/restore   Body: { passphrase }
 * Reads the pinned manifest in the channel, downloads and checks the pieces and writes `sud.restored-<time>.db` NEXT TO the live database.
 * The live database is not touched. [privileged]
 */
export const POST = guard(
  async (req) => {
    const body = (await req.json().catch(() => null)) as { passphrase?: unknown } | null
    const r = startRestore(typeof body?.passphrase === 'string' ? body.passphrase : '')
    return r.ok ? jsonOk({ state: backupState(), last: lastBackup() }) : jsonFail(r.error, 'bad_request', 400)
  },
  { privileged: true },
)
