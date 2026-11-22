import { guard } from '@/server/middleware'
import { jsonFail, jsonOk } from '@/server/envelope'
import { compactDb } from '@/lib/db-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/** POST /api/settings/db/compact → VACUUM: gives back the space of deleted rows. Returns the size before and after. [privileged] */
export const POST = guard(
  async () => {
    try {
      return jsonOk(compactDb())
    } catch (e) {
      return jsonFail(e instanceof Error ? e.message : 'Siqib boʻlmadi', 'internal', 500)
    }
  },
  { privileged: true },
)
