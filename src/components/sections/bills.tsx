'use client'

/**
 * Bills section — the prototypeʼs Toʻlovlar: STIR/invoice toggle pair, the
 * invoice check-in row, summary KPIs, the dense receipt list with filter bar
 * (search + status seg + court-type and fee-kind chips + Excel export), the
 * load card while the server loads the bills page by page, and the cheque-style
 * receipt drawer with a generated barcode. The bills live on the server
 * (lib/bills-store): this tab asks for ONE PAGE with its filters (useStoredBills)
 * and polls while the load runs; one-shot invoice lookup via getBillDetail.
 */

import { useEffect, useMemo, useState } from 'react'
import { Bolt, ChevronRight, Download, Gavel, Receipt, Search } from 'lucide-react'
import { SolidIcon } from '@/components/ui-custom/solid-icons'
import { getLook } from '@/lib/look'
import { EmptyBlock, Kpi, TogglePair, Seg, CountUp, SortMenu, type SortKey } from '@/components/proto/primitives'
import { openProtoDrawer, closeProtoDrawer, useDockedRowKey, DwKv, DwFig, DwSection, type DwRow, type DrawerOpts } from '@/components/proto/drawer'
import { ListPagination, clampPage, DEFAULT_PAGE_SIZE } from '@/components/ui-custom/list-pagination'
import { printHtml, escapeHtml } from '@/lib/print'
import { useStoredBills } from '@/hooks/use-stored-bills'
import { TelegramCopyCard } from '@/components/sections/telegram-copy-card'
import { reportAge } from '@/lib/data-age'
import { COMPANY_REFRESHED } from '@/lib/hard-refresh'
import { setCachedBills, setBillsSummary, billsTotals, patchBillsMeta } from '@/lib/bills-cache'
import { exportBillsXlsx, getBillDetail } from '@/lib/api-client'
import { rowAsDetail, type BillRow, type BillSeg, type BillSort, type CategoryKind } from '@/core/bill-rows'
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
export function openReceipt(b: EnrichedBill, activeStir: string | undefined, nav?: DrawerOpts['nav']) {
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
    // the day of the ruling this invoice belongs to (billing returns it; nothing showed it)
    ['Qaror sanasi', d?.decisionDate ? formatDate(d.decisionDate).slice(0, 10) : '', { mono: true }],
    ['Toʻlovchi STIR', d?.payerTin, { mono: true }],
    ['Hisob raqami', d?.forAccount, { mono: true }],
    ['Maqsad', d?.purpose || d?.description],
    ['Toʻlanishi kerak', d?.mustPayAmount ? `${formatSum(d.mustPayAmount)} soʻm` : '', { mono: true }],
    ['Toʻlangan', d ? `${formatSum(d.paidAmount)} soʻm` : '', { mono: true }],
    ['Balans', d ? `${formatSum(d.balance)} soʻm` : '', { mono: true }],
    ['Muddati oʻtgan', d?.overdue && d.overdue > 0 ? `${formatSum(d.overdue)} soʻm` : '', { mono: true, tone: 'neg' }],
    ['Foydasiga', d?.isInFavor === true ? 'Ha' : d?.isInFavor === false ? 'Yoʻq' : ''],
  ]

  // where this invoice was USED: each entry is a payment applied to a case (billing's historyList; a rolled-back one is marked)
  const history: DwRow[] = (d?.historyList ?? []).map((h) => [
    formatDate(h.createdAt).slice(0, 10),
    `${h.caseNumber || 'ish raqamisiz'} · ${formatSum(h.amount)} soʻm${h.rolledBackAt ? ' · qaytarilgan' : ''}`,
    { mono: true },
  ])

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
          ['Toʻlovchi STIR', d?.payerTin],
          ['Maqsad', d?.purpose || d?.description],
          ['Toʻlanishi kerak', d?.mustPayAmount ? `${formatSum(d.mustPayAmount)} soʻm` : null],
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
      {history.length > 0 && (
        <DwSection title="Foydalanish tarixi" count={history.length}>
          <DwKv rows={history} />
        </DwSection>
      )}
    </div>,
    subline,
    {
      eyebrow: 'Toʻlov kvitansiyasi',
      // the original look keeps the receipt a slide-over above the page; the others dock it beside the list
      ...(getLook() === 'navy' ? {} : { dock: true, rowKey: b.number, nav }),
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

// ---- load card -----------------------------------------------------------------

/** the load of the company's bills runs on the server, page by page: the rows stored so far are already in the list below */
function LoadCard({ page, pages, pass, stored, total, wait, error, onStop }: { page: number; pages: number; pass: number; stored: number; total: number; wait: number; error: string | null; onStop: () => void }) {
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
            {pages > 0 ? `${Math.min(page + 1, pages)}/${pages}-sahifa` : 'billing javobi kutilmoqda…'}{pass > 0 ? ` · ${pass + 1}-oʻtish` : ''} · {total ? `${formatCount(total)} ta kvitansiya` : '…'} · <span>{formatCount(stored)}</span> tasi ish raqamli (saqlanadi)
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-outline btn-sm" onClick={onStop}>Toʻxtatish</button>
        <span className="spinner" />
      </div>
      <div className="stream-bar">
        <div className="stream-fill" style={{ width: `${pages > 0 ? Math.min(100, Math.max(4, Math.round((page / pages) * 100))) : 4}%` }} />
      </div>
      <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text-3)' }}>
        Yuklangan sahifalar hozirdan qidirilishi va ochilishi mumkin; qolganlari ketma-ket qoʻshiladi. Ish raqamisiz kvitansiyalar saqlanmaydi, shuning uchun saqlanganlar soni jami sondan kam boʻladi. Sahifadan chiqsangiz ham yuklash davom etadi.
      </div>
      {wait > 0 && <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--text-2)' }}>billing.sud.uz javob bermadi: {wait} soniyadan keyin qayta uriniladi.</div>}
      {error && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--neg-text)' }}>{error}</div>}
    </div>
  )
}

