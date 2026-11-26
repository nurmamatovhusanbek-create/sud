'use client'

/**
 * Qarorlar › «Barchasini yuklash»: the server job's state (lib/public-orders/download-job), polled while it runs. The job lives on the server, so this hook only
 * WATCHES it: leaving the page and coming back finds it still running (or its report waiting). `onFinished` is called once when a job this page saw running ends.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { clearDownloadJob, getDownloadJob, startDownloadJob, stopDownloadJob } from '@/lib/api-client'
import type { DownloadJobState } from '@/core/public-orders'

const POLL_MS = 2000

export function useDownloadJob(onFinished?: (s: DownloadJobState) => void) {
  const [job, setJob] = useState<DownloadJobState | null>(null)
  const was = useRef<string>('idle')
  const cb = useRef(onFinished)
  cb.current = onFinished

  const apply = useCallback((s: DownloadJobState) => {
    // the job this page watched running has ended: say so once (a report found on arrival is shown, not announced again)
    if (was.current === 'running' && s.phase !== 'running') cb.current?.(s)
    was.current = s.phase
    setJob(s)
  }, [])

  const refresh = useCallback(async () => {
    const r = await getDownloadJob()
    if (r.ok) apply(r.data)
  }, [apply])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const running = job?.phase === 'running'
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [running, refresh])

  const start = useCallback(async (ids: string[]): Promise<string | null> => {
    const r = await startDownloadJob(ids)
    if (!r.ok) return r.error
    was.current = 'running'
    setJob(r.data)
    return null
  }, [])
  const stop = useCallback(async () => {
    const r = await stopDownloadJob()
    if (r.ok) apply(r.data)
  }, [apply])
  const clear = useCallback(async () => {
    const r = await clearDownloadJob()
    if (r.ok) apply(r.data)
  }, [apply])

  return { job, running, start, stop, clear }
}
