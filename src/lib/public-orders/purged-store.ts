import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isOrderFileId } from '@/core/public-orders'
import { dataDir } from './data-dir'

/**
 * Orders the app REMOVED from its metadata because their file can never be downloaded (the site answers with something that is not a PDF, twice).
 * An append-only list `purged.jsonl` next to the order store, one line `{ pdfId, caseNumber, at }` (append-only like the shards, so the protected copy and
 * the merge rules for the other metadata files apply: `meta-backup` mirrors it). The order RECORDS stay in the shards (the store is never rewritten);
 * every reader (`allOrders`, `lookupOrders`, the Qarorlar lists, the backup, the restore) leaves out a record whose file id is listed here, and the backup
 * carries a tombstone line `["x", pdfId, at]` in the `orders:<yy>` bucket so a channel's older copy and the bot forget it too. To get one back, delete its
 * line from this file.
 */

export interface Purged {
  pdfId: string
  caseNumber: string
  at: number
}

const file = () => path.join(dataDir(), 'purged.jsonl')

let memo: { sig: string; map: Map<string, Purged> } | null = null
let chain: Promise<unknown> = Promise.resolve()

/** file id (lower case) → the tombstone. Re-read only when the file changed. */
export async function readPurged(): Promise<Map<string, Purged>> {
  const f = file()
  let st: Awaited<ReturnType<typeof fs.stat>> | null = null
  try {
    st = await fs.stat(f)
  } catch {
    /* none yet */
  }
  const sig = `${f}:${st?.size ?? -1}:${st?.mtimeMs ?? 0}`
  if (memo?.sig === sig) return memo.map
  const map = new Map<string, Purged>()
  if (st) {
    let text = ''
    try {
      text = await fs.readFile(f, 'utf8')
    } catch {
      /* unreadable: nothing is purged */
    }
    for (const line of text.split('\n')) {
      if (!line) continue
      try {
        const p = JSON.parse(line) as Partial<Purged>
        if (typeof p.pdfId === 'string' && isOrderFileId(p.pdfId)) map.set(p.pdfId.toLowerCase(), { pdfId: p.pdfId.toLowerCase(), caseNumber: String(p.caseNumber ?? ''), at: Number(p.at) || 0 })
      } catch { /* torn last line */ }
    }
  }
  memo = { sig, map }
  return map
}

/** Remove orders from the metadata. Returns how many were new. */
export function purgeOrders(items: Array<{ pdfId: string; caseNumber: string }>, at: number = Date.now()): Promise<number> {
  const run = async () => {
    const have = await readPurged()
    const fresh = items.filter((i) => isOrderFileId(i.pdfId) && !have.has(i.pdfId.toLowerCase()))
    if (!fresh.length) return 0
    await fs.mkdir(dataDir(), { recursive: true, mode: 0o700 })
    await fs.appendFile(file(), fresh.map((i) => JSON.stringify({ pdfId: i.pdfId.toLowerCase(), caseNumber: i.caseNumber, at })).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 })
    memo = null
    return fresh.length
  }
  const next = chain.then(run, run)
  chain = next.catch(() => undefined)
  return next
}

/** Records of the store minus the purged ones. */
export async function withoutPurged<T extends { pdfId?: string }>(orders: T[]): Promise<T[]> {
  const p = await readPurged()
  return p.size ? orders.filter((o) => !o.pdfId || !p.has(o.pdfId.toLowerCase())) : orders
}
