'use client'

/**
 * The global orders pill. Mounted once in the root layout, so it shows on every screen while there is something
 * to know or do, and stays out of the way: a small pill at the bottom, never over the drawer or a dialog.
 *
 * The sequence it drives:  DETECT which cases need a look (no scraping yet) → the pill says «N ta ish tekshirilishi
 * kerak» with «Boshlash» → SCRAPE («N qaror yuklanmoqda», pause / continue) → done, or «Qayta urinish» for the
 * cases that failed (worker / upstream trouble — no page refresh needed).
 *
 * It is never permanent: a ready / paused / failed pill can be dismissed with ✕ (the queue is kept; Settings ›
 * Qarorlar and Kuzatuv still control it) and comes back only when the state moves on. A run in which every case was
 * already known never shows a pill at all; a finished one fades after a few seconds.
 * Pause really pauses: the case in flight finishes, the queue keeps its order, «Davom ettirish» continues from it.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, Check, Pause, Play, RefreshCw, Search, X } from 'lucide-react'
import { pausePublicOrdersJob, resumePublicOrdersJob, retryPublicOrdersJob } from '@/lib/api-client'
import { pauseWatchlistCheck, resumeWatchlistCheck, runnerSnapshot, subscribeRunner } from '@/lib/orders-watchlist'
import { useOrdersJob } from '@/lib/use-orders-job'

const LINGER_MS = 8000
const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function OrdersLoader() {
  const { job } = useOrdersJob()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [lingerOver, setLingerOver] = useState(false)
  const wasSearching = useRef(false)
  const runner = useSyncExternalStore(subscribeRunner, runnerSnapshot, runnerSnapshot)

  const state = job?.state
  // «running» only counts once something is really being searched — skipped (already known) cases are silent
  const searching = state === 'running' && (job!.searched > 0 || job!.current !== null)
  // a pill's identity: dismissing it hides THIS situation; a new one (state change, more cases) shows again
  const key = job ? `${state}:${job.startedAt}:${job.total}:${job.failed}` : ''
  const hidden = dismissed === key

  useEffect(() => {
    if (searching) {
      wasSearching.current = true
      setLingerOver(false)
    }
  }, [searching])

  const finished = (state === 'done' || state === 'error') && wasSearching.current && (job?.searched ?? 0) > 0
  useEffect(() => {
    if (!finished) return
    const t = setTimeout(() => setLingerOver(true), LINGER_MS)
    return () => clearTimeout(t)
  }, [finished])

  const dismiss = (label: string) => (
    <button className="x" title="Yopish (navbat saqlanadi)" aria-label={label} onClick={() => setDismissed(key)}>
      <X />
    </button>
  )

  // 1. the client is reading the watched companies' cases (detecting, or collecting for an explicit run)
  if (runner.phase === 'collecting') {
    return (
      <div className="orders-loader" role="status" aria-live="polite">
        <span className="spinner" />
        <span className="t">
          {runner.detect ? 'Tekshiriladigan ishlar aniqlanmoqda' : 'Kuzatuv ishlari yigʻilmoqda'}
          <span className="s"> · {runner.done}/{runner.total} kompaniya</span>
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

  if (!job || hidden) return null

  // 2. detected, held: nothing is scraped until the user says so
  if (state === 'ready' && job.remaining > 0) {
    return (
      <div className="orders-loader ready" role="status" aria-live="polite">
        <Search />
        <span className="t">
          {num(job.remaining)} ta ish tekshirilishi kerak
        </span>
        <button className="go" title="Boshlash" aria-label="Tekshirishni boshlash" onClick={() => void resumePublicOrdersJob()}>
          <Play />
          <span>Boshlash</span>
        </button>
        {dismiss('Yopish')}
      </div>
    )
  }

  // 3. scraping
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

  // 4. paused: the queue is kept in order
  if (state === 'paused' && job.remaining > 0) {
    return (
      <div className="orders-loader paused" role="status" aria-live="polite">
        <Pause />
        <span className="t">
          Pauza<span className="s"> · {job.current ? 'joriy ish tugallanmoqda · ' : ''}{num(job.remaining)} ta ish qoldi</span>
        </span>
        <button className="x" title="Davom ettirish" aria-label="Davom ettirish" onClick={() => void resumePublicOrdersJob()}>
          <Play />
        </button>
        {dismiss('Yopish')}
      </div>
    )
  }

  // 5. finished — with failures the user can retry right here (a refresh is never needed)
  if ((state === 'done' || state === 'error') && job.failed > 0) {
    return (
      <div className="orders-loader err" role="status" aria-live="polite">
        <AlertTriangle />
        <span className="t">
          {num(job.failed)} ta ishni tekshirib boʻlmadi<span className="s"> · {job.lastError || 'xato'}</span>
        </span>
        <button className="go" title="Qayta urinish" aria-label="Qayta urinish" onClick={() => void retryPublicOrdersJob()}>
          <RefreshCw />
          <span>Qayta urinish</span>
        </button>
        {dismiss('Yopish')}
      </div>
    )
  }

  if (!finished || lingerOver) return null

  return (
    <div className="orders-loader ok" role="status">
      <Check />
      <span className="t">{job.found > 0 ? <><b>{num(job.found)}</b> qaror yuklandi</> : 'Tekshiruv tugadi — yangi eʼlon qilingan qaror yoʻq'}</span>
      {dismiss('Yopish')}
    </div>
  )
}
