import 'server-only'
import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizeCaseNumber, sortOrders, type CaseCheck, type StoredOrder } from '@/core/public-orders'
import { dataDir } from './data-dir'
import type { OrdersCacheStats } from './types'

export { dataDir }

/**
 * The local index of published orders: append-only JSONL, sharded by a hash of the case number so
 * a lookup reads ONE small file instead of everything. Lives on the operator's disk OUTSIDE the project
 * (see data-dir.ts) and is NEVER deleted by the app: rebuilding it costs ~10 s per case, so it is only
 * added to and updated. A re-fetched order or a re-checked case simply appends a newer line; a read keeps the
 * last copy of each order id / case number.
 */

export const SHARDS = 512

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
    await fs.mkdir(path.join(dataDir(), 'shards'), { recursive: true, mode: 0o700 })
    for (const [n, lines] of byShard) await fs.appendFile(shardFile(n), lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 })
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

/**
 * Records written by an older version of the app (or a hand-edited file) may lack fields; a record that cannot be
 * trusted is treated as «never checked» rather than crashing every reader.
 */
function normalizeCheck(raw: unknown): CaseCheck | null {
  const r = raw as Partial<CaseCheck> | null
  if (!r || typeof r.caseNumber !== 'string' || !r.caseNumber || typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) return null
  return {
    caseNumber: normalizeCaseNumber(r.caseNumber),
    at: r.at,
    sig: typeof r.sig === 'string' ? r.sig : '',
    seen: Array.isArray(r.seen) ? r.seen.filter((x): x is string => typeof x === 'string') : [],
    misses: typeof r.misses === 'number' && r.misses >= 0 ? r.misses : 0,
    error: typeof r.error === 'string' && r.error ? r.error : undefined,
  }
}

async function loadChecked(): Promise<Map<string, CaseCheck>> {
  if (checkedCache) return checkedCache
  const m = new Map<string, CaseCheck>()
  try {
    for (const line of (await fs.readFile(checkedFile(), 'utf8')).split('\n')) {
      if (!line) continue
      try {
        const c = normalizeCheck(JSON.parse(line))
        if (c) m.set(c.caseNumber, c) // last write wins
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
    await fs.mkdir(dataDir(), { recursive: true, mode: 0o700 })
    await fs.appendFile(checkedFile(), JSON.stringify(rec) + '\n', { encoding: 'utf8', mode: 0o600 }) // private to this user
  })
}

/** Test hook: forget the in-memory cache (the file stays). */
export function resetCheckedCache(): void {
  checkedCache = null
}

// ---- the cache as a whole (Settings › Qarorlar) ---------------------------------------------------

export async function cacheStats(): Promise<OrdersCacheStats> {
  const checked = await loadChecked()
  let withOrders = 0
  let failed = 0
  let last = 0
  for (const c of checked.values()) {
    if (c.seen.length) withOrders++
    if (c.error) failed++
    const t = Date.parse(c.at)
    if (t > last) last = t
  }
  let orders = 0
  let bytes = 0
  const size = async (f: string) => {
    try {
      bytes += (await fs.stat(f)).size
    } catch { /* absent */ }
  }
  await size(checkedFile())
  try {
    for (const name of await fs.readdir(path.join(dataDir(), 'shards'))) {
      const f = path.join(dataDir(), 'shards', name)
      await size(f)
      // rows are appended, so a re-fetched order can repeat: count distinct ids
      const ids = new Set<string>()
      for (const line of (await fs.readFile(f, 'utf8')).split('\n')) {
        const m = line.match(/"id":"([^"]+)"/)
        if (m) ids.add(m[1])
      }
      orders += ids.size
    }
  } catch { /* no shards yet */ }
  return { dir: dataDir(), cases: checked.size, withOrders, orders, failed, bytes, lastCheckedAt: last ? new Date(last).toISOString() : null }
}
