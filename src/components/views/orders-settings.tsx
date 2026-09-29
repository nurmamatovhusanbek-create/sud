'use client'

/**
 * Settings › Qarorlar — the control panel of the published-orders feature (there is no library copy any more:
 * orders are fetched only for the cases the owner cares about, once, and kept). Three cards:
 *  1. Automatic check of the Kuzatuv companies (idle switch, run now, pause/resume)
 *  2. The queue that is (or was) working: progress, pause / resume / cancel
 *  3. What the local cache holds, and a button to forget it
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Database, ListChecks, Pause, Play, RefreshCw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  cancelPublicOrdersJob,
  clearPublicOrdersCache,
  getPublicOrdersCache,
  getPublicOrdersStatus,
  pausePublicOrdersJob,
  resumePublicOrdersJob,
  retryPublicOrdersJob,
} from '@/lib/api-client'
import { autoEnabled, checkWatchlistOrders, lastAutoRun, pauseWatchlistCheck, resumeWatchlistCheck, runnerSnapshot, setAutoEnabled, subscribeRunner } from '@/lib/orders-watchlist'
import type { CaseJobStatus, OrdersCacheStats } from '@/lib/public-orders/types'

const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
const p2 = (n: number) => String(n).padStart(2, '0')
const dmyHm = (t: number | string | null): string => {
  if (!t) return '–'
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? '–' : `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}
const size = (b: number) => (b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

const STATE: Record<CaseJobStatus['state'], { text: string; cls: string }> = {
  idle: { text: 'Boʻsh', cls: 'b-neu' },
  ready: { text: 'Boshlashni kutmoqda', cls: 'b-info' },
  running: { text: 'Ishlamoqda', cls: 'b-info' },
  paused: { text: 'Pauza', cls: 'b-warn' },
  error: { text: 'Xato', cls: 'b-neg' },
  done: { text: 'Tayyor', cls: 'b-pos' },
}

export function OrdersTab() {
  const [job, setJob] = useState<CaseJobStatus | null>(null)
  const [cache, setCache] = useState<OrdersCacheStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [auto, setAuto] = useState(true)
  const [lastAuto, setLastAuto] = useState(0)
  const [confirmClear, setConfirmClear] = useState(false)
  const runner = useSyncExternalStore(subscribeRunner, runnerSnapshot, runnerSnapshot)

  const load = useCallback(async () => {
    const [s, c] = await Promise.all([getPublicOrdersStatus(), getPublicOrdersCache()])
    if (s.ok) {
      setJob(s.data.job)
      setError(null)
    } else setError(s.error)
    if (c.ok) setCache(c.data)
  }, [])

  useEffect(() => {
    setAuto(autoEnabled())
    setLastAuto(lastAutoRun())
  }, [runner.phase])

  // poll while something runs (a paused run still finishing its case counts); every exit path clears the timer
  const busy = job?.state === 'running' || (job?.state === 'paused' && job.current !== null) || runner.phase === 'collecting'
  useEffect(() => {
    void load()
    const wake = () => void load()
    window.addEventListener('sud:orders-job', wake)
    const t = busy ? setInterval(() => void load(), 2500) : null
    return () => {
      window.removeEventListener('sud:orders-job', wake)
      if (t) clearInterval(t)
    }
  }, [load, busy])

  const clear = async () => {
    setConfirmClear(false)
    const r = await clearPublicOrdersCache()
    if (r.ok) toast.success('Kesh tozalandi — qarorlar kerak boʻlganda qayta yuklanadi')
    else toast.error(r.error)
    await load()
  }

  const st = STATE[job?.state ?? 'idle']
  const collecting = runner.phase === 'collecting'
  const queued = job ? job.remaining : 0

  return (
    <div className="dash" style={{ gridTemplateColumns: '1fr' }}>
      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><RefreshCw /></div>
          <h3>Kuzatuvdagi kompaniyalar qarorlari</h3>
        </div>
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '2px 0 12px' }}>
          Kuzatuvdagi kompaniyalarning ishlari boʻyicha public.sud.uz da eʼlon qilingan qarorlar orqa fonda yuklanadi. Eʼlon qilingan qaror oʻzgarmaydi, shuning uchun
          bir marta olinadi va qayta soʻralmaydi; ish oʻzgarganda (masalan apellyatsiya berilganda) yoki eʼlon kechikkan boʻlsa (3, 14, 45 kundan keyin) qayta tekshiriladi.
          Hali birinchi instansiyada koʻrilayotgan ishlarda qaror boʻlmaydi, ular tekshirilmaydi.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', margin: '0 0 12px' }}>
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked)
              setAutoEnabled(e.target.checked)
            }}
          />
          Ilova ishlatilmayotganda oʻzi tekshirsin (3 daqiqa boʻsh turgandan keyin, 6 soatda koʻpi bilan bir marta)
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={() => (!collecting ? void checkWatchlistOrders({ auto: false }) : runner.paused ? void resumeWatchlistCheck() : void pauseWatchlistCheck())}
          >
            {!collecting ? <RefreshCw /> : runner.paused ? <Play /> : <Pause />}
            <span>{!collecting ? 'Hozir tekshirish' : runner.paused ? 'Davom ettirish' : 'Pauza'}</span>
          </button>
        </div>
        <div className="kv" style={{ marginTop: 14 }}>
          <span className="k">Oxirgi avtomatik tekshiruv</span>
          <span className="mono">{dmyHm(lastAuto || null)}</span>
        </div>
        {collecting && (
          <div className="kv">
            <span className="k">Ishlar yigʻilmoqda{runner.paused ? ' (pauza)' : ''}</span>
            <span className="mono">{runner.done}/{runner.total} kompaniya</span>
          </div>
        )}
      </div>

      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><ListChecks /></div>
          <h3>Navbat</h3>
          <div className="sp" />
          <span className={`badge ${st.cls}`}>{st.text}</span>
        </div>
        {job && job.total > 0 ? (
          <>
            <div className="kv"><span className="k">Ishlar</span><span className="mono">{job.done}/{job.total}</span></div>
            <div className="kv"><span className="k">Qolgan</span><span className="mono">{num(queued)}</span></div>
            <div className="kv"><span className="k">Public.sud.uz dan soʻralgan</span><span className="mono">{num(job.searched)}</span></div>
            <div className="kv"><span className="k">Yangi qarorlar</span><span className="mono">{num(job.found)}</span></div>
            {job.known > 0 && <div className="kv"><span className="k">Allaqachon maʼlum (soʻralmaydi)</span><span className="mono">{num(job.known)}</span></div>}
            {job.ongoing > 0 && <div className="kv"><span className="k">Hali koʻrilayotgan (qaror yoʻq)</span><span className="mono">{num(job.ongoing)}</span></div>}
            {job.errors > 0 && <div className="kv"><span className="k">Xatolar</span><span className="mono">{num(job.errors)}</span></div>}
            {job.current && <div className="kv"><span className="k">Hozir</span><span className="mono">{job.current}</span></div>}
            {job.lastError && <p className="faint" style={{ fontSize: 12.5, margin: '8px 0 0' }}>Oxirgi xato: {job.lastError} (keyinroq qayta uriniladi)</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {job.state === 'running' && (
                <button className="btn btn-outline" onClick={() => void pausePublicOrdersJob().then(load)}>
                  <Pause /><span>Pauza</span>
                </button>
              )}
              {(job.state === 'paused' || job.state === 'ready') && (
                <button className="btn btn-outline" onClick={() => void resumePublicOrdersJob().then(load)}>
                  <Play /><span>{job.state === 'ready' ? 'Boshlash' : 'Davom ettirish'}</span>
                </button>
              )}
              {job.state !== 'running' && job.state !== 'paused' && job.failed > 0 && (
                <button className="btn btn-outline" onClick={() => void retryPublicOrdersJob().then(load)}>
                  <RefreshCw /><span>Xatoli ishlarni qayta urinish ({job.failed})</span>
                </button>
              )}
              {(job.state === 'running' || job.state === 'paused' || job.state === 'ready') && queued > 0 && (
                <button className="btn btn-outline" onClick={() => void cancelPublicOrdersJob().then(load)}>
                  <X /><span>Qolganini bekor qilish</span>
                </button>
              )}
            </div>
          </>
        ) : (
          <p className="faint" style={{ fontSize: 12.5, margin: '2px 0 0' }}>Hozir yuklanayotgan qaror yoʻq.</p>
        )}
        {error && <p className="faint" style={{ marginTop: 10, fontSize: 12.5 }}>{error}</p>}
      </div>

      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><Database /></div>
          <h3>Mahalliy kesh</h3>
        </div>
        {cache ? (
          <>
            <div className="kv"><span className="k">Tekshirilgan ishlar</span><span className="mono">{num(cache.cases)}</span></div>
            <div className="kv"><span className="k">Qarori eʼlon qilingan ishlar</span><span className="mono">{num(cache.withOrders)}</span></div>
            <div className="kv"><span className="k">Saqlangan qarorlar</span><span className="mono">{num(cache.orders)}</span></div>
            {cache.failed > 0 && <div className="kv"><span className="k">Tekshirib boʻlmagan (qayta uriniladi)</span><span className="mono">{num(cache.failed)}</span></div>}
            <div className="kv"><span className="k">Diskda</span><span className="mono">{size(cache.bytes)}</span></div>
            <div className="kv"><span className="k">Oxirgi tekshiruv</span><span className="mono">{dmyHm(cache.lastCheckedAt)}</span></div>
          </>
        ) : (
          <p className="faint" style={{ fontSize: 12.5, margin: '2px 0 0' }}>Yuklanmoqda…</p>
        )}
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '10px 0 10px' }}>
          Faqat qaror haqidagi kichik yozuvlar saqlanadi (ish raqami, instansiya, sud, sudya, natija, PDF havolasi). Qaror matni faqat PDF ni bosganingizda olinadi.
        </p>
        {confirmClear ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12.5 }}>Hamma saqlangan yozuvlar oʻchadi. Davom etamizmi?</span>
            <button className="btn btn-outline btn-sm" onClick={() => void clear()}><Trash2 /><span>Ha, tozalash</span></button>
            <button className="btn btn-outline btn-sm" onClick={() => setConfirmClear(false)}><span>Yoʻq</span></button>
          </div>
        ) : (
          <button className="btn btn-outline btn-sm" disabled={!cache || (cache.cases === 0 && cache.orders === 0)} onClick={() => setConfirmClear(true)}>
            <Trash2 /><span>Keshni tozalash</span>
          </button>
        )}
      </div>
    </div>
  )
}
