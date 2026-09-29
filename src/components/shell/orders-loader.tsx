'use client'

/**
 * The global «N qaror yuklanmoqda» pill. Mounted once in the root layout, so it shows on every screen
 * (launcher, company, Hujjatlar, Sozlamalar…) while published orders download in the background, and stays
 * out of the way: a small pill at the bottom, never over the drawer or a dialog. Orders found so far are
 * usable at once (they are written to the local cache as they arrive), so the user can keep working.
 *
 * Pause really pauses: the queue stays exactly as it is (the case being searched finishes) and «Davom ettirish»
 * continues from the same case, in the same order — nothing restarts. A paused pill stays until resumed or cancelled.
 *
 * Polling is event-driven: one read on load, one when a download is queued (`sud:orders-job`), and every
 * 2.5 s ONLY while something is running — an idle app makes no repeated requests. A run in which every case
 * was already known (nothing searched) never shows the pill at all.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, Check, Pause, Play, X } from 'lucide-react'
import { cancelPublicOrdersJob, getPublicOrdersStatus, pausePublicOrdersJob, resumePublicOrdersJob } from '@/lib/api-client'
import { pauseWatchlistCheck, resumeWatchlistCheck, runnerSnapshot, subscribeRunner } from '@/lib/orders-watchlist'
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
  const jobPaused = job?.state === 'paused'
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

  // a paused run still needs a look until the case it was on has finished
  const watching = jobRunning || (jobPaused && job!.current !== null)
  useEffect(() => {
    if (!watching) return
    const t = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(t)
  }, [watching, load])

  // «finished» lingers briefly, then fades away
  const finished = !jobRunning && !jobPaused && wasRunning.current && (job?.searched ?? 0) > 0
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

  if (job && jobPaused && job.remaining > 0) {
    return (
      <div className="orders-loader paused" role="status" aria-live="polite">
        <Pause />
        <span className="t">
          Pauza<span className="s"> · {job.current ? 'joriy ish tugallanmoqda · ' : ''}{num(job.remaining)} ta ish qoldi</span>
        </span>
        <button className="x" title="Davom ettirish" aria-label="Davom ettirish" onClick={() => void resumePublicOrdersJob()}>
          <Play />
        </button>
        <button className="x" title="Qolgan ishlarni bekor qilish" aria-label="Qolgan ishlarni bekor qilish" onClick={() => void cancelPublicOrdersJob()}>
          <X />
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
        <button className="x" title="Pauza" aria-label="Yuklashni pauzaga qoʻyish" onClick={() => void pausePublicOrdersJob()}>
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
      </span>
      <button className="x" title="Yopish" aria-label="Yopish" onClick={() => setHidden(true)}>
        <X />
      </button>
    </div>
  )
}
