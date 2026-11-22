'use client'

/**
 * useStoredBills: the Toʻlovlar tab's data. A company's bills (a bank has 241 541) live on the server (lib/bills-store); the tab asks for ONE
 * PAGE of them with the filters it shows, plus the summary of all of them. While the server's job is still loading pages the hook polls
 * (2 s), so the first pages can be read and searched while the rest arrive. With nothing stored it starts the load itself (opening the tab
 * of a company is the click, as before); a small company's stored bills older than a day are read again, a big one's only on «Yangilash».
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { queryStoredBills, startBillJob, stopBillJob, type BillsQueryParams } from '@/lib/api-client'
import type { BillsQueryResult } from '@/lib/api-types'

const POLL_MS = 2000
const DAY_MS = 24 * 60 * 60_000
/** a company whose bills fit one billing page is cheap to read again: it is, once a day */
const SMALL_PAGES = 1

export interface UseStoredBills {
  data: BillsQueryResult | null
  loading: boolean
  error: string | null
  /** the job (load) is running for this company */
  loading_bills: boolean
  refresh: () => Promise<void>
  stop: () => Promise<void>
}

export function useStoredBills(stir: string | undefined, params: BillsQueryParams): UseStoredBills {
  const [data, setData] = useState<BillsQueryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0) // bumped to ask again (after a job was started)
  const started = useRef<string | null>(null)
  const seq = useRef(0)
  const key = JSON.stringify(params)
  const paramsRef = useRef(params)
  paramsRef.current = params

  const fetchNow = useCallback(async () => {
    if (!stir) return
    const mine = ++seq.current
    const res = await queryStoredBills(stir, paramsRef.current)
    if (mine !== seq.current) return // a newer question was asked meanwhile
    setLoading(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setError(null)
    const d = res.data
    setData(d)

    // nothing stored: opening the tab starts the load; a small company's old copy is read again
    if (d.job.state !== 'running' && started.current !== stir) {
      const meta = d.meta
      const stale = !!meta && meta.complete && meta.totalPages <= SMALL_PAGES && Date.now() - meta.loadedAt > DAY_MS
      if (d.bills === null || (meta && !meta.complete) || stale) {
        started.current = stir
        const r = await startBillJob(stir, { load: stale ? 'refresh' : 'auto', fill: false })
        if (r.ok) setTick((t) => t + 1)
        else setError(r.error)
      }
    }
  }, [stir])

  // a new company or new filters: ask again
  useEffect(() => {
    if (!stir) return
    setLoading(true)
    void fetchNow()
  }, [stir, key, tick, fetchNow])

  // polled only while the server's job loads pages
  const running = data?.job.state === 'running'
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void fetchNow(), POLL_MS)
    return () => clearInterval(t)
  }, [running, fetchNow])

  useEffect(() => {
    started.current = null
    setData(null)
  }, [stir])

  const refresh = useCallback(async () => {
    if (!stir) return
    const r = await startBillJob(stir, { load: 'refresh', fill: false })
    if (!r.ok) setError(r.error)
    else void fetchNow()
  }, [stir, fetchNow])

  const stop = useCallback(async () => {
    if (!stir) return
    await stopBillJob(stir)
    void fetchNow()
  }, [stir, fetchNow])

  return { data, loading, error, loading_bills: running, refresh, stop }
}
