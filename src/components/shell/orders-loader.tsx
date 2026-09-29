'use client'

/**
 * The global «N qaror yuklanmoqda» pill. Mounted once in the root layout, so it shows on every screen
 * (launcher, company, Hujjatlar, Sozlamalar…) while published orders download in the background, and stays
 * out of the way: a small pill at the bottom, never over the drawer or a dialog. Orders found so far are
 * usable at once (they are written to the local cache as they arrive), so the user can keep working.
 *
 * Polling is event-driven: one read on load, one when a download is queued (`sud:orders-job`), and every
 * 2.5 s ONLY while something is running — an idle app makes no repeated requests. A run in which every case
 * was already known (nothing searched) never shows the pill at all.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, Check, Pause, X } from 'lucide-react'
import { getPublicOrdersStatus, pausePublicOrdersJob } from '@/lib/api-client'
import { runnerSnapshot, stopWatchlistCheck, subscribeRunner } from '@/lib/orders-watchlist'
import type { PublicOrdersStatus } from '@/lib/public-orders/types'

const POLL_MS = 2500
const LINGER_MS = 8000

const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function OrdersLoader() {
  const [status, setStatus] = useState<PublicOrdersStatus | null>(null)
  const [hidden, setHidden] = useState(false)
  const [lingerOver, setLingerOver] = useState(false)
  const wasRunning = useRef(false)
  const runner = useSyncExternalStore(subscribeRunner, runnerSnapshot, runnerSnapshot)

  const load = useCallback(async () => {
    const r = await getPublicOrdersStatus().catch(() => null)
    if (r && r.ok) setStatus(r.data)
  }, [])

  const job = status?.job
  // «running» only counts once something is really being searched — skipped (already known) cases are silent
  const jobRunning = job?.state === 'running'
  const searching = jobRunning && (job!.searched > 0 || job!.current !== null)

  // a new run un-hides the pill
  useEffect(() => {
    if (searching) {
      wasRunning.current = true
      setHidden(false)
      setLingerOver(false)
    }
  }, [searching])

  useEffect(() => {
    void load()
    const wake = () => void load()
    window.addEventListener('sud:orders-job', wake)
    return () => window.removeEventListener('sud:orders-job', wake)
  }, [load])

  useEffect(() => {
    if (!jobRunning) return
    const t = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(t)
  }, [jobRunning, load])

  // «finished» lingers briefly, then fades away
  const finished = !jobRunning && wasRunning.current && (job?.searched ?? 0) > 0
  useEffect(() => {
    if (!finished) return
    const t = setTimeout(() => setLingerOver(true), LINGER_MS)
    return () => clearTimeout(t)
  }, [finished])

  if (runner.phase === 'collecting') {
    return (
      <div className="orders-loader" role="status" aria-live="polite">
        <span className="spinner" />
        <span className="t">
          Kuzatuv ishlari yigʻilmoqda<span className="s"> · {runner.done}/{runner.total} kompaniya</span>
        </span>
        <button className="x" title="Toʻxtatish" aria-label="Toʻxtatish" onClick={() => stopWatchlistCheck()}>
          <Pause />
        </button>
      </div>
    )
  }

  if (!job || hidden) return null

  if (searching) {
    return (
      <div className="orders-loader" role="status" aria-live="polite">
        <span className="spinner" />
        <span className="t">
          {job.found > 0 ? <><b>{num(job.found)}</b> qaror yuklanmoqda</> : 'Qarorlar qidirilmoqda…'}
          {job.total > 1 ? <span className="s"> · {job.done}/{job.total} ish</span> : null}
        </span>
        <button className="x" title="Toʻxtatish" aria-label="Yuklashni toʻxtatish" onClick={() => void pausePublicOrdersJob()}>
          <Pause />
        </button>
      </div>
    )
  }

  if (!finished || lingerOver) return null

  if (job.state === 'error') {
    return (
      <div className="orders-loader err" role="status">
        <AlertTriangle />
        <span className="t">Qarorlarni yuklab boʻlmadi<span className="s"> · {job.lastError || 'xato'}</span></span>
        <button className="x" title="Yopish" aria-label="Yopish" onClick={() => setHidden(true)}>
          <X />
        </button>
      </div>
    )
  }
  return (
    <div className="orders-loader ok" role="status">
      <Check />
      <span className="t">
        {job.found > 0 ? <><b>{num(job.found)}</b> qaror yuklandi</> : 'Tekshiruv tugadi — yangi eʼlon qilingan qaror yoʻq'}
        {job.state === 'paused' ? <span className="s"> · toʻxtatildi</span> : null}
      </span>
      <button className="x" title="Yopish" aria-label="Yopish" onClick={() => setHidden(true)}>
        <X />
      </button>
    </div>
  )
}
