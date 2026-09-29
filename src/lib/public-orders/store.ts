import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizeCaseNumber, sortOrders, type CaseCheck, type StoredOrder } from '@/core/public-orders'

/**
 * The local index of published orders: append-only JSONL, sharded by a hash of the case number so
 * a lookup reads ONE small file (~1.3k rows) instead of ~680k. Lives on the operator's disk
 * (`data/public-orders/`, git-ignored) — this is a cache of public metadata, not a database:
 * delete the folder and re-run the sync and you get it back.
 *
 * Re-crawled rows simply append again; a read keeps the last copy of each order id.
 */

export const SHARDS = 512

export const dataDir = (): string => process.env.PUBLIC_ORDERS_DIR || path.join(process.cwd(), 'data', 'public-orders')

/** FNV-1a over the normalised case number → shard 0..511 */
export function shardOf(caseNumber: string): number {
  let h = 0x811c9dc5
  for (const ch of normalizeCaseNumber(caseNumber)) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % SHARDS
}

const shardFile = (n: number) => path.join(dataDir(), 'shards', `${n.toString(16).padStart(3, '0')}.jsonl`)

// one writer at a time: two appends to the same file must not interleave
let chain: Promise<unknown> = Promise.resolve()
const serial = <T,>(job: () => Promise<T>): Promise<T> => {
  const run = chain.then(job, job)
  chain = run.catch(() => undefined)
  return run
}

export function appendOrders(orders: StoredOrder[]): Promise<void> {
  if (!orders.length) return Promise.resolve()
  return serial(async () => {
    const byShard = new Map<number, string[]>()
    for (const o of orders) {
      const n = shardOf(o.caseNumber)
      const lines = byShard.get(n) ?? []
      lines.push(JSON.stringify(o))
      byShard.set(n, lines)
    }
    await fs.mkdir(path.join(dataDir(), 'shards'), { recursive: true })
    for (const [n, lines] of byShard) await fs.appendFile(shardFile(n), lines.join('\n') + '\n', 'utf8')
  })
}

/** Every stored order of one case, oldest instance first. */
export async function lookupOrders(caseNumber: string): Promise<StoredOrder[]> {
  const key = normalizeCaseNumber(caseNumber)
  if (!key) return []
  let text: string
  try {
    text = await fs.readFile(shardFile(shardOf(key)), 'utf8')
  } catch {
    return []
  }
  const byId = new Map<string, StoredOrder>()
  for (const line of text.split('\n')) {
    if (!line || !line.includes(key)) continue // cheap pre-filter before parsing
    try {
      const o = JSON.parse(line) as StoredOrder
      if (o.caseNumber === key) byId.set(o.id, o)
    } catch {
      /* a half-written last line — ignore */
    }
  }
  return sortOrders([...byId.values()])
}

// ---- per-case check records (core/public-orders → CaseCheck) ------------------------------------
// Lets the UI tell «none published» from «never checked», and the policy skip what is already known.

const checkedFile = () => path.join(dataDir(), 'checked.jsonl')
let checkedCache: Map<string, CaseCheck> | null = null

async function loadChecked(): Promise<Map<string, CaseCheck>> {
  if (checkedCache) return checkedCache
  const m = new Map<string, CaseCheck>()
  try {
    for (const line of (await fs.readFile(checkedFile(), 'utf8')).split('\n')) {
      if (!line) continue
      try {
        const c = JSON.parse(line) as CaseCheck
        if (c.caseNumber) m.set(c.caseNumber, c) // last write wins
      } catch { /* torn line */ }
    }
  } catch { /* first run */ }
  checkedCache = m
  return m
}

export async function getChecked(caseNumber: string): Promise<CaseCheck | null> {
  return (await loadChecked()).get(normalizeCaseNumber(caseNumber)) ?? null
}

export async function markChecked(c: CaseCheck): Promise<void> {
  const m = await loadChecked()
  const rec = { ...c, caseNumber: normalizeCaseNumber(c.caseNumber) }
  m.set(rec.caseNumber, rec)
  await serial(async () => {
    await fs.mkdir(dataDir(), { recursive: true })
    await fs.appendFile(checkedFile(), JSON.stringify(rec) + '\n', 'utf8')
  })
}

/** Test hook: forget the in-memory cache (the file stays). */
export function resetCheckedCache(): void {
  checkedCache = null
}
