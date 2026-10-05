'use client'

/**
 * useResource — the single fetch state machine (arch guide §3.3, A2).
 *
 * Turns the six copy-pasted fetch blocks into one hook whose states map 1:1
 * onto the five UI states demanded by the redesign guide §7.3:
 *   idle → loading → success | empty | partial | error
 *
 * Responsibilities: read/write the existing localStorage cache (unchanged),
 * own the AbortController (cancel on new call / unmount — fixes A7), and
 * expose refetch({force}). Partial failure is NEVER shown as complete data.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { SourceError } from '@/core/envelope'
import type { ApiResult } from '@/lib/api-types'
import { getCached, setCached, clearCached } from '@/lib/cache'

export type ResourceState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'empty' }
  | { status: 'partial'; data: T; partialErrors: SourceError[] }
  | { status: 'error'; error: string }

export interface UseResourceOptions<T> {
  /** Cache key (localStorage via lib/cache). Omit for never-cached resources. */
  cacheKey?: string
  /** Cache TTL in ms (default 5 min, matching lib/cache). */
  ttl?: number
  /** Decide emptiness from the data (defaults to array-length check). */
  isEmpty?: (data: T) => boolean
  /** Auto-fetch when enabled becomes true. */
  enabled?: boolean
  /**
   * Keep the answer in the browser's 5 min cache (default). Off for the daily-snapshot resources (stats, company info,
   * court lists): the server already keeps those for 24 h and says how old they are, a second copy here would only
   * hide a hard refresh done elsewhere and eat localStorage.
   */
  persist?: boolean
}

/** What the server said about the answer (`meta` of the envelope). */
export interface ResourceMeta {
  /** when the sites answered for this data (ms) */
  fetchedAt?: number
  /** past its day and the sites failed: the old data is shown */
  stale?: boolean
}

export function useResource<T>(
  /** `force` is true only for refetch(): a hard refresh the server must not answer from a snapshot. */
  fetcher: (signal: AbortSignal, force: boolean) => Promise<ApiResult<T>>,
  opts: UseResourceOptions<T> = {},
) {
  const { cacheKey, ttl, isEmpty, enabled = true, persist = true } = opts
  const [state, setState] = useState<ResourceState<T>>({ status: 'idle' })
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [meta, setMeta] = useState<ResourceMeta | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Sync "latest" refs inside effects (react-hooks/refs forbids render-time writes).
  const fetcherRef = useRef(fetcher)
  const isEmptyRef = useRef(isEmpty)
  useEffect(() => {
    fetcherRef.current = fetcher
    isEmptyRef.current = isEmpty
  })

  const run = useCallback(
    async (force: boolean) => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac

      if (cacheKey && persist && !force) {
        const hit = getCached<T>(cacheKey, ttl)
        if (hit !== null) {
          setState(decide(hit, [], isEmptyRef.current))
          return
        }
      }

      setState({ status: 'loading' })
      const t0 = Date.now()
      const timer = setInterval(() => setElapsed(Date.now() - t0), 500)
      try {
        const res = await fetcherRef.current(ac.signal, force)
        // Superseded/unmounted while the response was in flight. This used to
        // `return` with the interval still running: every 500ms it re-rendered
        // the owning component (e.g. the whole cases list) forever.
        if (ac.signal.aborted) { clearInterval(timer); return }
        clearInterval(timer)
        setElapsed(Date.now() - t0)
        if (res.ok) {
          // a PARTIAL answer (one source failed) is not cached: replaying it later would show the gaps as if that were all
          // there is, without the banner that explains them
          if (cacheKey && persist && !(res.partial && res.partial.length > 0)) setCached(cacheKey, res.data)
          setMeta(res.meta?.fetchedAt ? { fetchedAt: res.meta.fetchedAt, ...(res.meta.stale ? { stale: true } : {}) } : null)
          setState(decide(res.data, res.partial ?? [], isEmptyRef.current))
        } else {
          setState({ status: 'error', error: res.error })
        }
      } catch (e) {
        clearInterval(timer)
        if (e instanceof DOMException && e.name === 'AbortError') return
        // A throw here means the fetcher itself blew up (not a handled API
        // error — those resolve via res.ok===false above), so e.message is
        // raw/unlocalized. Never surface it verbatim.
        setState({ status: 'error', error: 'Kutilmagan xatolik yuz berdi' })
      }
    },
     
    [cacheKey, ttl, persist],
  )

  useEffect(() => {
    if (enabled) void run(false)
    return () => abortRef.current?.abort()
     
  }, [enabled, cacheKey])

  const refetch = useCallback(() => {
    if (cacheKey) clearCached(cacheKey)
    return run(true)
  }, [cacheKey, run])

  /** Read again WITHOUT forcing: after something else already refreshed the data (the header's hard refresh). */
  const reload = useCallback(() => {
    if (cacheKey) clearCached(cacheKey)
    return run(false)
  }, [cacheKey, run])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    setState({ status: 'idle' })
    setElapsed(null)
    setMeta(null)
  }, [])

  return { state, elapsed, meta, refetch, reload, clear, loading: state.status === 'loading' }
}

function decide<T>(data: T, partial: SourceError[], isEmpty?: (d: T) => boolean): ResourceState<T> {
  if (partial.length > 0) return { status: 'partial', data, partialErrors: partial }
  const empty = isEmpty ? isEmpty(data) : Array.isArray(data) ? data.length === 0 : false
  if (empty) return { status: 'empty' }
  return { status: 'success', data }
}
