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
  /** the person brought it back: the record is in the lists again; the entry stays so the backup can carry the later «restored» mark over an older tombstone */
  restored?: boolean
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
        if (typeof p.pdfId === 'string' && isOrderFileId(p.pdfId)) {
          const id = p.pdfId.toLowerCase()
          const old = map.get(id)
          map.set(id, { pdfId: id, caseNumber: String(p.caseNumber ?? '') || old?.caseNumber || '', at: Number(p.at) || 0, ...(p.restored ? { restored: true } : {}) }) // the last line of an id wins
        }
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
    const fresh = items.filter((i) => isOrderFileId(i.pdfId) && !(have.has(i.pdfId.toLowerCase()) && !have.get(i.pdfId.toLowerCase())!.restored))
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

/** the file ids that are removed NOW (a restored one is not) */
export async function activePurged(): Promise<Map<string, Purged>> {
  return new Map([...(await readPurged())].filter(([, v]) => !v.restored))
}

/** Records of the store minus the purged ones. */
export async function withoutPurged<T extends { pdfId?: string }>(orders: T[]): Promise<T[]> {
  const p = await activePurged()
  return p.size ? orders.filter((o) => !o.pdfId || !p.has(o.pdfId.toLowerCase())) : orders
}

/**
 * Bring removed orders back (`ids` = those, or every removed one). Appends a `restored` line (the file stays append-only); the next backup carries the mark,
 * which beats an older tombstone in the channel because it is later. Returns how many came back.
 */
export function restorePurged(ids?: string[], at: number = Date.now()): Promise<number> {
  const run = async () => {
    const now = await activePurged()
    const want = (ids ? ids.map((i) => i.toLowerCase()) : [...now.keys()]).filter((i) => now.has(i))
    if (!want.length) return 0
    await fs.appendFile(file(), want.map((id) => JSON.stringify({ pdfId: id, caseNumber: now.get(id)!.caseNumber, at, restored: true })).join('\n') + '\n', { encoding: 'utf8', mode: 0o600 })
    memo = null
    return want.length
  }
  const next = chain.then(run, run)
  chain = next.catch(() => undefined)
  return next
}
