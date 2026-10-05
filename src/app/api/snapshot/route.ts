import { guard } from '@/server/middleware'
import { jsonOk, jsonFail } from '@/server/envelope'
import { StirQuery } from '@/core/schemas'
import { dropSnapshot } from '@/lib/snapshot-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * DELETE /api/snapshot?tin=302678824
 *
 * Forgets the company's daily snapshot (stats, info, court lists, bills) when the operator removes the company from the
 * app. Only the snapshot file goes: it is a copy of what the sites said, and a re-search simply scrapes again.
 * Not privileged: the worst a forged call can do is make the next open scrape once (and the cross-site check refuses it).
 */
export const DELETE = guard(async (req) => {
  const tin = (new URL(req.url).searchParams.get('tin') || '').trim()
  if (!StirQuery.safeParse(tin).success) return jsonFail('STIR aynan 9 ta raqamdan iborat boʻlishi kerak', 'bad_request', 400)
  dropSnapshot(tin)
  return jsonOk({ tin })
})
