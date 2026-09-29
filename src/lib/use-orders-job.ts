'use client'

import { useCallback, useEffect, useState } from 'react'
import { getPublicOrdersStatus } from '@/lib/api-client'
import type { CaseJobStatus } from '@/lib/public-orders/types'

const POLL_MS = 2500

/**
 * The server's orders queue as the UI sees it. One read on mount, one whenever something queues or acts on it
 * (`sud:orders-job`), and a 2.5 s poll ONLY while a case is actually being searched — an idle or paused-and-quiet
 * app makes no repeated requests. Every exit path clears its timer and listener.
 */
export function useOrdersJob(): { job: CaseJobStatus | null; reload: () => Promise<void> } {
  const [job, setJob] = useState<CaseJobStatus | null>(null)

  const reload = useCallback(async () => {
    const r = await getPublicOrdersStatus().catch(() => null)
    if (r && r.ok) setJob(r.data.job)
  }, [])

  useEffect(() => {
    void reload()
    const wake = () => void reload()
    window.addEventListener('sud:orders-job', wake)
    return () => window.removeEventListener('sud:orders-job', wake)
  }, [reload])

  const working = job?.state === 'running' || (job?.state === 'paused' && job.current !== null)
  useEffect(() => {
    if (!working) return
    const t = setInterval(() => void reload(), POLL_MS)
    return () => clearInterval(t)
  }, [working, reload])

  return { job, reload }
}
