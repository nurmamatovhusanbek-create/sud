import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { backupState, lastBackup, startLoad } from '@/lib/backup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/settings/backup/load   Body: { passphrase, tins: string[] }
 * Brings the chosen companies from the Telegram channel into the LIVE database (no file swap): their buckets and the case details of their cases.
 * Newer rows already in the database win. Nothing is scraped. Poll `GET /api/settings/backup` for progress. [privileged]
 */
export const POST = guard(
  async (req) => {
    const body = (await req.json().catch(() => null)) as { passphrase?: unknown; tins?: unknown } | null
    const r = startLoad(typeof body?.passphrase === 'string' ? body.passphrase : '', body?.tins)
    return r.ok ? jsonOk({ state: backupState(), last: lastBackup() }) : jsonFail(r.error, 'bad_request', 400)
  },
  { privileged: true },
)