const formatCount = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

// ---- section ---------------------------------------------------------------

/** a stored row as the receipt reads a bill */
const asEnriched = (r: BillRow): EnrichedBill => ({ number: r.number, invoiceStatus: r.status, issued: r.issued, detail: rowAsDetail(r) })

const COURT_CHIPS: { key: '' | 'economic' | 'civil' | 'administrative' | 'criminal'; label: string }[] = [
  { key: '', label: 'Barcha sudlar' },
  { key: 'economic', label: 'Iqtisodiy' },
  { key: 'civil', label: 'Fuqarolik' },
  { key: 'administrative', label: 'Maʼmuriy' },
  { key: 'criminal', label: 'Jinoyat' },
]
const KIND_CHIPS: { key: '' | CategoryKind; label: string }[] = [
  { key: '', label: 'Barcha turlar' },
  { key: 'davlat_boji', label: 'Davlat boji' },
  { key: 'pochta', label: 'Pochta' },
  { key: 'other', label: 'Boshqa' },
]

export function BillsSection() {
  const company = useAppStore((s) => s.activeCompany)
  const setCounts = useTabCounts((s) => s.set)
  const [mode, setMode] = useState<'stir' | 'invoice'>('stir')
  const [invoice, setInvoice] = useState('')
  const [filter, setFilter] = useState('')
  const [qDeb, setQDeb] = useState('')
  const [seg, setSeg] = useState<BillSeg>('all')
  const [court, setCourt] = useState<(typeof COURT_CHIPS)[number]['key']>('')
  const [kind, setKind] = useState<'' | CategoryKind>('')
  const [sort, setSort] = useState<SortKey>('new')
  const [invoiceBusy, setInvoiceBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  // v204 (P-D): restored pagination (was dropped in the rebuild)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)

  const stir = company?.stir

  // the search box asks the server (the bills of a big company are not in the browser): one question per pause in typing
  useEffect(() => {
    const t = setTimeout(() => setQDeb(filter), 250)
    return () => clearTimeout(t)
  }, [filter])

  const store = useStoredBills(stir, { page, size: pageSize, sort: sort as BillSort, seg, q: qDeb, court: court || undefined, kind: kind || undefined })
  const bills = store.data?.bills ?? null
  const meta = store.data?.meta ?? null
  const job = store.data?.job
  const loadingBills = store.loading_bills && job?.phase === 'load'
  const summary = bills?.summary ?? null
  const rows = bills?.rows ?? []

  useEffect(() => {
    // a section-level retry: read billing.sud.uz again now
    const force = () => void store.refresh()
    window.addEventListener('sud:force-section', force)
    return () => window.removeEventListener('sud:force-section', force)
  }, [store.refresh])

  // the header shows how old the dossier is
  useEffect(() => {
    if (!stir) return
    reportAge(stir, 'bills', meta?.complete && meta.loadedAt ? meta.loadedAt : undefined, false)
  }, [stir, meta?.complete, meta?.loadedAt])

  useEffect(() => {
    if (bills) setCounts({ bills: bills.total })
  }, [bills?.total, setCounts])

  // the Overview reads the whole company's totals and the newest receipts from the shared bills cache
  const defaultView = page === 1 && sort === 'new' && seg === 'all' && !qDeb.trim() && !court && !kind
  useEffect(() => {
    if (!stir || !bills) return
    const s = bills.summary
    setBillsSummary(stir, { loaded: true, count: s.count, paidCount: s.paid, totalPaid: s.totalPaid, overdue: s.overdueSum })
    if (defaultView) setCachedBills(stir, bills.rows.map(asEnriched))
  }, [stir, bills, defaultView])

  // Persist billing aggregates into registry meta once the load is complete
  useEffect(() => {
    if (!stir || !meta?.complete || !bills) return
    patchBillsMeta(stir, billsTotals(stir))
  }, [stir, meta?.complete, bills?.total])

  // Reset to page 1 whenever the list-shaping inputs change
  useEffect(() => {
    setPage(1)
  }, [qDeb, seg, sort, court, kind, stir])

  const matched = bills?.matched ?? 0
  const safePage = clampPage(page, matched, pageSize)
  // the receipt DOCKS beside the list (wide screens): the page's rows step with ↑ ↓
  const openReceiptAt = (idx: number) => {
    const r = rows[idx]
    if (!r) return
    const nav = {
      pos: `${(safePage - 1) * pageSize + idx + 1} / ${matched}`,
      prev: idx > 0 ? () => openReceiptAt(idx - 1) : undefined,
      next: idx < rows.length - 1 ? () => openReceiptAt(idx + 1) : undefined,
    }
    openReceipt(asEnriched(r), stir, nav)
    // a list row has no usage history (where the receipt was applied): it is asked for when the receipt opens
    void getBillDetail(r.number).then((res) => {
      const bill = res.ok ? (res.data as { bill?: CheckStatusResponse | null }).bill : null
      if (bill && bill.historyList && bill.historyList.length && document.querySelector('.drawer')) openReceipt({ ...asEnriched(r), detail: { ...rowAsDetail(r), historyList: bill.historyList } }, stir, nav)
    })
  }
  const dockedBill = useDockedRowKey()
  useEffect(() => {
    if (dockedBill) document.querySelector('.lrow.sel')?.scrollIntoView({ block: 'nearest' })
  }, [dockedBill])

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

  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!job?.waitingUntil) return
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [job?.waitingUntil])
  if (!company) return null
  const wait = job?.waitingUntil ? Math.max(0, Math.ceil((job.waitingUntil - nowMs) / 1000)) : 0
  const loadFailed = job?.state === 'error' || job?.state === 'paused'

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
            <Kpi label="Jami kvitansiya" icon={<SolidIcon name="receipt" />}>
              <CountUp value={summary?.count ?? 0} id={`bills-count-${stir}`} />
            </Kpi>
            <Kpi label="Toʻlangan" icon={<SolidIcon name="check-circle" />} foot={<><span className="p-dot d-pos" />Toʻliq</>}>
              <CountUp value={summary?.paid ?? 0} id={`bills-paid-${stir}`} />
            </Kpi>
            <Kpi label="Qisman / Muddati oʻtgan" icon={<SolidIcon name="timer" />} foot={<><span className="p-dot d-neg" />Eʼtibor talab</>}>
              <span>
                <CountUp value={summary?.partial ?? 0} id={`bills-partial-${stir}`} /> / <span style={{ color: 'var(--neg-text)' }}><CountUp value={summary?.overdue ?? 0} id={`bills-overdue-${stir}`} /></span>
              </span>
            </Kpi>
            <Kpi label="Umumiy summa" icon={<SolidIcon name="wallet" />} valueSize={18}>
              <span>{formatSum(summary?.totalAmount ?? 0)}</span>
            </Kpi>
          </div>

          <div className="p-card rise-c">
            <div className="filterbar">
              <div className="f-search">
                <Search />
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Kvitansiya, ish raqami yoki sud…" />
              </div>
              <Seg
                options={[
                  { key: 'all', label: 'Barchasi' },
                  { key: 'paid', label: "Toʻlangan" },
                  { key: 'overdue', label: "Muddati oʻtgan" },
                ]}
                value={seg}
                onChange={(k) => setSeg(k as BillSeg)}
              />
              <SortMenu value={sort} onChange={setSort} />
              <div style={{ flex: 1 }} />
              <button className="btn btn-outline btn-sm" disabled={store.loading_bills} onClick={() => void store.refresh()}>
                <Bolt />
                <span>Yangilash</span>
              </button>
              <button
                className="btn btn-outline btn-sm"
                disabled={exporting || !bills || matched === 0}
                onClick={() => {
                  setExporting(true)
                  void (async () => {
                    try {
                      await exportBillsXlsx({ inn: stir, query: { q: qDeb, seg, sort, court: court || undefined, kind: kind || undefined } })
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
            {/* the court type each bill names and the kind of fee: a case needs two bills, state duty and postal costs; the bills carry the court type,
                so the civil cases of a bank show up here even though its TIN lists show few */}
            <div className="filterbar" style={{ paddingTop: 0 }}>
              <Seg options={COURT_CHIPS.map((c) => ({ key: c.key || 'all', label: c.label }))} value={court || 'all'} onChange={(k) => setCourt(k === 'all' ? '' : (k as typeof court))} />
              <Seg options={KIND_CHIPS.map((c) => ({ key: c.key || 'all', label: c.label }))} value={kind || 'all'} onChange={(k) => setKind(k === 'all' ? '' : (k as CategoryKind))} />
            </div>

            {!loadingBills && meta?.complete && meta.stable && summary && meta.totalElements > summary.count && (
              <div className="faint" style={{ fontSize: 12.5, margin: '8px 0 12px' }}>
                Billingda {formatCount(meta.totalElements)} ta kvitansiya bor, {formatCount(summary.count)} tasi ish raqamli va saqlangan. Qolgan {formatCount(meta.totalElements - summary.count)} tasida ish raqami yoʻq (daʼvo xarajatlari: ish hali ochilmagan, va boshqa toʻlovlar), shuning uchun saqlanmaydi: bu yuklash xatosi emas.
              </div>
            )}
            {loadingBills && job && <LoadCard page={job.page} pages={job.pages} pass={job.pass} stored={bills?.total ?? 0} total={job.bills || meta?.totalElements || 0} wait={wait} error={store.error} onStop={() => void store.stop()} />}
            {/* billing's paging is not stable (the same page asked twice returns other bills): the load reads several passes; if they never agreed, say so */}
            {!loadingBills && meta?.complete && !meta.stable && bills && (
              <div className="dw-orders-empty" style={{ margin: '12px 0' }}>
                Billing sahifalari barqaror emas (bir xil sahifa har safar boshqa kvitansiyalarni qaytaradi). {formatCount(bills.total)} ta noyob kvitansiya olindi, billingda {formatCount(meta.totalElements)} qator bor: baʼzi kvitansiyalar yetishmasligi mumkin. «Yangilash» yana bir bor oʻqiydi va yetishmaganlarini qoʻshadi.
              </div>
            )}
            {!loadingBills && loadFailed && job?.lastError && (
              <div className="alert err" style={{ margin: '12px 0' }}>
                <div className="at">
                  <b>Toʻlovlar toʻliq yuklanmadi</b>
                  <p>{job.lastError} Yuklangan {formatCount(bills?.total ?? 0)} ta kvitansiya saqlangan; «Yangilash» davom ettiradi.</p>
                </div>
              </div>
            )}

            {store.loading && !bills ? (
              <div className="list"><div className="sk-rows" style={{ padding: 18 }}>Yuklanmoqda…</div></div>
            ) : !bills && store.error ? (
              <EmptyBlock
                icon={<Receipt />}
                title="Kvitansiyalar olinmadi"
                hint={store.error}
                action={<button className="btn btn-outline btn-sm" onClick={() => void store.refresh()}>Qayta urinish</button>}
              />
            ) : !bills && store.data?.inTelegram ? (
              <TelegramCopyCard entry={store.data.inTelegram} onScrape={() => void store.scrapeNow()} onLoaded={store.refetch} />
            ) : !bills ? (
              <EmptyBlock icon={<Receipt />} title="Kvitansiyalar yuklanmoqda" hint="Birinchi sahifa kelishi bilan shu yerda koʻrinadi." />
            ) : bills.total === 0 && !loadingBills ? (
              <EmptyBlock icon={<Receipt />} title="Kvitansiyalar topilmadi" hint="Bu STIR boʻyicha billing.sud.uz da kvitansiya yoʻq." />
            ) : matched === 0 ? (
              <EmptyBlock icon={<Search />} title="Filtr boʻyicha natija yoʻq" hint="Boshqa soʻz yoki filtr bilan qidirib koʻring." />
            ) : (
              <div className="list">
                {rows.map((r, i) => {
                  const fam = billStatusFamilySafe(r.status)
                  return (
                    <div className={`lrow${dockedBill && dockedBill === r.number ? ' sel' : ''}`} key={`${r.number}-${i}`} data-bill={r.number} onClick={() => openReceiptAt(i)}>
                      <div className="lead">
                        <Receipt />
                      </div>
                      <div className="main-c">
                        <b className="mono">{r.number}</b>
                        <div className="sub">
                          {r.cat ? categoryLabel(r.cat).label : 'Toʻlov'} · {r.court || courtTypeLabel(r.courtType) || '-'}
                          {r.caseNumber ? ` · ish ${r.caseNumber}` : ''}
                        </div>
                      </div>
                      <span className={`badge ${familyBadgeClass(fam)}`}>{statusLabel(r.status)}</span>
                      <div className="amt">
                        {formatSum(r.amount)}
                        <small>{formatDate(r.issued)}</small>
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
              total={matched}
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
