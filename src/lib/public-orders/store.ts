import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizeCaseNumber, sortOrders, type StoredOrder } from '@/core/public-orders'
import type { CrawlState } from './types'

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

// ---- crawl state (types live in ./types so the engine and the UI can share them) ------------

const stateFile = () => path.join(dataDir(), 'state.json')

export async function loadState(): Promise<CrawlState> {
  try {
    const s = JSON.parse(await fs.readFile(stateFile(), 'utf8')) as CrawlState
    if (s && s.version === 1 && s.types) return s
  } catch {
    /* first run */
  }
  return { version: 1, updatedAt: new Date(0).toISOString(), types: {} }
}

export async function saveState(s: CrawlState): Promise<void> {
  await serial(async () => {
    await fs.mkdir(dataDir(), { recursive: true })
    const tmp = stateFile() + '.tmp'
    await fs.writeFile(tmp, JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 1), 'utf8')
    await fs.rename(tmp, stateFile())
  })
}
