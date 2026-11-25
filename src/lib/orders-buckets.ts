import 'server-only'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { registeredKey } from '@/core/bill-cases'
import type { StoredOrder } from '@/core/public-orders'
import { dataDir } from './public-orders/data-dir'
import { readPdf, listPdfs } from './public-orders/pdf-store'
import { allOrders } from './public-orders/store'

/**
 * The downloaded court orders as backup buckets (the bot's «Qarorlar»). The orders are not in the database: the records are in
 * `~/.sud-tizimi/public-orders/shards`, the PDFs in `…/files`. Only orders whose PDF is on disk go into a backup (an order that was found but never
 * downloaded has nothing for the bot to send), and a PDF with no record (a file dropped in by hand) has no case to belong to and stays here.
 *
 *   orders:<yy>      one line per order: [id, case number, instance, result, court, judge, category, pdf id, file name, size, court type, saved at]
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

/** Every bucket the orders folder gives, by name, in a fixed order (records by year, then the PDFs by id). */
export async function orderBuckets(): Promise<Map<string, ExtraBucket>> {
  const out = new Map<string, ExtraBucket>()
  const pdfs = await listPdfs()
  if (!pdfs.size) return out
  const byYear = new Map<number, Array<{ id: string; line: string }>>()
  const linked = new Set<string>()
  for (const o of await allOrders()) {
    const pid = (o.pdfId ?? '').toLowerCase()
    const file = pid ? pdfs.get(pid) : undefined
    if (!file) continue
    linked.add(pid)
    const y = orderYear(o.caseNumber)
    byYear.set(y, [...(byYear.get(y) ?? []), { id: o.id, line: orderLine(o, file.savedAt) }])
  }
  for (const y of [...byYear.keys()].sort((a, b) => a - b)) {
    const rows = byYear.get(y)!.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const text = Buffer.from(rows.map((r) => r.line).join('\n') + '\n')
    out.set(ordersBucketName(y), { rows: rows.length, render: async () => text })
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
  return h.digest('hex')
}
