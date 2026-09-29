'use client'

/**
 * Settings › Qarorlar — the local index of the public court-order library.
 * A polite background crawl (one date-window page at a time) copies the library's small metadata rows
 * (case number, instance, court, judge, result, PDF id) to this machine, so a case's published orders
 * appear instantly in its drawer. Start, pause, and watch it here; it resumes where it stopped.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Library, Pause, Play } from 'lucide-react'
import { toast } from 'sonner'
import { getPublicOrdersStatus, syncPublicOrders } from '@/lib/api-client'
import { PUBLIC_COURT_TYPES, type PublicCourtType } from '@/core/public-orders'
import type { PublicOrdersStatus } from '@/lib/public-orders/types'

const TYPE_LABEL: Record<PublicCourtType, string> = {
  ECONOMIC: 'Iqtisodiy sud (~184 ming qaror, diskda ~40 MB)',
  CIVIL: 'Fuqarolik sudi (~429 ming qaror, diskda ~90 MB)',
  ADMINISTRATIVE: 'Maʼmuriy sud (~64 ming qaror, diskda ~15 MB)',
}

const TYPE_SHORT: Record<PublicCourtType, string> = { ECONOMIC: 'Iqtisodiy', CIVIL: 'Fuqarolik', ADMINISTRATIVE: 'Maʼmuriy' }

const STATE_LABEL: Record<PublicOrdersStatus['crawl']['state'], { text: string; cls: string }> = {
  idle: { text: 'Toʻxtab turibdi', cls: 'b-neu' },
  running: { text: 'Ishlamoqda', cls: 'b-info' },
  paused: { text: 'Pauza', cls: 'b-warn' },
  error: { text: 'Xato', cls: 'b-neg' },
  done: { text: 'Tayyor', cls: 'b-pos' },
}

const dmy = (iso: string | null): string => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('.') : '–')
const num = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function OrdersTab() {
  const [status, setStatus] = useState<PublicOrdersStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [types, setTypes] = useState<PublicCourtType[]>(['ECONOMIC'])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await getPublicOrdersStatus()
    if (r.ok) {
      setStatus(r.data)
      setError(null)
    } else setError(r.error)
  }, [])

  const running = status?.crawl.state === 'running'

  // poll faster while a crawl runs; every exit path clears the timer
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), running ? 2000 : 8000)
    return () => clearInterval(t)
  }, [load, running])

  const act = async (action: 'start' | 'pause') => {
    setBusy(true)
    const r = await syncPublicOrders(action, action === 'start' ? types : undefined)
    setBusy(false)
    if (!r.ok) toast.error(r.error)
    else if (action === 'start') toast.success('Koʻchirish boshlandi — orqa fonda ishlaydi')
    await load()
  }

  const toggle = (t: PublicCourtType) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]))
  const crawl = status?.crawl
  const st = STATE_LABEL[crawl?.state ?? 'idle']

  return (
    <div className="dash" style={{ gridTemplateColumns: '1fr' }}>
      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><Library /></div>
          <h3>Qarorlar kutubxonasini toʻliq koʻchirish (ixtiyoriy)</h3>
          <div className="sp" />
          <span className={`badge ${st.cls}`}>{st.text}</span>
        </div>

        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '2px 0 8px' }}>
          Odatda kerak emas: <b>Sud ishlari</b> roʻyxatidagi «Qarorlar» tugmasi faqat kerakli ishlarning qarorlarini orqa fonda yuklaydi
          (kichik, kompyuterni ogʻirlashtirmaydi).
        </p>
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '2px 0 12px' }}>
          Toʻliq koʻchirish ixtiyoriy: public.sud.uz dagi eʼlon qilingan qarorlarning kichik yozuvlari (ish raqami, instansiya, sud, sudya, natija) shu kompyuterga
          koʻchiriladi. Shundan soʻng ish oynasida qarorlar darhol chiqadi. Qaror matni faqat bosganingizda olinadi. Koʻchirish sekin va
          ehtiyotkor: bir vaqtda bitta sahifa, pauza qilsangiz joyidan davom etadi.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '0 0 12px' }}>
          {PUBLIC_COURT_TYPES.map((t) => (
            <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: running ? 'default' : 'pointer' }}>
              <input type="checkbox" checked={types.includes(t)} disabled={running} onChange={() => toggle(t)} />
              {TYPE_LABEL[t]}
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {running ? (
            <button className="btn btn-outline" disabled={busy} onClick={() => void act('pause')}>
              <Pause />
              <span>Pauza</span>
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy || !types.length} onClick={() => void act('start')}>
              <Play />
              <span>{status && Object.keys(status.types).length ? 'Davom ettirish / yangilash' : 'Koʻchirishni boshlash'}</span>
            </button>
          )}
        </div>

        {running && crawl?.current && (
          <div className="kv" style={{ marginTop: 14 }}>
            <span className="k">Hozir</span>
            <span className="mono">{TYPE_SHORT[crawl.current.courtType]} · {dmy(crawl.current.day)}</span>
          </div>
        )}
        {crawl && crawl.state !== 'idle' && (
          <div className="kv">
            <span className="k">Shu ishga tushirishda</span>
            <span className="mono">{num(crawl.rowsThisRun)} yozuv</span>
          </div>
        )}
        {crawl?.lastError && (
          <div className="alert err" style={{ marginTop: 12 }}>
            <AlertTriangle />
            <div className="at">
              <b>Koʻchirish toʻxtadi</b>
              <p>{crawl.lastError}. Ilgari olingan qismi saqlangan — «Davom ettirish» tugmasi joyidan boshlaydi.</p>
            </div>
          </div>
        )}
        {error && <p className="faint" style={{ marginTop: 10, fontSize: 12.5 }}>{error}</p>}
      </div>

      {status && Object.keys(status.types).length > 0 && (
        <div className="p-card rise-c">
          <div className="card-h">
            <h3>Koʻchirilgani</h3>
          </div>
          {(Object.entries(status.types) as [PublicCourtType, NonNullable<PublicOrdersStatus['types'][PublicCourtType]>][]).map(([t, p]) => (
            <div className="kv" key={t}>
              <span className="k">{TYPE_SHORT[t]}</span>
              <span style={{ textAlign: 'right', fontSize: 12.5 }}>
                <b className="mono">{num(p.rows)}</b> yozuv · {dmy(p.oldest)} → {dmy(p.newest)}
                <br />
                <span className="faint">
                  {p.complete ? 'Kutubxona boshigacha yetildi' : 'Eski qismi hali koʻchirilmoqda'}
                  {p.mismatches ? ` · ${p.mismatches} kunda son mos kelmadi` : ''}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
