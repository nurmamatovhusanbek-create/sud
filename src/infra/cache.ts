/**
 * CacheStore — the single cache abstraction (blueprint §4.5).
 *
 * One interface, pluggable backends. All NEW server-side caching goes through
 * here; the legacy in-process Maps inside the scraper libs remain until their
 * adapters migrate (parity rule). Backend selection comes from config
 * (`CACHE_BACKEND`): memory now, kv when multi-instance.
 */

export interface CacheEntry<V> {
  value: V
  expiresAt: number
}

export interface CacheStore {
  get<V>(key: string): Promise<V | null>
  set<V>(key: string, value: V, ttlMs: number): Promise<void>
  del(key: string): Promise<void>
  /** Drop every key whose name starts with the prefix. */
  clearPrefix(prefix: string): Promise<void>
  size(): number
}

// ---------- Memory backend (default; single-node) ---------------------------

export class MemoryCacheStore implements CacheStore {
  private store = new Map<string, CacheEntry<unknown>>()
  private maxEntries: number

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries
  }

  get<V>(key: string): Promise<V | null> {
    const e = this.store.get(key)
    if (!e) return Promise.resolve(null)
    if (Date.now() > e.expiresAt) {
      this.store.delete(key)
      return Promise.resolve(null)
    }
    return Promise.resolve(e.value as V)
  }

  set<V>(key: string, value: V, ttlMs: number): Promise<void> {
    // simple size cap: drop oldest inserted when over budget
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
    return Promise.resolve()
  }

  del(key: string): Promise<void> {
    this.store.delete(key)
    return Promise.resolve()
  }

  async clearPrefix(prefix: string): Promise<void> {
    for (const k of Array.from(this.store.keys())) {
      if (k.startsWith(prefix)) this.store.delete(k)
    }
  }

  size(): number {
    return this.store.size
  }
}

// ---------- factory ----------------------------------------------------------

import { config } from '@/server/config'

let instance: CacheStore | null = null

export function getCacheStore(): CacheStore {
  if (!instance) {
    // kv backend (Redis/Upstash) lands when the runtime scales out; until then
    // memory is the honest single-node implementation.
    instance = new MemoryCacheStore()
  }
  return instance
}

/** Helper: get-or-fetch with a named TTL. */
export async function cached<V>(store: CacheStore, key: string, ttlMs: number, fetcher: () => Promise<V>): Promise<{ value: V; cached: boolean }> {
  const hit = await store.get<V>(key)
  if (hit !== null) return { value: hit, cached: true }
  const value = await fetcher()
  await store.set(key, value, ttlMs)
  return { value, cached: false }
}

export const TTL = () => config.cache.ttl
