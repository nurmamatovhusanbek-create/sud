'use client'

/**
 * The global orders pill — calm by design. It exists ONLY while something is actually being scraped (or the watched
 * companies' cases are being read for a run the owner started), and it never comes back on its own:
 *  - nothing is ever started by opening, refreshing or switching pages; a run starts from a click (or the opt-in idle
 *    check), so the pill has nothing to «offer» and never asks to start anything;
 *  - ✕ hides it for the rest of THIS run (remembered per run, so a refresh does not bring it back);
 *  - a paused, failed or finished run leaves NO pill: the end is announced once with a toast (with «Qayta urinish» when
 *    some cases failed), and a paused queue is shown where you control it — the Kuzatuv page and Settings › Qarorlar;
 *  - the pause button really pauses: the case in flight finishes, the queue keeps its order, and continuing picks up
 *    from the same case.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Pause, Play, X } from 'lucide-react'
import { toast } from 'sonner'
import { pausePublicOrdersJob, retryPublicOrdersJob } from '@/lib/api-client'
import { pauseWatchlistCheck, resumeWatchlistCheck, runnerSnapshot, runWasAuto, subscribeRunner } from '@/lib/orders-watchlist'
import { useOrdersJob } from '@/lib/use-orders-job'

const HIDDEN_KEY = 'sud-orders-pill-hidden'
const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

const hiddenRun = (): string | null => {
  try {
    return sessionStorage.getItem(HIDDEN_KEY)
  } catch {
    return null
  }
}
const hideRun = (id: string) => {
  try {
    sessionStorage.setItem(HIDDEN_KEY, id)
  } catch { /* private mode */ }
}

export function OrdersLoader() {
  const { job } = useOrdersJob()
  const runner = useSyncExternalStore(subscribeRunner, runnerSnapshot, runnerSnapshot)
  const [hidden, setHidden] = useState<string | null>(null)
  useEffect(() => setHidden(hiddenRun()), [])

  // announce the END of a run once — only a run this page saw working (a reload never re-announces an old one)
  const prev = useRef<string | undefined>(undefined)
  useEffect(() => {
    const st = job?.state
    const was = prev.current
    prev.current = st
    if (!job || was !== 'running' || (st !== 'done' && st !== 'error')) return
    const quiet = runWasAuto() // the idle check only speaks when it found something
    if (job.found > 0) toast.success(`${num(job.found)} ta yangi qaror yuklandi`)
    else if (job.searched > 0 && !quiet && job.failed === 0) toast.info('Yangi eʼlon qilingan qaror topilmadi')
    if (job.failed > 0 && !quiet) {
      toast.error(`${num(job.failed)} ta ishni tekshirib boʻlmadi`, {
        description: job.lastError || undefined,
        action: { label: 'Qayta urinish', onClick: () => void retryPublicOrdersJob() },
      })
    }
  }, [job])

  // 1. the watched companies' cases are being read for a run
  if (runner.phase === 'collecting') {
    return (
      <div className="orders-loader" role="status" aria-live="polite">
        <span className="spinner" />
        <span className="t">
          Kuzatuv ishlari yigʻilmoqda<span className="s"> · {runner.done}/{runner.total} kompaniya</span>
        </span>
        {runner.paused ? (
          <button className="x" title="Davom ettirish" aria-label="Davom ettirish" onClick={() => void resumeWatchlistCheck()}>
            <Play />
          </button>
        ) : (
          <button className="x" title="Pauza" aria-label="Pauza" onClick={() => void pauseWatchlistCheck()}>
            <Pause />
          </button>
        )}
      </div>
    )
  }

  // 2. scraping — «running» only counts once something is really being searched (skipped cases are silent)
  const runId = job?.startedAt ?? ''
  const searching = job?.state === 'running' && (job.searched > 0 || job.current !== null)
  if (!job || !searching || hidden === runId) return null
  return (
    <div className="orders-loader" role="status" aria-live="polite">
      <span className="spinner" />
      <span className="t">
        {job.found > 0 ? <><b>{num(job.found)}</b> qaror yuklanmoqda</> : 'Qarorlar qidirilmoqda…'}
        {job.total > 1 ? <span className="s"> · {job.done}/{job.total} ish</span> : null}
      </span>
      <button className="x" title="Pauza" aria-label="Yuklashni pauzaga qoʻyish" onClick={() => void pausePublicOrdersJob()}>
        <Pause />
      </button>
      <button
        className="x"
        title="Yashirish (yuklash davom etadi)"
        aria-label="Yashirish"
        onClick={() => {
          hideRun(runId)
          setHidden(runId)
        }}
      >
        <X />
      </button>
    </div>
  )
}
