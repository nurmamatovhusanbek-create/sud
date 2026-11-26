import 'server-only'
import type { StoredOrder } from '@/core/public-orders'
import { parseBucket } from './db-buckets'
import { allChecked, allOrders, appendOrders, markChecked } from './public-orders/store'
import { readPdf, writePdf } from './public-orders/pdf-store'
import { purgeOrders, readPurged } from './public-orders/purged-store'

/**
 * The way back for the court orders in a backup (`orders:<yy>` records, `pdf:<id>` files): they go into THIS computer's orders folder
 * (`~/.sud-tizimi/public-orders`), which is not the database, so the restore of the database file does not carry them. Rules: nothing is ever deleted or
 * overwritten (an order id already here is skipped, a PDF already on disk is skipped), a PDF is written only if it really is one, and a check record is
 * made only where this computer has none (or an older one), so the policy «a published order is permanent, a checked case is not asked again at once»
 * keeps working on a computer that was just restored. The signature of a restored check is empty: the first change of the case asks again, which is the
 * conservative side.
 */

export interface OrdersRestored {
  /** order records added */
  records: number
  /** PDF files written */
  pdfs: number
  /** check records added («checked, nothing published», or the cases whose orders were restored) */
  checks: number
  /** buckets that could not be downloaded or read */
  failed: number
}

export const NONE: OrdersRestored = { records: 0, pdfs: 0, checks: 0, failed: 0 }

export const sum = (a: OrdersRestored, b: Partial<OrdersRestored>): OrdersRestored => ({ records: a.records + (b.records ?? 0), pdfs: a.pdfs + (b.pdfs ?? 0), checks: a.checks + (b.checks ?? 0), failed: a.failed + (b.failed ?? 0) })

const iso = (ms: number): string => new Date(ms > 0 ? ms : Date.now()).toISOString()

/** put one downloaded `orders:*` or `pdf:*` bucket into the orders folder */
export async function importOrdersBucket(name: string, text: Uint8Array): Promise<Partial<OrdersRestored>> {
  const b = parseBucket(name)
  if (!b) return {}
  if (b.kind === 'pdf') {
    const id = b.key!.toLowerCase()
    if (await readPdf(id)) return {} // already here
    if (Buffer.from(text.subarray(0, 5)).toString('latin1') !== '%PDF-') return { failed: 1 }
    try {
      await writePdf(id, text, { via: 'import' })
      return { pdfs: 1 }
    } catch {
      return { failed: 1 } // not an order file id, or the disk refused
    }
  }
  if (b.kind !== 'orders') return {}
  const have = new Set((await allOrders()).map((o) => o.id))
  const fresh: StoredOrder[] = []
  const instancesByCase = new Map<string, Set<string>>()
  const savedAtByCase = new Map<string, number>()
  const noneAt = new Map<string, number>()
  // the orders the app removed on purpose (tombstones) come first: this computer learns them, and their records are not brought back
  const gone = new Set<string>()
  const tombs: Array<{ pdfId: string; caseNumber: string }> = []
  for (const l of Buffer.from(text).toString('utf8').split('\n')) {
    try {
      const r = JSON.parse(l) as unknown[]
      if (r[0] === 'x' && typeof r[1] === 'string') {
        gone.add(r[1].toLowerCase())
        tombs.push({ pdfId: r[1], caseNumber: typeof r[3] === 'string' ? r[3] : '' })
      }
    } catch { /* not a line */ }
  }
  if (tombs.length) await purgeOrders(tombs)
  const already = await readPurged()
  for (const l of Buffer.from(text).toString('utf8').split('\n')) {
    if (!l) continue
    let r: unknown[]
    try {
      r = JSON.parse(l) as unknown[]
    } catch {
      continue // a damaged line costs that order only
    }
    if (r[0] === 'x') continue
    if (r[0] === 'k') {
      if (typeof r[1] === 'string' && Number.isFinite(Number(r[2]))) noneAt.set(r[1], Number(r[2]))
      continue
    }
    const [id, caseNumber, instance, result, court, judge, category, pdfId, pdfName, pdfSize, courtType, savedAt] = r as [string, string, string, string, string, string, string, string, string, number, string, number]
    if (typeof id !== 'string' || typeof caseNumber !== 'string' || typeof pdfId !== 'string' || !id || !caseNumber || !pdfId) continue
    const set = instancesByCase.get(caseNumber) ?? instancesByCase.set(caseNumber, new Set()).get(caseNumber)!
    if (instance) set.add(instance)
    savedAtByCase.set(caseNumber, Math.max(savedAtByCase.get(caseNumber) ?? 0, Number(savedAt) || 0))
    if (have.has(id) || gone.has(pdfId.toLowerCase()) || already.has(pdfId.toLowerCase())) continue
    have.add(id)
    fresh.push({ id, caseNumber, instance: instance ?? '', result: result ?? '', court: court ?? '', judge: judge ?? '', category: category ?? '', pdfId, pdfName: pdfName ?? '', pdfSize: Number(pdfSize) || 0, courtType: (courtType || 'ECONOMIC') as StoredOrder['courtType'] })
  }
  await appendOrders(fresh)
  // a check record only where this computer has none: the cases whose orders came back are not «never checked»; a case checked with none keeps its date
  const mine = new Map((await allChecked()).map((c) => [c.caseNumber, c]))
  let checks = 0
  for (const [caseNumber, instances] of instancesByCase) {
    if (mine.has(caseNumber)) continue
    await markChecked({ caseNumber, at: iso(savedAtByCase.get(caseNumber) ?? 0), sig: '', seen: [...instances], misses: 0 })
    checks++
  }
  for (const [caseNumber, at] of noneAt) {
    const old = mine.get(caseNumber)
    if (old && Date.parse(old.at) >= at) continue
    if (instancesByCase.has(caseNumber)) continue
    await markChecked({ caseNumber, at: iso(at), sig: '', seen: [], misses: 0 })
    checks++
  }
  return { records: fresh.length, checks }
}
