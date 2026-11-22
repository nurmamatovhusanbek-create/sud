'use client'

/**
 * useBillJob: watches the server's background job that loads a company's court bills and finds the cases they name (lib/bill-cases).
 * The job runs on the server and goes on when this page is closed; this hook only POLLS it (2 s while it runs, not at all otherwise) and
 * hands every case it finds to the open list through the `sud:cases-found` event, so the list grows LIVE without being reloaded. Nothing is
 * started except by `start`, which a click calls.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getBillJob, startBillJob, stopBillJob } from '@/lib/api-client'
import type { BillJobState, FoundEvent } from '@/lib/api-types'

export const CASES_FOUND = 'sud:cases-found'
export const CASES_RELOAD = 'sud:cases-reload'

export interface CasesFoundDetail {
  stir: string
  events: FoundEvent[]
}

const POLL_MS = 2000
/** a page that just opened asks for this many of the latest finds (the unsaved ones are not in the list the server answered with) */
const CATCH_UP = 100

export interface UseBillJob {
  state: BillJobState | null
  running: boolean
  /** start the job; resolves to an error text, or null when it started */
  start: (opts: { load: 'auto' | 'refresh' | 'skip'; fill: boolean }) => Promise<string | null>
  stop: () => Promise<void>
}

export function useBillJob(stir: string): UseBillJob {
  const [state, setState] = useState<BillJobState | null>(null)
  const afterRef = useRef<number | null>(null)
  const wasRunning = useRef(false)
  const alive = useRef(true)

  const poll = useCallback(async () => {
    const res = await getBillJob(stir, afterRef.current)
    if (!alive.current || !res.ok) return
    const d = res.data
    if (afterRef.current === null) afterRef.current = Math.max(0, d.job.seq - CATCH_UP)
    if (d.events.length) {
      afterRef.current = d.events[d.events.length - 1].seq
      window.dispatchEvent(new CustomEvent<CasesFoundDetail>(CASES_FOUND, { detail: { stir, events: d.events } }))
    }
    if (d.behind) window.dispatchEvent(new Event(CASES_RELOAD)) // fell too far behind to follow: read the list again
    const running = d.job.state === 'running'
    if (wasRunning.current && !running) window.dispatchEvent(new Event(CASES_RELOAD)) // the job ended: the list reads what it saved
    wasRunning.current = running
    setState(d)
  }, [stir])

  // polled only while the job runs
  const running = state?.job.state === 'running'
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void poll(), POLL_MS)
    return () => clearInterval(t)
  }, [running, poll])

  useEffect(() => {
    alive.current = true
    afterRef.current = null
    wasRunning.current = false
    setState(null)
    void poll()
    return () => {
      alive.current = false
    }
  }, [poll])

  const start = useCallback(
    async (opts: { load: 'auto' | 'refresh' | 'skip'; fill: boolean }): Promise<string | null> => {
      const res = await startBillJob(stir, opts)
      if (!res.ok) return res.error
      wasRunning.current = true
      await poll()
      return null
    },
    [stir, poll],
  )

  const stop = useCallback(async () => {
    await stopBillJob(stir)
    await poll()
  }, [stir, poll])

  return { state, running, start, stop }
}
