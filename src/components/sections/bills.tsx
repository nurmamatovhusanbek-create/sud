'use client'

/**
 * Bills section — the prototypeʼs Toʻlovlar: STIR/invoice toggle pair, the
 * invoice check-in row, summary KPIs, the dense receipt list with filter bar
 * (search + status seg + stream replay + Excel export), the phase-ladder
 * stream card while importing, and the cheque-style receipt drawer with a
 * generated barcode. Live NDJSON stream via useStream; one-shot invoice
 * lookup via getBillDetail.
 */

import { useEffect, useMemo, useState } from 'react'
import { Bolt, Check, ChevronRight, Clock, Download, Gavel, Receipt, Search, Timer, Wallet } from 'lucide-react'
import { EmptyBlock, Kpi, TogglePair, Seg, CountUp } from '@/components/proto/primitives'
import { openProtoDrawer, closeProtoDrawer } from '@/components/proto/drawer'
import { useStream, phaseIndex } from '@/hooks/use-stream'
import { setCachedBills, billsTotals, patchBillsMeta } from '@/lib/bills-cache'
import { exportBillsXlsx, getBillDetail } from '@/lib/api-client'
import { useAppStore } from '@/lib/store/app-store'
import { useTabCounts } from '@/lib/tab-counts'
import { billStatusFamilySafe } from './bills-helpers'
import {
  formatSum,
  formatDate,
  statusLabel,
  courtTypeLabel,
  categoryLabel,
  type EnrichedBill,
  type CheckStatusResponse,
} from '@/core/billing-format'
import { familyBadgeClass } from '@/components/proto/primitives'
import { toast } from 'sonner'

const PHASES: [string, string][] = [
  ['connecting', 'billing.sud.uz ga ulanilmoqda'],
  ['captcha', 'PoW captcha yechilmoqda (SHA-256)'],
  ['fetching', "Kvitansiyalar roʻyxati olinmoqda"],
  ['enriching', 'Har bir toʻlov tafsiloti olinmoqda'],
]

/** Deterministic pseudo-barcode from the invoice number (prototype barcode()). */
function Barcode({ seed }: { seed: string }) {
  const bars = useMemo(() => {
    const arr: { height: number; strong: boolean }[] = []
    let h = 0
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
    for (let i = 0; i < 52; i++) {
      h = (h * 1103515245 + 12345 + i) >>> 0
      arr.push({ height: 18 + (h % 17), strong: ((h >> 3) & 1) === 1 })
    }
    return arr
  }, [seed])
  return (
    <div className="rc-barcode">
      {bars.map((b, i) => (
        <i key={i} style={{ height: b.height, opacity: b.strong ? 1 : 0.55 }} />
      ))}
    </div>
  )
}

