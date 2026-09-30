/**
 * Simple localStorage cache with TTL. Client-side only.
 *
 * Used to avoid re-fetching the same data (company info, stats, case lists,
 * upcoming hearings) within a 5-minute window. The bills tab is intentionally
 * NOT cached (it streams results progressively).
 *
 * The cache prefix `sb-cache-v138:` keeps our keys isolated from other apps
 * that might share the same localStorage (e.g. the saved-companies list).
 *
 * v138: The version stamp in the prefix (`v138`) ensures that when we ship a
 * fix that changes what the backend returns (e.g. the v138 court-case retry
 * fix that now returns 100 cases instead of 11), old stale caches from
 * previous versions are automatically orphaned and the user gets fresh data
 * on their next visit. When bumping the version, update PREFIX below.
 */

const CACHE_VERSION = 'v168'
const PREFIX = `sb-cache-${CACHE_VERSION}:`
const DEFAULT_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * One-time sweep: on first load with a new CACHE_VERSION, remove all old
 * `sb-cache-v*:` entries from previous versions so they don't waste quota.
 */
if (typeof window !== 'undefined') {
  try {
    const sweepKey = `sb-cache-swept:${CACHE_VERSION}`
    if (!localStorage.getItem(sweepKey)) {
      const toRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith('sb-cache-') && k.startsWith('sb-cache-swept:') === false && !k.startsWith(PREFIX)) {
          toRemove.push(k)
        }
      }
      for (const k of toRemove) localStorage.removeItem(k)
      localStorage.setItem(sweepKey, '1')
    }
  } catch {
    // ignore quota errors
  }
}

/**
 * Read a cached value by key. Returns null if the cache is missing, expired,
 * or if we're not in a browser environment.
 */
export function getCached<T>(key: string, ttl = DEFAULT_TTL): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const { data, ts } = JSON.parse(raw) as { data: T; ts: number }
    if (Date.now() - ts > ttl) return null
    return data
  } catch {
    return null
  }
}

/**
 * Store a value in the cache with the default TTL. The TTL is recorded at
 * read-time (getCached), so callers don't need to pass it here.
 */
export function setCached<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return
  const value = JSON.stringify({ data, ts: Date.now() })
  try {
    localStorage.setItem(PREFIX + key, value)
  } catch {
    // Quota exceeded: this cache is only a 5-minute convenience, so make room by dropping the OLDEST entries and try
    // once more — never let it crowd out the registry (the watchlist), which shares the same quota.
    try {
      evictCaches(0.5)
      localStorage.setItem(PREFIX + key, value)
    } catch {
      /* still no room / private mode — skip caching */
    }
  }
}

/**
 * Free localStorage space by removing cached API responses (oldest first). `fraction` 1 = all of them. Returns how
 * many entries were removed. Only touches this module's own keys.
 */
export function evictCaches(fraction = 1): number {
  if (typeof window === 'undefined') return 0
  try {
    const entries: { key: string; ts: number }[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      let ts = 0
      try {
        ts = (JSON.parse(localStorage.getItem(k) || '{}') as { ts?: number }).ts ?? 0
      } catch { /* unreadable: oldest */ }
      entries.push({ key: k, ts })
    }
    entries.sort((a, b) => a.ts - b.ts)
    const n = Math.ceil(entries.length * Math.min(1, Math.max(0, fraction)))
    for (const e of entries.slice(0, n)) localStorage.removeItem(e.key)
    return n
  } catch {
    return 0
  }
}

/**
 * Remove a single cached key (e.g. when the user explicitly refreshes).
 */
export function clearCached(key: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    // ignore
  }
}

/** Cache key builders — keep them centralized so callers stay consistent. */
export const cacheKey = {
  companyInfo: (tin: string) => `company-info:${tin}`,
  stats: (tin: string) => `stats:${tin}`,
  cases: (courtType: string, mode: string, value: string) =>
    `cases:${courtType}:${mode}:${value}`,
  upcoming: (tin: string) => `upcoming:${tin}`,
}
