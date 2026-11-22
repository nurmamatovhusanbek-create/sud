import { guard } from '@/server/middleware'
import { jsonOk, jsonFail } from '@/server/envelope'
import { StirQuery } from '@/core/schemas'
import { billCasesStatus, runBillCases, type BillCasesEvent } from '@/lib/bill-cases'
import { logger } from '@/infra/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// a scan reads one page of bills at a time (a captcha each) and a fill asks the court case by case: minutes, not seconds
export const maxDuration = 600

const log = logger('api:bill-cases')

/**
 * GET  /api/bill-cases?tin=…                       → what is known (disk only, no site is asked): scan progress, case numbers named by the
 *                                                     bills, how many of them the stored lists lack
 * POST /api/bill-cases?tin=…&scan=auto|force|skip&limit=60
 *                                                   → STARTED BY A CLICK. Reads the bills (`auto`: only when never read or unfinished,
 *                                                     `force`: again, `skip`: not at all), then asks the court for up to `limit` of the case
 *                                                     numbers the lists lack, and streams NDJSON (`lib/bill-cases` BillCasesEvent).
 *                                                     Closing the connection stops it after the current step; what was found stays.
 */
export const GET = guard(async (req) => {
  const tin = new URL(req.url).searchParams.get('tin') ?? ''
  if (!StirQuery.safeParse(tin).success) return jsonFail('STIR aynan 9 ta raqamdan iborat boʻlishi kerak', 'bad_request', 400)
  return jsonOk(billCasesStatus(tin))
})

export const POST = guard(async (req) => {
  const sp = new URL(req.url).searchParams
  const tin = sp.get('tin') ?? ''
  if (!StirQuery.safeParse(tin).success) return jsonFail('STIR aynan 9 ta raqamdan iborat boʻlishi kerak', 'bad_request', 400)
  const scanRaw = sp.get('scan') ?? 'auto'
  if (scanRaw !== 'auto' && scanRaw !== 'force' && scanRaw !== 'skip') return jsonFail('scan notoʻgʻri', 'bad_request', 400)
  const n = Number(sp.get('limit') ?? 60)
  const limit = Number.isFinite(n) ? Math.min(100_000, Math.max(0, Math.trunc(n))) : 60 // 0 = read the bills only

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let open = true
      const send = (e: BillCasesEvent) => {
        if (open) controller.enqueue(enc.encode(JSON.stringify(e) + '\n'))
      }
      try {
        await runBillCases(tin, send, { scan: scanRaw, limit, signal: req.signal })
      } catch (e) {
        send({ type: 'error', error: e instanceof Error ? e.message : 'Ishlarni toʻlovlardan topib boʻlmadi' })
        log.warn('bill-cases failed', { error: e instanceof Error ? e.message : String(e) })
      } finally {
        open = false
        try { controller.close() } catch { /* the client already left */ }
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
  })
})
