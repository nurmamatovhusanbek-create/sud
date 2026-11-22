import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { readRemoteCatalog } from '@/lib/backup'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/settings/backup/catalog   Body: { passphrase }
 * Opens the pinned manifest in the channel and lists the companies it holds (tin, first-scrape and «as of» dates, bills, found cases). Reads one
 * small file, and brings the locator (the index buckets that changed) for the search; saves the list locally so the app can offer a company before it scrapes the sites for it. [privileged: it uses the bot and the passphrase]
 */
export const POST = guard(
  async (req) => {
    const body = (await req.json().catch(() => null)) as { passphrase?: unknown } | null
    const r = await readRemoteCatalog(typeof body?.passphrase === 'string' ? body.passphrase : '')
    return r.ok ? jsonOk({ ...r.catalog, index: r.index, indexError: r.indexError }) : jsonFail(r.error, 'bad_request', 400)
  },
  { privileged: true },
)
