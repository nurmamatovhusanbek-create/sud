import 'server-only'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { registeredKey } from '@/core/bill-cases'
import type { StoredOrder } from '@/core/public-orders'
import { dataDir } from './public-orders/data-dir'
import { readPdf, listPdfs } from './public-orders/pdf-store'
import { allChecked, allOrders } from './public-orders/store'

/**
 * The downloaded court orders as backup buckets (the bot's «Qarorlar»). The orders are not in the database: the records are in
 * `~/.sud-tizimi/public-orders/shards`, the PDFs in `…/files`. EVERY found order has its record in a backup (the bot shows an order that is not downloaded
 * as «yuklanmagan»: saved at = 0), only a downloaded one has its PDF, and a PDF with no record (a file dropped in by hand) has no case to belong to and
 * stays here.
 *
 *   orders:<yy>      one line per order: [id, case number, instance, result, court, judge, category, pdf id, file name, size, court type, saved at (0 = not
 *                    downloaded)], then one line per CHECKED case with no order at all: ["k", case number, checked at (ms)] («tekshirilgan: qaror yoʻq»)
 *   pdf:<pdf id>     the file itself
 *
 * They are rendered here, not in `db-buckets`, because they come from files (async), but they are named, merged and sealed like any bucket.
 */

export interface ExtraBucket {
  rows: number
  /** the bytes, or null when the source vanished since the listing */
  render: () => Promise<Buffer | null>
}

/** the case's registration year (two digits) from its number: 0 when the number does not say */
export function orderYear(caseNumber: string): number {
  const y = registeredKey(caseNumber)
  return y < 0 ? 0 : Math.floor(y / 100)
}

export const ordersBucketName = (year: number): string => `orders:${year}`
export const pdfBucketName = (pdfId: string): string => `pdf:${pdfId}`

/** a downloaded order's line in an `orders:<yy>` bucket */
export function orderLine(o: StoredOrder, savedAt: number): string {
  return JSON.stringify([o.id, o.caseNumber, o.instance, o.result, o.court, o.judge, o.category, o.pdfId.toLowerCase(), o.pdfName, o.pdfSize, o.courtType, Math.round(savedAt)])
}

/** a «checked, nothing published» line */
export const checkLine = (caseNumber: string, atMs: number): string => JSON.stringify(['k', caseNumber, Math.round(atMs)])

/** Every bucket the orders folder gives, by name, in a fixed order (records by year, then the PDFs by id). */
export async function orderBuckets(): Promise<Map<string, ExtraBucket>> {
  const out = new Map<string, ExtraBucket>()
  const pdfs = await listPdfs()
  const orders = await allOrders()
  const byYear = new Map<number, { orders: Array<{ id: string; line: string }>; checks: Array<{ n: string; line: string }> }>()
  const slot = (y: number) => byYear.get(y) ?? byYear.set(y, { orders: [], checks: [] }).get(y)!
  const linked = new Set<string>()
  const withOrders = new Set<string>()
  for (const o of orders) {
    const pid = (o.pdfId ?? '').toLowerCase()
    if (!pid) continue // nothing to download later either
    const file = pdfs.get(pid)
    if (file) linked.add(pid)
    withOrders.add(o.caseNumber)
    slot(orderYear(o.caseNumber)).orders.push({ id: o.id, line: orderLine(o, file?.savedAt ?? 0) })
  }
  // a case that was checked and has no order, without a failed attempt: «tekshirilgan, qaror eʼlon qilinmagan»
  for (const c of await allChecked()) {
    if (c.seen.length || c.error || withOrders.has(c.caseNumber)) continue
    const at = Date.parse(c.at)
    if (Number.isFinite(at)) slot(orderYear(c.caseNumber)).checks.push({ n: c.caseNumber, line: checkLine(c.caseNumber, at) })
  }
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
  for (const y of [...byYear.keys()].sort((a, b) => a - b)) {
    const s = byYear.get(y)!
    // one order of keys, the one `mergeBucketText` sorts by (an order's id, a check's «k:<case>»), so a merged copy and a rendered one are the same bytes
    const lines = [...s.orders.map((r) => ({ k: r.id, line: r.line })), ...s.checks.map((r) => ({ k: `k:${r.n}`, line: r.line }))].sort((a, b) => cmp(a.k, b.k)).map((r) => r.line)
    const text = Buffer.from(lines.join('\n') + '\n')
    out.set(ordersBucketName(y), { rows: lines.length, render: async () => text })
  }
  for (const pid of [...linked].sort()) {
    out.set(pdfBucketName(pid), { rows: 1, render: async () => { const b = await readPdf(pid); return b ? Buffer.from(b) : null } })
  }
  return out
}

/**
 * What the orders folder would add to a backup, as one short string (equal strings = nothing new): which PDFs are on disk and how big, and the shards'
 * sizes. Synchronous and cheap (names and sizes only: no file is read), so the automatic backup can ask every few minutes.
 */
export function ordersFingerprint(): string {
  const h = crypto.createHash('sha256')
  let dir: string
  try {
    dir = dataDir()
  } catch {
    return ''
  }
  const walk = (sub: string, ext: string): void => {
    let names: string[] = []
    try {
      names = fs.readdirSync(path.join(dir, sub)).filter((n) => n.endsWith(ext)).sort()
    } catch {
      return
    }
    for (const n of names) {
      try {
        h.update(`${sub}/${n}:${fs.statSync(path.join(dir, sub, n)).size}\n`)
      } catch {
        /* vanished while listing */
      }
    }
  }
  walk('files', '.pdf')
  walk('shards', '.jsonl')
  try {
    h.update(`checked:${fs.statSync(path.join(dir, 'checked.jsonl')).size}\n`)
  } catch {
    /* no check records yet */
  }
  return h.digest('hex')
}
