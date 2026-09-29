'use client'

/**
 * The global «N qaror yuklanmoqda» pill. Mounted once in the root layout, so it shows on every screen
 * (launcher, company, Hujjatlar, Sozlamalar…) while published orders download in the background, and stays
 * out of the way: a small pill at the bottom, never over the drawer or a dialog. Orders found so far are
 * usable at once (they are written to the local cache as they arrive), so the user can keep working.
 *
 * Polling is event-driven: one read on load, one when a download is queued (`sud:orders-job`), and every
 * 2.5 s ONLY while something is running — an idle app makes no repeated requests.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Pause, X } from 'lucide-react'
import { getPublicOrdersStatus, pausePublicOrdersJob } from '@/lib/api-client'
import type { PublicOrdersStatus } from '@/lib/public-orders/types'

const POLL_MS = 2500
const LINGER_MS = 8000

const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function OrdersLoader() {
  const [status, setStatus] = useState<PublicOrdersStatus | null>(null)
  const [hiddenUntilNextRun, setHidden] = useState(false)
  const [lingerOver, setLingerOver] = useState(false)
  const wasRunning = useRef(false)

  const load = useCallback(async () => {
    const r = await getPublicOrdersStatus().catch(() => null)
    if (r && r.ok) setStatus(r.data)
  }, [])

  const running = status?.job.state === 'running' || status?.crawl.state === 'running'

  // a new run un-hides the pill
  useEffect(() => {
    if (running) {
      wasRunning.current = true
      setHidden(false)
      setLingerOver(false)
    }
  }, [running])

  useEffect(() => {
    void load()
    const wake = () => void load()
    window.addEventListener('sud:orders-job', wake)
    return () => window.removeEventListener('sud:orders-job', wake)
  }, [load])

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(t)
  }, [running, load])

  // «finished» lingers briefly, then fades away
  const finished = !running && wasRunning.current
  useEffect(() => {
    if (!finished) return
    const t = setTimeout(() => setLingerOver(true), LINGER_MS)
    return () => clearTimeout(t)
  }, [finished])

  if (!status || hiddenUntilNextRun) return null

  const job = status.job
  const crawl = status.crawl

  if (running) {
    const jobRunning = job.state === 'running'
    const n = jobRunning ? job.found : crawl.rowsThisRun
    return (
      <div className="orders-loader" role="status" aria-live="polite">
        <span className="spinner" />
        <span className="t">
          {n > 0 ? <><b>{num(n)}</b> qaror yuklanmoqda</> : 'Qarorlar qidirilmoqda…'}
          {jobRunning && job.total > 1 ? <span className="s"> · {job.done}/{job.total} ish</span> : null}
        </span>
        <button className="x" title="Toʻxtatish" aria-label="Yuklashni toʻxtatish" onClick={() => void pausePublicOrdersJob()}>
          <Pause />
        </button>
      </div>
    )
  }

  if (!finished || lingerOver) return null

  const failed = job.state === 'error' || crawl.state === 'error'
  if (failed) {
    return (
      <div className="orders-loader err" role="status">
        <AlertTriangle />
        <span className="t">Qarorlarni yuklab boʻlmadi<span className="s"> · {job.lastError || crawl.lastError || 'xato'}</span></span>
        <button className="x" title="Yopish" aria-label="Yopish" onClick={() => setHidden(true)}>
          <X />
        </button>
      </div>
    )
  }
  const found = job.state === 'done' || job.state === 'paused' ? job.found : crawl.rowsThisRun
  return (
    <div className="orders-loader ok" role="status">
      <Check />
      <span className="t">
        {found > 0 ? <><b>{num(found)}</b> qaror yuklandi</> : 'Tekshiruv tugadi — eʼlon qilingan qaror topilmadi'}
        {job.state === 'paused' ? <span className="s"> · toʻxtatildi</span> : null}
      </span>
      <button className="x" title="Yopish" aria-label="Yopish" onClick={() => setHidden(true)}>
        <X />
      </button>
    </div>
  )
}
