'use client'

/**
 * Qarorlar — the page for the published court orders kept on this computer (sidebar, below Statistika). Built like the
 * Sud ishlari window: a filter bar (search + court type + instance + download state), a dense list and the shared pager,
 * all filtered and paged on the SERVER (`GET /api/public-orders/library`), so a library of thousands of orders stays fast.
 *
 * Every row says whether its PDF is already on this computer («Yuklangan · size · date»); a click opens it. An order that
 * is not downloaded yet is fetched on click, with the same hand-over as the case drawer when public.sud.uz wants a person.
 * A typed full case number can also be looked up on public.sud.uz (both back ends, criminal included) and stored here.
 * Settings › Qarorlar keeps only the queue / cache control panel.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileText, Loader2, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyBlock, Seg, SkRows } from '@/components/proto/primitives'
import { OrderHandover } from '@/components/proto/order-handover'
import { ListPagination, clampPage } from '@/components/ui-custom/list-pagination'
import { fetchPublicOrders, getPublicOrdersLibrary, importPublicOrderPdf, ManualOrderError, openPublicOrderPdf, type LibraryPage } from '@/lib/api-client'
import { courtTypeOfCase, normalizeCaseNumber, PUBLIC_INSTANCE_LABEL, PUBLIC_RESULT_LABEL, type LibraryItem, type LibraryStatus, type PublicCourtType } from '@/core/public-orders'
import { useOrdersJob } from '@/lib/use-orders-job'

const COURT_SEG: { key: string; label: string }[] = [
  { key: '', label: 'Barchasi' },
  { key: 'ECONOMIC', label: 'Iqtisodiy' },
  { key: 'CIVIL', label: 'Fuqarolik' },
  { key: 'ADMINISTRATIVE', label: 'Maʼmuriy' },
  { key: 'CRIMINAL', label: 'Jinoyat' },
]
const INSTANCE_SEG: { key: string; label: string }[] = [
  { key: '', label: 'Barcha bosqich' },
  { key: 'FIRST', label: 'Birinchi' },
  { key: 'APPEAL', label: 'Apellyatsiya' },
  { key: 'CASSATION', label: 'Kassatsiya' },
  { key: 'INSPECTION', label: 'Taftish' },
]

const p2 = (n: number) => String(n).padStart(2, '0')
const dmy = (t: number): string => {
  const d = new Date(t)
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`
}
const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

export function OrdersView() {
  const [q, setQ] = useState('')
  const [court, setCourt] = useState('')
  const [instance, setInstance] = useState('')
  const [status, setStatus] = useState<LibraryStatus>('saved')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [data, setData] = useState<LibraryPage | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  const [opening, setOpening] = useState<string | null>(null)
  const [manual, setManual] = useState<LibraryItem | null>(null)
  const [importing, setImporting] = useState(false)
  // «public.sud.uz dan qidirish»: look ONE typed case number up (both systems) and store what is found
  const [lookCourt, setLookCourt] = useState<PublicCourtType | ''>('')
  const [looking, setLooking] = useState(false)
  const { job } = useOrdersJob()
  const first = useRef(true)

  const fullNumber = /^\d+-[\d-]+\/\d+$/.test(normalizeCaseNumber(q))
  const lookCourtShown = lookCourt || courtTypeOfCase(q) || 'ECONOMIC'

  // local read; typing is debounced and a newer request cancels the older one
  useEffect(() => {
    const ac = new AbortController()
    const t = setTimeout(() => {
      getPublicOrdersLibrary({ q: q.trim(), status, court, instance, page, size: pageSize }, ac.signal)
        .then((r) => {
          setFailed(!r.ok)
          if (r.ok) setData(r.data)
        })
        .catch(() => { /* aborted */ })
    }, first.current ? 0 : 250)
    first.current = false
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [q, status, court, instance, page, pageSize, tick])

  // a page that no longer exists (the list got shorter) falls back to the last one
  const total = data?.total ?? 0
  const safePage = clampPage(page, total, pageSize)
  useEffect(() => {
    if (data && safePage !== page) setPage(safePage)
  }, [data, safePage, page])

  // while a looked-up case is being searched, re-read every 3 s; one more read when it ends
  const running = job?.state === 'running'
  useEffect(() => {
    if (!looking) return
    if (!running) {
      const t = setTimeout(() => {
        setTick((n) => n + 1)
        setLooking(false)
      }, 1500) // the queue may not have picked the case up yet: give it a moment before calling it finished
      return () => clearTimeout(t)
    }
    const t = setInterval(() => setTick((n) => n + 1), 3000)
    return () => clearInterval(t)
  }, [looking, running])

  const lookUp = async () => {
    setLooking(true)
    const r = await fetchPublicOrders([{ caseNumber: normalizeCaseNumber(q), courtType: lookCourtShown }], { force: true })
    if (!r.ok) {
      setLooking(false)
      toast.error(r.error)
      return
    }
    setStatus('all') // what it finds is not downloaded yet: show it
    toast.success('Qidirilmoqda — public.sud.uz dan olinmoqda (orqa fonda)')
  }

  const open = async (o: LibraryItem, retryAuto = false) => {
    if (!o.pdfId) {
      toast.error('Bu yozuvda fayl yoʻq')
      return
    }
    setOpening(o.id)
    try {
      await openPublicOrderPdf(o.pdfId, o.pdfName, { retryAuto })
      setManual(null)
      setTick((n) => n + 1) // it is on disk now: the badge changes
    } catch (e) {
      if (e instanceof ManualOrderError) setManual(o)
      else toast.error(e instanceof Error ? e.message : 'Qarorni ochib boʻlmadi')
    } finally {
      setOpening(null)
    }
  }

  const importFile = async (file: File | undefined) => {
    if (!file || !manual) return
    setImporting(true)
    const r = await importPublicOrderPdf(manual.pdfId, file)
    setImporting(false)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    toast.success('Qaror saqlandi')
    const o = manual
    setManual(null)
    void open(o)
  }

  const counts = data?.counts
  const statusOptions = useMemo(
    () => [
      { key: 'saved', label: `Yuklangan${counts ? ` · ${counts.saved}` : ''}` },
      { key: 'missing', label: `Yuklanmagan${counts ? ` · ${counts.missing}` : ''}` },
      { key: 'all', label: `Hammasi${counts ? ` · ${counts.all}` : ''}` },
    ],
    [counts],
  )
  // any filter change goes back to page 1
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }
  const items = data?.items ?? []
  const filtered = !!(q.trim() || court || instance)

  return (
    <div>
      <div className="hero" style={{ marginBottom: 12 }}>
        <div className="eyebrow">public.sud.uz · mahalliy arxiv</div>
        <h1>
          Qarorlar <span className="g2">arxivi</span>
        </h1>
        <p>
          Eʼlon qilingan sud qarorlari: ish raqami boʻyicha qidiring, qaysilari kompyuteringizga yuklab olinganini koʻring va PDF ni bir bosishda oching.
          {data ? ` Yuklangan PDF: ${data.savedPdfs} ta · roʻyxatdagi qarorlar: ${data.stored} ta.` : ''}
        </p>
      </div>

      <div className="p-card rise-c">
        <div className="filterbar">
          <div className="f-search" style={{ flex: '1 1 380px', minWidth: 260 }}>
            <Search />
            <input
              value={q}
              onChange={(e) => reset(setQ)(e.target.value)}
              placeholder="Ish raqami (4-1001-2615/40333, 2615) yoki sud, sudya, toifa…"
              aria-label="Qarorlarni qidirish"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Seg options={COURT_SEG} value={court} onChange={reset(setCourt)} />
          <Seg options={INSTANCE_SEG} value={instance} onChange={reset(setInstance)} />
          <Seg options={statusOptions} value={status} onChange={(k) => reset(setStatus)(k as LibraryStatus)} />
          <div style={{ flex: 1 }} />
          <button className="btn btn-outline btn-sm" onClick={() => setTick((n) => n + 1)} title="Roʻyxatni qayta oʻqish">
            <RefreshCw />
            <span>Yangilash</span>
          </button>
        </div>

        {fullNumber && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 10px' }}>
            <select
              value={lookCourtShown}
              onChange={(e) => setLookCourt(e.target.value as PublicCourtType)}
              aria-label="Sud turi"
              style={{ height: 32, borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', background: 'var(--surface-inset)', color: 'var(--text-1)', padding: '0 8px', fontSize: 13 }}
            >
              <option value="ECONOMIC">Iqtisodiy</option>
              <option value="CIVIL">Fuqarolik</option>
              <option value="ADMINISTRATIVE">Maʼmuriy</option>
              <option value="CRIMINAL">Jinoyat</option>
            </select>
            <button className="btn btn-outline btn-sm" disabled={looking} onClick={() => void lookUp()} title="Bu ish raqamini public.sud.uz dan qidirib, topilgan qarorlarni shu yerga saqlaydi">
              {looking ? <Loader2 className="spin" /> : <Search />}
              <span>{looking ? 'Qidirilmoqda…' : 'public.sud.uz dan qidirish'}</span>
            </button>
            <span className="faint" style={{ fontSize: 12 }}>2024 dan oldingi va keyingi qarorlar ikkalasi ham qidiriladi</span>
          </div>
        )}

        {failed && !data ? (
          <EmptyBlock icon={<Search />} title="Qidiruvni bajarib boʻlmadi" hint="Server javob bermadi. “Yangilash” ni bosib qayta urinib koʻring." />
        ) : !data ? (
          <SkRows n={6} />
        ) : items.length === 0 ? (
          <EmptyBlock
            icon={<FileText />}
            title={filtered ? 'Filtr boʻyicha qaror topilmadi' : status === 'saved' ? 'Hali birorta qaror PDF si yuklanmagan' : 'Hali saqlangan qaror yoʻq'}
            hint={
              filtered
                ? status === 'saved' && counts && counts.missing > 0
                  ? `Yuklanmagan ${counts.missing} ta mos qaror bor — “Yuklanmagan” yoki “Hammasi” ni tanlang.`
                  : fullNumber
                    ? 'Bu raqamni “public.sud.uz dan qidirish” bilan qidirib koʻring.'
                    : 'Boshqa soʻz yoki filtr bilan urinib koʻring.'
                : 'Ish kartasidagi “PDF” tugmasini bossangiz, qaror shu yerga saqlanadi; “Tekshirish” esa eʼlon qilingan qarorlar roʻyxatini yangilaydi.'
            }
          />
        ) : (
          <>
            <div className="list">
              {items.map((o) => (
                <div className="lrow" key={o.id} data-order={o.caseNumber} onClick={() => void open(o)} style={{ opacity: opening === o.id ? 0.7 : 1 }}>
                  <div className={`lead${o.downloaded ? ' ink' : ''}`}>{opening === o.id ? <Loader2 className="spin" /> : <FileText />}</div>
                  <div className="main-c">
                    <b className="mono">{o.caseNumber}</b>
                    <div className="sub">
                      {[PUBLIC_INSTANCE_LABEL[o.instance] || o.instance, o.court, o.judge].filter(Boolean).join(' · ') || '-'}
                      {o.category ? ` · ${o.category}` : ''}
                    </div>
                  </div>
                  {o.result ? <span className="badge b-neu">{PUBLIC_RESULT_LABEL[o.result] || o.result}</span> : null}
                  {o.downloaded ? (
                    <span className="badge b-pos">
                      <CheckCircle2 style={{ width: 12, height: 12, marginRight: 4, verticalAlign: '-2px' }} />
                      Yuklangan
                    </span>
                  ) : (
                    <span className="badge b-neu">Yuklanmagan</span>
                  )}
                  <div className="amt">
                    {o.downloaded ? size(o.size) : o.pdfSize ? size(o.pdfSize) : '-'}
                    <small>{o.downloaded ? dmy(o.savedAt) : ''}</small>
                  </div>
                  <span className="chev">›</span>
                </div>
              ))}
            </div>
            <ListPagination page={safePage} pageSize={pageSize} total={total} hideWhenSinglePage={false} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />
          </>
        )}

        {manual && (
          <div style={{ marginTop: 12 }}>
            <p className="faint" style={{ fontSize: 12.5, margin: '0 0 6px' }}>
              Qaror: <b className="mono">{manual.caseNumber}</b>
            </p>
            <OrderHandover importing={importing} busy={opening === manual.id} onFile={(f) => void importFile(f)} onRetry={() => void open(manual, true)} />
          </div>
        )}
      </div>
    </div>
  )
}
