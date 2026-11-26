import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { activePurged, restorePurged } from '@/lib/public-orders/purged-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * The orders the app removed from its metadata because their file could not be downloaded (lib/public-orders/purged-store).
 *
 *   GET   → { items: [{ pdfId, caseNumber, at }] }  (newest first, at most 500; `total` counts all)
 *   POST  { action: 'restore', ids?: string[] }     bring those back (no `ids` = all of them); returns { restored }
 *
 * Local state only: touches no site. The records were never deleted, so a restored order is in the lists again at once.
 */
export const GET = guard(
  async () => {
    const list = [...(await activePurged()).values()].sort((a, b) => b.at - a.at)
    return jsonOk({ total: list.length, items: list.slice(0, 500).map((p) => ({ pdfId: p.pdfId, caseNumber: p.caseNumber, at: p.at })) })
  },
  { rateLimit: false },
)

export const POST = guard(
  async (req) => {
    let body: { action?: unknown; ids?: unknown } | null = null
    try {
      body = await req.json()
    } catch {
      /* falls through */
    }
    if (!body || body.action !== 'restore' || (body.ids !== undefined && !Array.isArray(body.ids))) return jsonFail("action 'restore' kerak (ids ixtiyoriy)", 'bad_request', 400)
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string') : undefined
    return jsonOk({ restored: await restorePurged(ids) })
  },
  { maxBodyBytes: 2 * 1024 * 1024 },
)