/** Receipt drawer — shared with the Overview "Soʻnggi toʻlovlar" strip. */
export function openReceipt(b: EnrichedBill, activeStir: string | undefined) {
  const d = (b.detail || null) as CheckStatusResponse | null
  const status = d?.invoiceStatus ?? b.invoiceStatus
  const fam = billStatusFamilySafe(status)
  const rows: [string, React.ReactNode][] = [
    ['Toʻlovchi', <span className="v sans" key="payer">{d?.payer || '-'}</span>],
    ['Sud', <span className="v sans" key="court">{d?.court || courtTypeLabel(d?.courtType) || '-'}</span>],
    ['Instansiya', <span className="v sans" key="inst">{d?.instance || '-'}</span>],
    ['Kategoriya', <span className="v sans" key="cat">{d?.payCategory ? categoryLabel(d.payCategory).label : '-'}</span>],
    ['Ish raqami', <span className="v" key="case">{d?.claimCaseNumber || '-'}</span>],
    ['Sana', <span className="v" key="date">{formatDate(b.issued)}</span>],
    ['Maqsad', <span className="v sans" key="purpose" style={{ maxWidth: '60%', textAlign: 'right' }}>{d?.purpose || d?.description || '-'}</span>],
    ['Toʻlangan', <span className="v" key="paid">{formatSum(d?.paidAmount)} soʻm</span>],
    ['Balans', <span className="v" key="balance">{formatSum(d?.balance)} soʻm</span>],
  ]
  if (d?.overdue && d.overdue > 0) {
    rows.push(['Muddati oʻtgan', <span className="v" key="overdue" style={{ color: 'var(--neg-text)' }}>{formatSum(d.overdue)} soʻm</span>])
  }
  rows.push(['Foydasiga', <span className="v sans" key="favor">{d?.isInFavor === true ? 'Ha' : d?.isInFavor === false ? "Yoʻq" : '-'}</span>])

  openProtoDrawer(
    'Kvitansiya',
    <div>
      <div className="receipt">
        <div className="rc-h">
          <div>
            <div className="eyebrow">billing.sud.uz</div>
            <div className="rc-num">{b.number}</div>
            <Barcode seed={b.number} />
          </div>
          <span className={`badge ${familyBadgeClass(fam)}`}>{statusLabel(status)}</span>
        </div>
        <div style={{ padding: '8px 0' }}>
          {rows.map(([k, v]) => (
            <div className="rc-line" key={k}>
              <span className="k">{k}</span>
              {v}
            </div>
          ))}
        </div>
        <div className="rc-total">
          <span>Jami summa</span>
          <span className="v">{formatSum(d?.amount)} soʻm</span>
        </div>
      </div>
      <div className="p-row" style={{ marginTop: 16, gap: 10 }}>
        <button
          className="btn btn-outline btn-sm"
          style={{ flex: 1 }}
          onClick={() => toast.success('PDF yuklab olindi')}
        >
          <Download />
          <span>PDF</span>
        </button>
        {d?.claimCaseNumber ? (
          <button
            className="btn btn-outline btn-sm"
            style={{ flex: 1 }}
            onClick={() => {
              closeProtoDrawer()
              if (activeStir) useAppStore.getState().openCompany(activeStir)
              useAppStore.getState().setSection('cases')
              setTimeout(
                () =>
                  window.dispatchEvent(
                    new CustomEvent('sud:open-case', { detail: { caseNumber: d.claimCaseNumber, courtType: d.courtType } }),
                  ),
                350,
              )
            }}
          >
            <Gavel />
            <span>Ishni ochish</span>
          </button>
        ) : null}
      </div>
    </div>,
    b.number,
  )
}

// ---- stream card ---------------------------------------------------------------

function StreamCard({ phase, loaded, total, error }: { phase: string | null; loaded: number; total: number | null; error: string | null }) {
  const current = phaseIndex(phase)
  return (
    <div className="stream">
      <div className="p-row">
        <div
          className="ico"
          style={{ width: 36, height: 36, borderRadius: 11, background: 'var(--accent)', color: 'var(--accent-contrast)', display: 'grid', placeItems: 'center' }}
        >
          <Bolt style={{ width: 17, height: 17 }} />
        </div>
        <div>
          <b style={{ fontSize: 14 }}>Toʻlovlar yuklab olinmoqda…</b>
          <div className="faint mono" style={{ fontSize: 12 }}>
            {error ? 'Xato' : <><span>{loaded}</span> / ~{total ?? '…'} kvitansiya</>}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <span className="spinner" />
      </div>
      <div className="stream-bar">
        <div className="stream-fill" style={{ width: `${total ? Math.min(100, Math.round((loaded / total) * 100)) : current >= 0 ? 12 : 4}%` }} />
      </div>
      <div className="phases">
        {PHASES.map(([k, label], i) => {
          const cls = i < current ? 'done' : i === current ? 'active' : ''
          return (
            <div className={`phase ${cls}`} key={k}>
              <span className="pd">{i < current ? <Check /> : i === current ? <Clock /> : <Clock style={{ opacity: 0.4 }} />}</span>
              {label}
            </div>
          )
        })}
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--neg-text)' }}>{error}</div>}
    </div>
  )
}

// ---- section ---------------------------------------------------------------

