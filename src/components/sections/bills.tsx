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
import { EmptyBlock, Kpi, TogglePair, Seg, CountUp, SortMenu, applySort, type SortKey } from '@/components/proto/primitives'
import { openProtoDrawer, closeProtoDrawer, DwKv, DwFig, type DwRow } from '@/components/proto/drawer'
import { ListPagination, clampPage, DEFAULT_PAGE_SIZE } from '@/components/ui-custom/list-pagination'
import { printHtml, escapeHtml } from '@/lib/print'
import { useStream, phaseIndex } from '@/hooks/use-stream'
import { reportAge } from '@/lib/data-age'
import { COMPANY_REFRESHED } from '@/lib/hard-refresh'
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
  const rows: DwRow[] = [
    ['Toʻlovchi', d?.payer],
    ['Sud', d?.court || courtTypeLabel(d?.courtType)],
    ['Instansiya', d?.instance],
    ['Kategoriya', d?.payCategory ? categoryLabel(d.payCategory).label : ''],
    ['Ish raqami', d?.claimCaseNumber, { mono: true }],
    ['Sana', formatDate(b.issued), { mono: true }],
    ['Maqsad', d?.purpose || d?.description],
    ['Toʻlangan', d ? `${formatSum(d.paidAmount)} soʻm` : '', { mono: true }],
    ['Balans', d ? `${formatSum(d.balance)} soʻm` : '', { mono: true }],
    ['Muddati oʻtgan', d?.overdue && d.overdue > 0 ? `${formatSum(d.overdue)} soʻm` : '', { mono: true, tone: 'neg' }],
    ['Foydasiga', d?.isInFavor === true ? 'Ha' : d?.isInFavor === false ? 'Yoʻq' : ''],
  ]

  // v204 (P-C): real print dialog for the receipt (was a fake toast).
  const printReceipt = () => {
    try {
      printHtml(
        `Kvitansiya ${b.number}`,
        `<div class="pr-head">
          <div>
            <div class="pr-eyebrow">billing.sud.uz</div>
            <div class="pr-title">${escapeHtml(b.number)}</div>
          </div>
          <div class="pr-meta"><span class="pr-badge">${escapeHtml(statusLabel(status))}</span></div>
        </div>
        ${[
          ['Toʻlovchi', d?.payer],
          ['Sud', d?.court || courtTypeLabel(d?.courtType)],
          ['Instansiya', d?.instance],
          ['Kategoriya', d?.payCategory ? categoryLabel(d.payCategory).label : null],
          ['Ish raqami', d?.claimCaseNumber],
          ['Sana', formatDate(b.issued)],
          ['Maqsad', d?.purpose || d?.description],
          ['Toʻlangan', d ? `${formatSum(d.paidAmount)} soʻm` : null],
          ['Balans', d ? `${formatSum(d.balance)} soʻm` : null],
          ...(d?.overdue && d.overdue > 0 ? [['Muddati oʻtgan', `${formatSum(d.overdue)} soʻm`]] : []),
          ['Foydasiga', d?.isInFavor === true ? 'Ha' : d?.isInFavor === false ? 'Yoʻq' : null],
        ]
          .map(([k, v]) => `<div class="pr-kv"><span class="k">${escapeHtml(String(k))}</span><span class="v">${escapeHtml(v == null || v === '' ? '-' : String(v))}</span></div>`)
          .join('')}
        <div class="pr-total"><span>Jami summa</span><span>${escapeHtml(formatSum(d?.amount))} soʻm</span></div>`,
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Chop etib boʻlmadi')
    }
  }

  const subline = [formatDate(b.issued), d?.payCategory ? categoryLabel(d.payCategory).label : '']
    .filter((x) => x && x !== '-')
    .join(' · ')
  const openCase = d?.claimCaseNumber
    ? () => {
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
      }
    : null

  openProtoDrawer(
    'Kvitansiya',
    <div style={{ marginTop: 22 }}>
      <div className="dw-ticket">
        <div className="dw-ticket-h">
          <div>
            <div className="eb">billing.sud.uz</div>
            <div className="num">{b.number}</div>
            <Barcode seed={b.number} />
          </div>
          <span className={`badge ${familyBadgeClass(fam)}`}>{statusLabel(status)}</span>
        </div>
        <DwKv rows={rows} />
        <DwFig label="Jami summa" value={formatSum(d?.amount)} unit="soʻm" />
      </div>
    </div>,
    subline,
    {
      eyebrow: 'Toʻlov kvitansiyasi',
      footer: (
        <>
          <button className={`btn ${openCase ? 'btn-outline' : 'btn-primary'}`} onClick={printReceipt}>
            <Download />
            <span>PDF</span>
          </button>
          {openCase ? (
            <button className="btn btn-primary" onClick={openCase}>
              <Gavel />
              <span>Ishni ochish</span>
            </button>
          ) : null}
        </>
      ),
    },
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
  const [sort, setSort] = useState<SortKey>('new')
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  // v204 (P-D): restored pagination (was dropped in the rebuild)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const stir = company?.stir

  useEffect(() => {
    if (!stir) return
    stream.start(stir)
  }, [stir])

  useEffect(() => {
    // a section-level retry: scrape billing.sud.uz now, not the daily snapshot
    const force = () => {
      if (stir) stream.start(stir, { force: true })
    }
    // the header's hard refresh retired the snapshot (when the stats came back complete): read again
    const refreshed = () => {
      if (stir) stream.start(stir)
    }
    window.addEventListener('sud:force-section', force)
    window.addEventListener(COMPANY_REFRESHED, refreshed)
    return () => {
      window.removeEventListener('sud:force-section', force)
      window.removeEventListener(COMPANY_REFRESHED, refreshed)
    }
  }, [stir])

  // the header shows how old the dossier is
  useEffect(() => {
    if (!stir) return
    reportAge(stir, 'bills', stream.status === 'done' && stream.fetchedAt ? stream.fetchedAt : undefined, stream.stale)
  }, [stir, stream.status, stream.fetchedAt, stream.stale])

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
    return applySort(list, sort, (b) => b.issued ?? 0, (b) => b.number)
  }, [items, seg, filter, sort])

  // Reset to page 1 whenever the list-shaping inputs change
  useEffect(() => {
    setPage(1)
  }, [filter, seg, sort, stir])

  const safePage = clampPage(page, filtered.length, pageSize)
  const paged = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

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
              <CountUp value={summary.count} id={`bills-count-${stir}`} />
            </Kpi>
            <Kpi label="Toʻlangan" icon={<Check />} foot={<><span className="p-dot d-pos" />Toʻliq</>}>
              <CountUp value={summary.paid} id={`bills-paid-${stir}`} />
            </Kpi>
            <Kpi label="Qisman / Muddati oʻtgan" icon={<Timer />} foot={<><span className="p-dot d-neg" />Eʼtibor talab</>}>
              <span>
                <CountUp value={summary.partial} id={`bills-partial-${stir}`} /> / <span style={{ color: 'var(--neg-text)' }}><CountUp value={summary.overdue} id={`bills-overdue-${stir}`} /></span>
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
              <SortMenu value={sort} onChange={setSort} />
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
                {paged.map((b, i) => {
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
            <ListPagination
              page={safePage}
              pageSize={pageSize}
              total={filtered.length}
              onPage={setPage}
              onPageSize={(n) => {
                setPageSize(n)
                setPage(1)
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
