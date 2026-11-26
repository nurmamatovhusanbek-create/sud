import { guard } from '@/server/middleware'
import { jsonOk } from '@/server/envelope'
import { pendingBackup } from '@/lib/backup-pending'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * GET /api/settings/backup/pending
 * What this computer holds that each backup channel does not hold yet (new and changed buckets, in words), from the local record of the last successful backup
 * of each channel against the database now (lib/backup-pending). Needs no passphrase, asks Telegram nothing and changes nothing.
 */
export const GET = guard(async () => jsonOk(await pendingBackup()), { rateLimit: false })
