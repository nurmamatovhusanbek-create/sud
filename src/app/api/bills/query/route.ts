import { guard } from '@/server/middleware'
import { jsonOk, jsonFail } from '@/server/envelope'
import { StirQuery } from '@/core/schemas'
import { billsOfCase, queryBills, readBillsMeta } from '@/lib/bills-store'
import { jobStatus } from '@/lib/bill-cases'
import { catalogFor } from '@/lib/telegram-catalog'
import type { BillQuery, BillSeg, BillSort, CategoryKind } from '@/core/bill-rows'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SEGS = new Set<BillSeg>(['all', 'paid', 'overdue'])
const SORTS = new Set<BillSort>(['new', 'old', 'az', 'za'])
const KINDS = new Set<CategoryKind>(['davlat_boji', 'pochta', 'other'])
const COURTS = new Set(['economic', 'civil', 'criminal', 'administrative'])
const CASE_NUMBER = /^\d+-[\d-]+\/\d+$/

/**
 * GET /api/bills/query?inn=…&page=1&size=20&sort=new|old|az|za&seg=all&q=…&court=civil&kind=pochta&case=2-1004-2603/8020
 *   → a page of the company's STORED bills (disk/memory only, no site is asked), how many match, the summary of ALL of them, the load's
 *     progress (`meta`: pages stored of how many) and the background job's state. The Toʻlovlar tab polls it while the load runs, so the
 *     first pages can be read and searched while the later ones still arrive.
 * GET /api/bills/query?inn=…&forCase=2-1004-2603/8020
 *   → that case's bills (usually two: state duty and postal costs): the case drawer's cross-reference.
 * `bills: null` = nothing is stored yet (the tab then starts the load, unless `inTelegram` says the channel holds the company: it then asks first).
 */
export const GET = guard(async (req) => {
  const sp = new URL(req.url).searchParams
  const inn = sp.get('inn') ?? ''
  if (!StirQuery.safeParse(inn).success) return jsonFail('STIR aynan 9 ta raqamdan iborat boʻlishi kerak', 'bad_request', 400)

  const forCase = sp.get('forCase')
  if (forCase) {
    if (!CASE_NUMBER.test(forCase)) return jsonFail('Ish raqami formati: X-XXXX-XXXX/XXXXX', 'bad_request', 400)
    return jsonOk({ bills: billsOfCase(inn, forCase) })
  }

  const seg = sp.get('seg') ?? 'all'
  const sort = sp.get('sort') ?? 'new'
  const kind = sp.get('kind')
  const court = sp.get('court')
  const caseNumber = sp.get('case')
  if (!SEGS.has(seg as BillSeg) || !SORTS.has(sort as BillSort) || (kind && !KINDS.has(kind as CategoryKind)) || (court && !COURTS.has(court)) || (caseNumber && !CASE_NUMBER.test(caseNumber))) {
    return jsonFail('Soʻrov parametrlari notoʻgʻri', 'bad_request', 400)
  }
  const f: BillQuery & { page: number; size: number } = {
    q: (sp.get('q') ?? '').slice(0, 80),
    seg: seg as BillSeg,
    sort: sort as BillSort,
    ...(kind ? { kind: kind as CategoryKind } : {}),
    ...(court ? { court: court as BillQuery['court'] } : {}),
    ...(caseNumber ? { caseNumber } : {}),
    page: Number(sp.get('page') ?? 1) || 1,
    size: Number(sp.get('size') ?? 20) || 20,
  }
  const bills = queryBills(inn, f)
  // nothing stored yet: say when the Telegram copy has the company, so the tab offers it instead of scraping straight away
  return jsonOk({ bills, meta: readBillsMeta(inn), job: jobStatus(inn), inTelegram: bills === null ? catalogFor(inn) : null })
})
