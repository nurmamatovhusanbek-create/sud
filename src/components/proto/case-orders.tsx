'use client'

/**
 * «Eʼlon qilingan qarorlar» — the published orders of one case, read from the LOCAL index of the public
 * court-order library (instant; the slow upstream search is never called from here). Each order shows its
 * instance, court, judge and result, and opens its PDF on click.
 */

import { useEffect, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { getPublicOrders, openPublicOrderPdf, type PublicOrdersData } from '@/lib/api-client'
import { PUBLIC_INSTANCE_LABEL, PUBLIC_RESULT_LABEL } from '@/core/public-orders'
import { DwSection } from '@/components/proto/drawer'

type State = { status: 'loading' } | { status: 'ok'; data: PublicOrdersData } | { status: 'error'; error: string }

/** 2026-05-12 → 12.05.2026 */
const dmy = (iso: string | null): string => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split('-').reverse().join('.') : '')

export function CaseOrders({ caseNumber }: { caseNumber: string }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [opening, setOpening] = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    setState({ status: 'loading' })
    getPublicOrders(caseNumber, ac.signal)
      .then((r) => setState(r.ok ? { status: 'ok', data: r.data } : { status: 'error', error: r.error }))
      .catch(() => { /* aborted */ })
    return () => ac.abort()
  }, [caseNumber])

  if (state.status === 'loading') return null // the drawer is already busy; don't add a second spinner
  if (state.status === 'error') return null // an optional extra: a failure here must never clutter the case

  const { orders, coverage } = state.data

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

  if (!orders.length) {
    // «none found» is only a real answer once the library has been indexed
    const hint = !coverage.indexed
      ? 'Qarorlar kutubxonasi hali koʻchirilmagan. Sozlamalar › Qarorlar boʻlimida ishga tushiring.'
      : coverage.complete
        ? 'Bu ish boʻyicha eʼlon qilingan qaror topilmadi.'
        : `Topilmadi. Kutubxona ${dmy(coverage.since)} dan ${dmy(coverage.until)} gacha koʻchirilgan${coverage.running ? ' (davom etmoqda)' : ''}.`
    return (
      <DwSection title="Eʼlon qilingan qarorlar">
        <div className="dw-orders-empty">{hint}</div>
      </DwSection>
    )
  }

  return (
    <DwSection title="Eʼlon qilingan qarorlar" count={orders.length}>
      <div className="dw-orders">
        {orders.map((o) => (
          <div className="dw-order" key={o.id}>
            <div className="w">
              <b>{PUBLIC_INSTANCE_LABEL[o.instance] || o.instance || 'Qaror'}</b>
              <span>{[o.court, o.judge].filter(Boolean).join(' · ')}</span>
              {o.category ? <span className="cat">{o.category}</span> : null}
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
  )
}
