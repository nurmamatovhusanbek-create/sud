import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { MAX_HIDDEN_IDS, setHidden } from '@/lib/public-orders/hidden-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/public-orders/hidden   { action: 'hide' | 'restore', ids: string[] }
 *
 * «Tozalash» on the Qarorlar page: cleared orders leave the lists and counts, their records are KEPT (a search by case number
 * still finds them and offers «Yuklab olish»). Local state only; touches no site and no order record.
 */
export const POST = guard(
  async (req) => {
    let body: { action?: unknown; ids?: unknown } | null = null
    try {
      body = await req.json()
    } catch {
      /* falls through */
    }
    if (!body || (body.action !== 'hide' && body.action !== 'restore') || !Array.isArray(body.ids)) return jsonFail("action 'hide' / 'restore' va ids kerak", 'bad_request', 400)
    if (body.ids.length > MAX_HIDDEN_IDS) return jsonFail('Juda koʻp qaror bir vaqtda', 'too_large', 413)
    const r = await setHidden(body.action, body.ids as string[])
    return jsonOk(r)
  },
  { maxBodyBytes: 4 * 1024 * 1024 },
)
