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
}

export function useResource<T>(
  fetcher: (signal: AbortSignal) => Promise<ApiResult<T>>,
  opts: UseResourceOptions<T> = {},
) {
  const { cacheKey, ttl, isEmpty, enabled = true } = opts
  const [state, setState] = useState<ResourceState<T>>({ status: 'idle' })
  const [elapsed, setElapsed] = useState<number | null>(null)
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

      if (cacheKey && !force) {
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
        const res = await fetcherRef.current(ac.signal)
        if (ac.signal.aborted) return
        clearInterval(timer)
        setElapsed(Date.now() - t0)
        if (res.ok) {
          if (cacheKey) setCached(cacheKey, res.data)
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
     
    [cacheKey, ttl],
  )

  useEffect(() => {
    if (enabled) void run(false)
    return () => abortRef.current?.abort()
     
  }, [enabled, cacheKey])

  const refetch = useCallback(() => {
    if (cacheKey) clearCached(cacheKey)
    return run(true)
  }, [cacheKey, run])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    setState({ status: 'idle' })
    setElapsed(null)
  }, [])

  return { state, elapsed, refetch, clear, loading: state.status === 'loading' }
}

function decide<T>(data: T, partial: SourceError[], isEmpty?: (d: T) => boolean): ResourceState<T> {
  if (partial.length > 0) return { status: 'partial', data, partialErrors: partial }
  const empty = isEmpty ? isEmpty(data) : Array.isArray(data) ? data.length === 0 : false
  if (empty) return { status: 'empty' }
  return { status: 'success', data }
}
