import { guard } from '@/server/middleware'
import { jsonFail } from '@/server/envelope'
import { getFullBillData, getBillStatus, type EnrichedBill, type Phase } from '@/lib/billing'
import { logger } from '@/infra/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Bill enrichment (60+ receipts × status fetch) can take 60-90s — a persistent
// Node runtime is assumed (blueprint §2), so maxDuration is a no-op self-hosted.
export const maxDuration = 120

const log = logger('api:bills')

/**
 * GET /api/bills?inn=XXXXXXXXX
 *   → searches billing.sud.uz (PoW/captcha flow preserved in the lib) and
 *     streams every enriched bill as NDJSON. The message union is the appʼs
 *     streaming contract, now typed on the client by streamBills():
 *       {"type":"meta","inn":"...","total":60}
 *       {"type":"phase","phase":"connecting|captcha|fetching|enriching","detail":"..."}
 *       {"type":"bill","index":0,"bill":{...}}
 *       {"type":"done","inn":"..."}
 *       {"type":"error","error":"..."}
 *
 * GET /api/bills?invoice=NUMBER
 *   → detailed status of a single bill (plain JSON envelope).
 */
export const GET = guard(async (req) => {
  const { searchParams } = new URL(req.url)
  const inn = searchParams.get('inn')?.trim()
  const invoice = searchParams.get('invoice')?.trim()

  // Single-bill detail lookup
  if (invoice) {
    try {
      const detail = await getBillStatus(invoice)
      return Response.json({ ok: true, data: { bill: detail } })
    } catch (e) {
      return jsonFail(e instanceof Error ? e.message : 'Kvitansiyani olib boʻlmadi', 'upstream_error', 502)
    }
  }

  if (!inn) {
    return jsonFail('Missing "inn" query parameter (company tax number, 9 digits)', 'bad_request', 400)
  }
  if (!/^\d{9}$/.test(inn)) {
    return jsonFail("STIR aynan 9 ta raqamdan iborat boʻlishi kerak (Yuridik shaxs)", 'bad_request', 400)
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      }
      const t0 = Date.now()
      try {
        // Stream phase events so the UI shows exactly whatʼs happening.
        await getFullBillData(
          inn,
          (loaded, total, bill: EnrichedBill) => {
            if (loaded === 1) {
              send({ type: 'meta', inn, total })
            }
            send({ type: 'bill', index: loaded - 1, bill })
          },
          (phase: Phase, detail?: string) => {
            send({ type: 'phase', phase, detail })
          },
        )
        send({ type: 'done', inn })
        log.info('bills streamed', { inn, elapsedMs: Date.now() - t0 })
      } catch (e) {
        send({
          type: 'error',
          error: e instanceof Error ? e.message : 'Toʻlovlarni olib boʻlmadi',
        })
        log.error('bills stream failed', { inn, error: e instanceof Error ? e.message : String(e) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
})
