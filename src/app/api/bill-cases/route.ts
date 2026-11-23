import { guard } from '@/server/middleware'
import { jsonOk, jsonFail } from '@/server/envelope'
import { StirQuery } from '@/core/schemas'
import { billCasesStatus, eventsSince, jobStatus, startJob, stopJob } from '@/lib/bill-cases'
import { logger } from '@/infra/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const log = logger('api:bill-cases')

/**
 * The background job that loads ALL of a company's court bills and then asks the court for the cases they name that no TIN list shows
 * (`lib/bill-cases`). The job runs on the server; the page only watches it.
 *
 * GET  /api/bill-cases?tin=…[&after=N]  → what is stored (disk only, no site is asked: `status`), the job (`job`: state, phase, progress) and the
 *                                          cases it has found after event N (`events`, so an open list can append them live; `behind` = the page
 *                                          fell too far behind and should read the list again)
 * POST /api/bill-cases?tin=…&action=start&load=auto|refresh|skip&fill=1|0[&refresh=open]
 *                                          `refresh=open` INSTEAD asks the court again for the found cases that are not concluded (what changed is counted).
 *                                        → STARTED BY A CLICK (or by opening the Toʻlovlar tab of a company with no stored bills: `fill=0`).
 *                                          Returns at once. 409 when a job is already running (one at a time for the whole app).
 * POST /api/bill-cases?tin=…&action=stop → stops it after the current step; what was found stays.
 */
export const GET = guard(async (req) => {
  const sp = new URL(req.url).searchParams
  const tin = sp.get('tin') ?? ''
  if (!StirQuery.safeParse(tin).success) return jsonFail('STIR aynan 9 ta raqamdan iborat boʻlishi kerak', 'bad_request', 400)
  const after = Math.max(0, Math.trunc(Number(sp.get('after') ?? 0)) || 0)
  const ev = sp.has('after') ? eventsSince(tin, after) : { events: [], behind: false, seq: 0 }
  return jsonOk({ status: billCasesStatus(tin), job: jobStatus(tin), events: ev.events, behind: ev.behind })
})

export const POST = guard(async (req) => {
  const sp = new URL(req.url).searchParams
  const tin = sp.get('tin') ?? ''
  if (!StirQuery.safeParse(tin).success) return jsonFail('STIR aynan 9 ta raqamdan iborat boʻlishi kerak', 'bad_request', 400)
  const action = sp.get('action')
  if (action === 'stop') return jsonOk({ job: stopJob(tin) })
  if (action !== 'start') return jsonFail('action notoʻgʻri', 'bad_request', 400)
  const load = sp.get('load') ?? 'auto'
  if (load !== 'auto' && load !== 'refresh' && load !== 'skip') return jsonFail('load notoʻgʻri', 'bad_request', 400)
  try {
    const refresh = sp.get('refresh') === 'open' ? ('open' as const) : undefined
    const job = startJob(tin, { load, fill: sp.get('fill') === '1', refresh })
    log.info('bill job started', { load, fill: sp.get('fill') === '1', refresh: refresh ?? null })
    return jsonOk({ job })
  } catch (e) {
    return jsonFail(e instanceof Error ? e.message : 'Jarayonni boshlab boʻlmadi', 'conflict', 409)
  }
})