export function BillsSection() {
  const company = useAppStore((s) => s.activeCompany)
  const stream = useStream()
  const setCounts = useTabCounts((s) => s.set)
  const [mode, setMode] = useState<'stir' | 'invoice'>('stir')
  const [invoice, setInvoice] = useState('')
  const [filter, setFilter] = useState('')
  const [seg, setSeg] = useState<'all' | 'paid' | 'overdue'>('all')
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [exporting, setExporting] = useState(false)

  const stir = company?.stir

  useEffect(() => {
    if (!stir) return
    stream.start(stir)
  }, [stir])

  useEffect(() => {
    const handler = () => {
      if (stir) stream.start(stir)
    }
    window.addEventListener('sud:force-section', handler)
    return () => window.removeEventListener('sud:force-section', handler)
  }, [stir])

  const items = stream.items
  useEffect(() => {
    if (stream.total !== null) setCounts({ bills: stream.total })
    else if (items.length) setCounts({ bills: items.length })
  }, [stream.total, items.length, setCounts])

  // Mirror the stream into the shared bills cache (Overview KPIs + recent strip)
  useEffect(() => {
    if (!stir || items.length === 0) return
    setCachedBills(stir, items)
  }, [stir, items])

  // Persist billing aggregates into registry meta once the stream completes
  useEffect(() => {
    if (!stir || stream.status !== 'done') return
    patchBillsMeta(stir, billsTotals(stir))
  }, [stir, stream.status])

  const summary = useMemo(() => {
    let paid = 0
    let overdue = 0
    let partial = 0
    let totalSum = 0
    let totalPaid = 0
    for (const b of items) {
      const d = b.detail
      const st = d?.invoiceStatus ?? b.invoiceStatus
      if (st === 'PAID' || st === 'USED') paid++
      else if (st === 'OVERDUE') overdue++
      else if (st === 'PARTIALLY_PAID') partial++
      totalSum += d?.amount ?? 0
      totalPaid += d?.paidAmount ?? 0
    }
    return { paid, overdue, partial, totalSum, totalPaid, count: items.length }
  }, [items])

  const filtered = useMemo(() => {
    let list = items
    if (seg === 'paid') list = list.filter((b) => ['PAID', 'USED'].includes((b.detail?.invoiceStatus ?? b.invoiceStatus) as string))
    if (seg === 'overdue') list = list.filter((b) => (b.detail?.invoiceStatus ?? b.invoiceStatus) === 'OVERDUE')
    const q = filter.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (b) =>
          b.number.toLowerCase().includes(q) ||
          (b.detail?.claimCaseNumber || '').toLowerCase().includes(q) ||
          (b.detail?.court || '').toLowerCase().includes(q),
      )
    }
    return list
  }, [items, seg, filter])

  const checkInvoice = async () => {
    const v = invoice.replace(/\D/g, '')
    if (v.length !== 12) {
      toast.error('12 ta raqam kiriting')
      return
    }
    setInvoiceBusy(true)
    try {
      const res = await getBillDetail(v)
      setInvoiceBusy(false)
      if (res.ok) {
        const bill = (res.data as { bill?: unknown }).bill
        const asEnriched: EnrichedBill =
          typeof bill === 'object' && bill !== null && 'number' in (bill as Record<string, unknown>)
            ? (bill as EnrichedBill)
            : ({
                number: v,
                invoiceStatus: (bill as CheckStatusResponse | null)?.invoiceStatus ?? 'CREATED',
                issued: (bill as CheckStatusResponse | null)?.issued ?? null,
                detail: (bill as CheckStatusResponse | null) ?? null,
              })
        openReceipt(asEnriched, stir)
      } else {
        toast.error(res.error)
      }
    } catch {
      setInvoiceBusy(false)
      toast.error('Kvitansiyani tekshirib boʻlmadi')
    }
  }

  if (!company) return null
  const streaming = stream.status === 'streaming' || stream.status === 'idle'

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <TogglePair
          options={[
            { key: 'stir', label: 'STIR · barcha toʻlovlar' },
            { key: 'invoice', label: 'Kvitansiya boʻyicha' },
          ]}
          value={mode}
          onChange={(k) => setMode(k as typeof mode)}
        />
      </div>

      {mode === 'invoice' && (
        <div style={{ marginBottom: 18 }}>
          <label className="field" style={{ maxWidth: 420 }}>
            <Search />
            <input
              value={invoice}
              onChange={(e) => setInvoice(e.target.value.replace(/\D/g, '').slice(0, 12))}
              inputMode="numeric"
              placeholder="12 xonali kvitansiya raqami…"
            />
            <button className="btn btn-primary btn-sm" style={{ margin: '-4px -12px -4px 0' }} onClick={() => void checkInvoice()} disabled={invoiceBusy}>
              {invoiceBusy ? <span className="spinner" /> : 'Tekshirish'}
            </button>
          </label>
        </div>
      )}

      {mode === 'stir' && (
        <>
          <div className="kpis" style={{ marginBottom: 18 }}>
            <Kpi label="Jami kvitansiya" icon={<Receipt />}>
              <CountUp value={summary.count} />
            </Kpi>
            <Kpi label="Toʻlangan" icon={<Check />} foot={<><span className="p-dot d-pos" />Toʻliq</>}>
              <CountUp value={summary.paid} />
            </Kpi>
            <Kpi label="Qisman / Muddati oʻtgan" icon={<Timer />} foot={<><span className="p-dot d-neg" />Eʼtibor talab</>}>
              <span>
                <CountUp value={summary.partial} /> / <span style={{ color: 'var(--neg-text)' }}><CountUp value={summary.overdue} /></span>
              </span>
            </Kpi>
            <Kpi label="Umumiy summa" icon={<Wallet />} valueSize={18}>
              <span>{formatSum(summary.totalSum)}</span>
            </Kpi>
          </div>

          <div className="p-card rise-c">
            <div className="filterbar">
              <div className="f-search">
                <Search />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Kvitansiya yoki ish raqami…" />
              </div>
              <Seg
                options={[
                  { key: 'all', label: 'Barchasi' },
                  { key: 'paid', label: "Toʻlangan" },
                  { key: 'overdue', label: "Muddati oʻtgan" },
                ]}
                value={seg}
                onChange={(k) => setSeg(k as typeof seg)}
              />
              <div style={{ flex: 1 }} />
              <button className="btn btn-outline btn-sm" onClick={() => stir && stream.start(stir)}>
                <Bolt />
                <span>Oqimni koʻrsatish</span>
              </button>
              <button
                className="btn btn-outline btn-sm"
                disabled={exporting || items.length === 0}
                onClick={() => {
                  setExporting(true)
                  void (async () => {
                    try {
                      await exportBillsXlsx({ inn: stir, bills: items })
                      toast.success('Excel yuklab olindi')
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Eksport xatosi')
                    } finally {
                      setExporting(false)
                    }
                  })()
                }}
              >
                {exporting ? <span className="spinner" /> : <Download />}
                <span>Excel</span>
              </button>
            </div>

            {streaming ? (
              <StreamCard phase={stream.phase} loaded={items.length} total={stream.total} error={stream.error} />
            ) : stream.status === 'error' && items.length === 0 ? (
              <EmptyBlock
                icon={<Receipt />}
                title="Kvitansiyalar olinmadi"
                hint={stream.error || 'billing.sud.uz javob bermadi.'}
                action={
                  <button className="btn btn-outline btn-sm" onClick={() => stir && stream.start(stir)}>
                    Qayta urinish
                  </button>
                }
              />
            ) : items.length === 0 ? (
              <EmptyBlock icon={<Receipt />} title="Kvitansiyalar topilmadi" hint="Bu STIR boʻyicha billing.sud.uz da kvitansiya yoʻq." />
            ) : filtered.length === 0 ? (
              <EmptyBlock icon={<Search />} title="Filtr boʻyicha natija yoʻq" hint="Boshqa soʻz bilan qidirib koʻring." />
            ) : (
              <div className="list">
                {filtered.map((b, i) => {
                  const d = b.detail
                  const status = d?.invoiceStatus ?? b.invoiceStatus
                  const fam = billStatusFamilySafe(status)
                  return (
                    <div className="lrow" key={`${b.number}-${i}`} data-bill={b.number} onClick={() => openReceipt(b, stir)}>
                      <div className="lead">
                        <Receipt />
                      </div>
                      <div className="main-c">
                        <b className="mono">{b.number}</b>
                        <div className="sub">
                          {d?.payCategory ? categoryLabel(d.payCategory).label : 'Toʻlov'} · {d?.court || courtTypeLabel(d?.courtType) || '-'}
                          {d?.claimCaseNumber ? ` · ish ${d.claimCaseNumber}` : ''}
                        </div>
                      </div>
                      <span className={`badge ${familyBadgeClass(fam)}`}>{statusLabel(status)}</span>
                      <div className="amt">
                        {formatSum(d?.amount)}
                        <small>{formatDate(b.issued)}</small>
                      </div>
                      <span className="chev">
                        <ChevronRight />
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
