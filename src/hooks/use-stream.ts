'use client'

/**
 * useStream — the bills streaming hook (arch guide §3.3).
 *
 * Consumes streamBills over the NDJSON contract and exposes the phase ladder +
 * progressive items, exactly like the shipped Bills tab did — but through one
 * reusable state machine instead of inline logic in a 5,693-line monolith.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { streamBills } from '@/lib/api-client'
import type { EnrichedBill } from '@/lib/api-types'

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface UseStreamResult {
  status: StreamStatus
  phase: string | null
  phaseDetail: string | null
  items: EnrichedBill[]
  total: number | null
  error: string | null
  /** when the sites answered for this list (ms): a replayed snapshot's own time, or the live scrape's end */
  fetchedAt: number | null
  /** past its day and the sites failed: an older list is shown */
  stale: boolean
  /** `force`: scrape now, ignore the daily snapshot */
  start: (stir: string, opts?: { force?: boolean }) => void
  stop: () => void
}

const PHASE_ORDER = ['connecting', 'captcha', 'fetching', 'enriching']
export function phaseIndex(phase: string | null): number {
  if (!phase) return -1
  const i = PHASE_ORDER.indexOf(phase.toLowerCase())
  return i
}

export function useStream(): UseStreamResult {
  const [status, setStatus] = useState<StreamStatus>('idle')
  const [phase, setPhase] = useState<string | null>(null)
  const [phaseDetail, setPhaseDetail] = useState<string | null>(null)
  const [items, setItems] = useState<EnrichedBill[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)
  const [stale, setStale] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const start = useCallback(
    (stir: string, opts?: { force?: boolean }) => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      setStatus('streaming')
      setPhase(null)
      setPhaseDetail(null)
      setItems([])
      setTotal(null)
      setError(null)
      setFetchedAt(null)
      setStale(false)
      void streamBills(
        stir,
        {
          onPhase: (p, d) => {
            setPhase(p)
            setPhaseDetail(d ?? null)
          },
          onMeta: (t, info) => {
            setTotal(t)
            if (info?.fetchedAt) setFetchedAt(info.fetchedAt)
            setStale(!!info?.stale)
          },
          onBill: (bill) => setItems((prev) => [...prev, bill]),
          onError: (msg) => {
            setError(msg)
            setStatus('error')
          },
          onDone: (info) => {
            if (info?.fetchedAt) setFetchedAt(info.fetchedAt)
            setStatus((s) => (s === 'error' ? s : 'done'))
          },
        },
        ac.signal,
        opts?.force === true,
      ).then(() => {
        setStatus((s) => (s === 'streaming' ? 'done' : s))
      })
    },
    [],
  )

  useEffect(() => () => abortRef.current?.abort(), [])

  return { status, phase, phaseDetail, items, total, error, fetchedAt, stale, start, stop }
}
