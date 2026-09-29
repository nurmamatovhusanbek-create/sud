'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { getPublicOrdersStatus } from '@/lib/api-client'
import type { CaseJobStatus } from '@/lib/public-orders/types'

/**
 * The server's orders queue as the UI sees it — ONE shared store for every component that shows it (the global pill,
 * Settings, …). Each used to poll on its own, which multiplied the requests until the server's per-IP rate limit
 * answered 429 and the pill went blind. Now:
 *  - one read when the first consumer mounts, and one whenever something queues or acts on the queue (`sud:orders-job`);
 *  - a 2.5 s poll ONLY while a case is actually being searched (an idle, held or paused-and-quiet queue is not polled);
 *  - a failed read (429, network) backs the poll off (×2, up to 20 s) instead of hammering, and recovers on success.
 * Every listener and timer is removed when the last consumer unmounts.
 */

const POLL_MS = 2500
const MAX_BACKOFF_MS = 20_000

let job: CaseJobStatus | null = null
const subs = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | null = null
let inflight: Promise<void> | null = null
let delay = POLL_MS
let attached = false

const emit = () => subs.forEach((l) => l())

async function read(): Promise<void> {
  const r = await getPublicOrdersStatus().catch(() => null)
  if (r && r.ok) {
    delay = POLL_MS
    job = r.data.job
    emit()
  } else delay = Math.min(delay * 2, MAX_BACKOFF_MS)
}

/** One read at a time; callers share it. */
function refresh(): Promise<void> {
  return (inflight ??= read().finally(() => {
    inflight = null
    schedule()
  }))
}

const working = () => job?.state === 'running' || (job?.state === 'paused' && job.current !== null)

function schedule() {
  if (timer) clearTimeout(timer)
  timer = null
  if (subs.size === 0 || !working()) return
  timer = setTimeout(() => void refresh(), delay)
}

const wake = () => void refresh()

function subscribe(l: () => void): () => void {
  subs.add(l)
  if (!attached) {
    attached = true
    window.addEventListener('sud:orders-job', wake)
    void refresh()
  }
  return () => {
    subs.delete(l)
    if (subs.size === 0) {
      attached = false
      window.removeEventListener('sud:orders-job', wake)
      if (timer) clearTimeout(timer)
      timer = null
    }
  }
}

export function useOrdersJob(): { job: CaseJobStatus | null; reload: () => Promise<void> } {
  const snap = useSyncExternalStore(subscribe, () => job, () => null)
  const reload = useCallback(() => refresh(), [])
  return { job: snap, reload }
}
