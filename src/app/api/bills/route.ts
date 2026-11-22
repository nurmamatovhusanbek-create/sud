import { guard } from '@/server/middleware'
import { jsonFail } from '@/server/envelope'
import { getBillStatus } from '@/lib/billing'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/bills?invoice=NUMBER
 *   → the detailed status of ONE bill (plain JSON envelope), with its usage history (`historyList`): the receipt drawer asks for it when a
 *     receipt is opened, because a row of the stored bills has none.
 *
 * A company's bills are NOT read here any more: they are loaded by the background job (`/api/bill-cases`, `lib/bill-cases`), kept on disk
 * (`lib/bills-store`) and asked for by page (`/api/bills/query`). This route used to stream the first 100 bills of a company with a status
 * call each, which showed 100 of a bank's 241 541.
 */
export const GET = guard(async (req) => {
  const invoice = new URL(req.url).searchParams.get('invoice')?.trim()
  if (!invoice || !/^\d{6,20}$/.test(invoice)) return jsonFail('Kvitansiya raqami notoʻgʻri', 'bad_request', 400)
  try {
    const detail = await getBillStatus(invoice)
    return Response.json({ ok: true, data: { bill: detail } })
  } catch (e) {
    return jsonFail(e instanceof Error ? e.message : 'Kvitansiyani olib boʻlmadi', 'upstream_error', 502)
  }
})
