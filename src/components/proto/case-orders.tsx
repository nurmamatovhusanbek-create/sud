'use client'

/**
 * A case's decisions, in two cards:
 *  - «Eʼlon qilingan qarorlar» — published orders from the public library (read from the LOCAL cache,
 *    instant): instance, court, judge, result, PDF on click, plus the case-data decision of that instance.
 *  - «Eʼlon qilinmagan qarorlar» — decisions the court-case data already gives us (date + text) for which the
 *    library has NO published order. If the case was never looked up, they are labelled «tekshirilmagan» and
 *    a button checks them in the background (the global loader shows progress).
 * While the lookup result is loading (or failed) the known decisions show as a plain list, so the drawer
 * never loses information it already had.
 */

import { useEffect, useState } from 'react'
import { FileText, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { fetchPublicOrders, getPublicOrders, openPublicOrderPdf, type PublicOrdersData } from '@/lib/api-client'
import { PUBLIC_INSTANCE_LABEL, PUBLIC_RESULT_LABEL, splitDecisions, type KnownDecision } from '@/core/public-orders'
import { DwSection } from '@/components/proto/drawer'

type State = { status: 'loading' } | { status: 'ok'; data: PublicOrdersData } | { status: 'error' }

const dmy = (iso: string | null): string => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('.') : '')

function Quote({ d }: { d: KnownDecision }) {
  return (
    <div className="dw-quote">
      <div className="d">{d.date || '-'}</div>
      <p>{d.text || '-'}</p>
    </div>
  )
}

export function CaseOrders({ caseNumber, courtType, decisions }: { caseNumber: string; courtType: string; decisions: KnownDecision[] }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [opening, setOpening] = useState<string | null>(null)
  const [queueing, setQueueing] = useState(false)
  const [tick, setTick] = useState(0)

  // load; while a background download is running, re-read every 3 s so newly found orders appear on their own
  const downloading = state.status === 'ok' && state.data.downloading
  useEffect(() => {
    const ac = new AbortController()
    getPublicOrders(caseNumber, ac.signal)
      .then((r) => setState(r.ok ? { status: 'ok', data: r.data } : { status: 'error' }))
      .catch(() => { /* aborted */ })
    return () => ac.abort()
  }, [caseNumber, tick])
  useEffect(() => {
    if (!downloading) return
    const t = setInterval(() => setTick((n) => n + 1), 3000)
    return () => clearInterval(t)
  }, [downloading])

  if (state.status !== 'ok') {
    // loading / failed: show what the case data already says, exactly as before
    if (!decisions.length) return null
    return (
      <DwSection title={decisions.length > 1 ? 'Qarorlar' : 'Qaror'}>
        {decisions.map((d) => <Quote key={d.instance} d={d} />)}
      </DwSection>
    )
  }

  const { orders, checked } = state.data
  const view = splitDecisions(decisions, orders)
  // «none published» is only an answer once the library was actually asked about this case
  const looked = !!checked
  const lookupFailed = !!checked?.error && !orders.length

  const open = async (pdfId: string, name: string) => {
    setOpening(pdfId)
    try {
      await openPublicOrderPdf(pdfId, name)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Qarorni ochib boʻlmadi')
    } finally {
      setOpening(null)
    }
  }

  const check = async () => {
    setQueueing(true)
    const r = await fetchPublicOrders([{ caseNumber, courtType }], { force: true })
    setQueueing(false)
    if (!r.ok) toast.error(r.error)
    else {
      toast.success('Tekshirish boshlandi — orqa fonda ishlaydi, boshqa ishingizni davom ettiring')
      setTick((n) => n + 1)
    }
  }

  const checkBtn = (
    <button className="btn btn-outline btn-sm" disabled={queueing || state.data.downloading} onClick={() => void check()}>
      {queueing || state.data.downloading ? <Loader2 className="spin" /> : <RefreshCw />}
      <span>{state.data.downloading ? 'Tekshirilmoqda…' : lookupFailed ? 'Qayta urinish' : 'Tekshirish'}</span>
    </button>
  )

  return (
    <>
      {view.published.length > 0 && (
        <DwSection title="Eʼlon qilingan qarorlar" count={view.published.length}>
          <div className="dw-orders">
            {view.published.map(({ order: o, decision }) => (
              <div className="dw-order" key={o.id}>
                <div className="w">
                  <b>{PUBLIC_INSTANCE_LABEL[o.instance] || o.instance || 'Qaror'}</b>
                  <span>{[o.court, o.judge].filter(Boolean).join(' · ')}</span>
                  {o.category ? <span className="cat">{o.category}</span> : null}
                  {decision ? <span className="cat">{decision.date ? `${decision.date} · ` : ''}{decision.text}</span> : null}
                </div>
                <span className="badge b-neu">{PUBLIC_RESULT_LABEL[o.result] || o.result || '–'}</span>
                <button className="btn btn-outline btn-sm" disabled={!o.pdfId || opening === o.pdfId} onClick={() => void open(o.pdfId, o.pdfName)} title="Qaror matnini PDF sifatida ochish">
                  {opening === o.pdfId ? <Loader2 className="spin" /> : <FileText />}
                  <span>PDF</span>
                </button>
              </div>
            ))}
          </div>
        </DwSection>
      )}

      {view.unpublished.length > 0 && (
        <DwSection title="Eʼlon qilinmagan qarorlar" count={view.unpublished.length}>
          <div className="dw-orders">
            {view.unpublished.map((d) => (
              <div className="dw-unpub" key={d.instance}>
                <div className="h">
                  <b>{PUBLIC_INSTANCE_LABEL[d.instance]}</b>
                  <span className={`badge ${looked && !lookupFailed ? 'b-warn' : 'b-neu'}`}>
                    {looked && !lookupFailed ? 'Eʼlon qilinmagan' : lookupFailed ? 'Tekshirib boʻlmadi' : 'Tekshirilmagan'}
                  </span>
                </div>
                <Quote d={d} />
              </div>
            ))}
            {(!looked || lookupFailed) && <div className="dw-orders-empty" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
              <span>Bu qarorlar sud maʼlumotlaridan olingan. public.sud.uz da eʼlon qilinganini tekshirib, PDF shaklida olish mumkin.{lookupFailed ? ` (${checked?.error})` : ''}</span>
              {checkBtn}
            </div>}
          </div>
        </DwSection>
      )}

      {/* nothing known and nothing published: only say so once the library has been asked */}
      {!view.published.length && !view.unpublished.length && (
        <DwSection title="Eʼlon qilingan qarorlar">
          <div className="dw-orders-empty" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between' }}>
            <span>
              {looked && !lookupFailed
                ? `Bu ish boʻyicha eʼlon qilingan qaror topilmadi (${dmy(checked!.at.slice(0, 10))} da tekshirilgan; ish oʻzgarsa yoki eʼlon kechiksa qayta tekshiriladi).`
                : 'Bu ish public.sud.uz da tekshirilmagan.'}
            </span>
            {(!looked || lookupFailed) && checkBtn}
          </div>
        </DwSection>
      )}
    </>
  )
}
