import { guard } from '@/server/middleware'
import { jsonFail } from '@/server/envelope'
import { getFullBillData, getBillStatus, type EnrichedBill, type Phase } from '@/lib/billing'
import { logger } from '@/infra/logger'
import { config } from '@/server/config'
import { readSnapshot, writeSnapshot } from '@/lib/snapshot-store'
import { billsStorable, replayLines, type BillsSnap } from '@/lib/bills-snapshot'

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
 * A finished list is kept for a day (`lib/snapshot-store`, part «bills») and replayed as the same stream, with
 * `cached:true` and `fetchedAt` in `meta` (no captcha, no scrape). `&force=1` (the hard refresh) always scrapes. A scrape
 * that fails BEFORE it sent anything falls back to an older snapshot (`stale:true`) instead of an error.
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

  const force = searchParams.get('force') === '1'
  const encoder = new TextEncoder()
  const snap = readSnapshot<BillsSnap>(inn, 'bills')
  const fresh = !!snap && Date.now() - snap.fetchedAt < config.snapshot.ttlMs
  const replay = (controller: ReadableStreamDefaultController, stale: boolean) => {
    for (const line of replayLines(inn, snap!, stale)) controller.enqueue(encoder.encode(line))
  }

  const stream = new ReadableStream({
    async start(controller) {
      // inside its day and not forced: no scrape at all
      if (snap && fresh && !force) {
        replay(controller, false)
        controller.close()
        log.info('bills replayed', { inn, bills: snap.data.bills.length })
        return
      }
      let sent = 0
      const send = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
      }
      const t0 = Date.now()
      try {
        // Stream phase events so the UI shows exactly whatʼs happening.
        const result = await getFullBillData(
          inn,
          (loaded, total, bill: EnrichedBill) => {
            if (loaded === 1) {
              send({ type: 'meta', inn, total })
            }
            sent++
            send({ type: 'bill', index: loaded - 1, bill })
          },
          (phase: Phase, detail?: string) => {
            send({ type: 'phase', phase, detail })
          },
        )
        const at = Date.now()
        // the final list (after the retry round), kept only when no bill is left with a transient error
        if (billsStorable(result.bills)) writeSnapshot(inn, 'bills', { total: result.bills.length, bills: result.bills } satisfies BillsSnap, at)
        send({ type: 'done', inn, fetchedAt: at })
        log.info('bills streamed', { inn, elapsedMs: at - t0 })
      } catch (e) {
        if (snap && !force && sent === 0) {
          // the sites failed before anything reached the client: show the last list we have, flagged
          replay(controller, true)
          log.warn('bills scrape failed, replayed an older snapshot', { inn, error: e instanceof Error ? e.message : String(e) })
        } else {
          send({
            type: 'error',
            error: e instanceof Error ? e.message : 'Toʻlovlarni olib boʻlmadi',
          })
          log.error('bills stream failed', { inn, error: e instanceof Error ? e.message : String(e) })
        }
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
