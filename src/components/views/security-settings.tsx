'use client'

/**
 * Settings › Xavfsizlik — what the app's perimeter refused and which dangerous doors were used, since the server
 * started. Two cards: the posture it runs with, and the events (newest first). Nothing here changes anything; it only
 * makes a forged or stray request visible instead of a silent 403 (server/audit.ts keeps the ring in memory).
 */

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react'
import { getSecurityStatus, type SecurityStatus } from '@/lib/api-client'
import { SECURITY_EVENT_KINDS, SECURITY_EVENT_LABEL } from '@/core/security-events'
import { EmptyBlock } from '@/components/proto/primitives'

const p2 = (n: number) => String(n).padStart(2, '0')
const dmyHms = (t: number): string => {
  const d = new Date(t)
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}

export function SecurityTab() {
  const [data, setData] = useState<SecurityStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    const r = await getSecurityStatus(signal)
    if (signal?.aborted) return
    if (r.ok && Array.isArray(r.data?.recent) && r.data.counts && r.data.posture) {
      setData(r.data)
      setError(null)
    } else {
      setError(r.ok ? 'Javob shakli notoʻgʻri' : r.error)
    }
  }, [])

  // on open, then every 10 s while this tab is on screen
  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal).catch(() => {})
    const t = setInterval(() => void load(ac.signal).catch(() => {}), 10_000)
    return () => {
      ac.abort()
      clearInterval(t)
    }
  }, [load])

  if (!data) {
    return error ? (
      <EmptyBlock icon={<ShieldAlert />} title="Xavfsizlik holati olinmadi" hint={error} action={<button className="btn btn-outline btn-sm" onClick={() => void load()}>Qayta urinish</button>} />
    ) : (
      <div className="p-card faint">Yuklanmoqda…</div>
    )
  }

  const refused = SECURITY_EVENT_KINDS.filter((k) => SECURITY_EVENT_LABEL[k].tone === 'bad').reduce((n, k) => n + data.counts[k], 0)
  const doors = data.counts.privileged_call
  const { posture } = data

  return (
    <div className="dash" style={{ gridTemplateColumns: '1fr' }}>
      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico">{refused > 0 ? <ShieldAlert /> : <ShieldCheck />}</div>
          <h2>Himoya holati</h2>
          <button className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void load()}>
            <RefreshCw />
            <span>Yangilash</span>
          </button>
        </div>
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: '2px 0 8px' }}>
          Server ishga tushganidan beri ({dmyHms(data.since)}). Ilova faqat shu kompyuterdan ochiladi; boshqa sayt yoki boshqa nomdan kelgan soʻrovlar rad etiladi.
        </p>
        <div className="kv">
          <span className="k">Rad etilgan soʻrovlar</span>
          <span className={`badge ${refused > 0 ? 'b-warn' : 'b-pos'}`}>{refused}</span>
        </div>
        <div className="kv">
          <span className="k">Ochilgan xavfli eshiklar (yangilash, workerlar, Tor)</span>
          <span className="badge b-neu">{doors}</span>
        </div>
        <div className="kv">
          <span className="k">API token</span>
          {posture.tokenRequired ? (
            <span>Talab qilinadi</span>
          ) : posture.production ? (
            <span className="badge b-warn">Yoʻq — production uchun APP_API_TOKEN oʻrnating</span>
          ) : (
            <span>Yoʻq (faqat localhost himoyasi)</span>
          )}
        </div>
        <div className="kv">
          <span className="k">Qoʻshimcha ruxsat etilgan nomlar</span>
          <span>{posture.extraHosts}</span>
        </div>
        <div className="kv">
          <span className="k">Proksi sarlavhalariga ishonish</span>
          <span>{posture.trustProxy ? 'Ha' : 'Yoʻq'}</span>
        </div>
        <div className="kv">
          <span className="k">Rejim</span>
          <span>{posture.production ? 'Production' : 'Dev'}{posture.supervised ? ' · nazoratchi ostida' : ''}</span>
        </div>
      </div>

      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><ShieldAlert /></div>
          <h2>Soʻnggi hodisalar</h2>
        </div>
        {data.recent.length === 0 ? (
          <p className="faint" style={{ fontSize: 13, margin: '6px 0 2px' }}>Hozircha hodisa yoʻq. Rad etilgan soʻrov yoki ochilgan xavfli eshik shu yerda koʻrinadi.</p>
        ) : (
          <div className="list">
            {data.recent.map((e, i) => {
              const k = SECURITY_EVENT_LABEL[e.kind]
              return (
                <div className="kv" key={`${e.ts}-${i}`} title={k.hint}>
                  <span className="mono faint" style={{ fontSize: 12, flex: '0 0 auto' }}>{dmyHms(e.ts)}</span>
                  <span className={`badge ${k.tone === 'bad' ? 'b-warn' : 'b-info'}`} style={{ flex: '0 0 auto' }}>{k.text}</span>
                  <span className="mono" style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.method} {e.path}
                    {e.detail ? <span className="faint"> · {e.detail}</span> : null}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
