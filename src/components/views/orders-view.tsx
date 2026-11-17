'use client'

/**
 * Qarorlar — the page for the published court orders (sidebar, below Statistika). Two parts:
 *
 *  1. «Yangi qaror qidirish»: type a case number, search public.sud.uz for its published orders (both back ends, criminal
 *     included) and save the PDFs on this computer: one by one, or «Hammasini yuklab olish».
 *  2. The archive: the stored orders in a list built like Sud ishlari (search, court type, instance, download state, shared
 *     pager), filtered and paged on the SERVER (`GET /api/public-orders/library`). Every row has an explicit button: «Ochish»
 *     (the PDF is on this computer), «Yuklab olish» (never downloaded) or «Qayta yuklash» (saved once, the file has since
 *     been deleted: «Mavjud emas»; the download log remembers its size and date).
 *
 * When public.sud.uz wants a person to pass its captcha, the row shows the same hand-over as the case drawer.
 * Settings › Qarorlar keeps only the queue / cache control panel.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Download, FileText, Loader2, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyBlock, Seg, SkRows } from '@/components/proto/primitives'
import { OrderHandover } from '@/components/proto/order-handover'
import { ListPagination, clampPage } from '@/components/ui-custom/list-pagination'
import { downloadPublicOrderPdf, fetchPublicOrders, getPublicOrdersLibrary, importPublicOrderPdf, ManualOrderError, openPublicOrderPdf, type LibraryPage } from '@/lib/api-client'
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

const CASE_RE = /^\d+-[\d-]+\/\d+$/
const p2 = (n: number) => String(n).padStart(2, '0')
const dmy = (t: number): string => {
  const d = new Date(t)
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`
}
const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

export function OrdersView() {
  // ---- the archive -------------------------------------------------------------------------------------------------
  const [q, setQ] = useState('')
  const [court, setCourt] = useState('')
  const [instance, setInstance] = useState('')
  const [status, setStatus] = useState<LibraryStatus>('saved')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [data, setData] = useState<LibraryPage | null>(null)
  const [failed, setFailed] = useState(false)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<string | null>(null) // the row being opened / downloaded
  const [manual, setManual] = useState<LibraryItem | null>(null)
  const [importing, setImporting] = useState(false)
  const first = useRef(true)

  // ---- «Yangi qaror qidirish» --------------------------------------------------------------------------------------
  const [newNumber, setNewNumber] = useState('')
  const [newCourt, setNewCourt] = useState<PublicCourtType | ''>('')
  const [looking, setLooking] = useState(false)
  const [searched, setSearched] = useState<string | null>(null) // the case number whose search just finished
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)
  const { job } = useOrdersJob()
  const newNorm = normalizeCaseNumber(newNumber)
  const newValid = CASE_RE.test(newNorm)
  const newCourtShown = newCourt || courtTypeOfCase(newNorm) || 'ECONOMIC'

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

  // while the searched case is being looked up, re-read every 3 s; when it ends show what was found
  const running = job?.state === 'running'
  useEffect(() => {
    if (!looking) return
    if (!running) {
      const t = setTimeout(() => {
        setLooking(false)
        setSearched(newNorm)
        // show exactly what the search found: that case, every state
        setQ(newNorm)
        setCourt('')
        setInstance('')
        setStatus('all')
        setPage(1)
        setTick((n) => n + 1)
      }, 1500) // the queue may not have picked the case up yet: give it a moment before calling it finished
      return () => clearTimeout(t)
    }
    const t = setInterval(() => setTick((n) => n + 1), 3000)
    return () => clearInterval(t)
  }, [looking, running, newNorm])

  const search = async () => {
    setSearched(null)
    setLooking(true)
    const r = await fetchPublicOrders([{ caseNumber: newNorm, courtType: newCourtShown }], { force: true })
    if (!r.ok) {
      setLooking(false)
      toast.error(r.error)
      return
    }
    toast.success('Qidirilmoqda — public.sud.uz dan olinmoqda (orqa fonda)')
  }

  // ---- opening / downloading ---------------------------------------------------------------------------------------
  const open = async (o: LibraryItem, retryAuto = false) => {
    if (!o.pdfId) {
      toast.error('Bu yozuvda fayl yoʻq')
      return
    }
    setBusy(o.id)
    try {
      await openPublicOrderPdf(o.pdfId, o.pdfName, { retryAuto })
      setManual(null)
      if (o.state === 'gone') toast.success('Qaror qayta yuklab olindi') // its file had been deleted: the stored order data fetched it again
      setTick((n) => n + 1) // it is on disk now: the badge changes
    } catch (e) {
      if (e instanceof ManualOrderError) setManual(o)
      else toast.error(e instanceof Error ? e.message : 'Qarorni ochib boʻlmadi')
    } finally {
      setBusy(null)
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

  const items = data?.items ?? []
  const todo = items.filter((o) => o.state !== 'saved' && o.pdfId)

  /** Save every not-yet-downloaded order on this page, one after another (the server spaces the captchas); stops at the first one that needs a person. */
  const downloadAll = async () => {
    const list = todo
    setBulk({ done: 0, total: list.length })
    let ok = 0
    for (const o of list) {
      try {
        await downloadPublicOrderPdf(o.pdfId, o.pdfName)
        ok++
      } catch (e) {
        if (e instanceof ManualOrderError) {
          setManual(o)
          toast.error('public.sud.uz bu qarorni qoʻlda yuklashni talab qildi — pastdagi yoʻriqnomaga qarang')
        } else toast.error(`${o.caseNumber}: ${e instanceof Error ? e.message : 'yuklab boʻlmadi'}`)
        break
      } finally {
        setBulk((b) => (b ? { ...b, done: b.done + 1 } : b))
      }
    }
    setBulk(null)
    setTick((n) => n + 1)
    if (ok) toast.success(`${ok} ta qaror yuklab olindi`)
  }

  const counts = data?.counts
  const statusOptions = useMemo(
    () => [
      { key: 'saved', label: `Yuklangan${counts ? ` · ${counts.saved}` : ''}` },
      { key: 'never', label: `Yuklanmagan${counts ? ` · ${counts.never}` : ''}` },
      // saved once, the file has been deleted since: shown only when there is such an order (it is the exception)
      ...(counts && counts.gone > 0 ? [{ key: 'gone', label: `Mavjud emas · ${counts.gone}` }] : status === 'gone' ? [{ key: 'gone', label: 'Mavjud emas' }] : []),
      { key: 'all', label: `Hammasi${counts ? ` · ${counts.all}` : ''}` },
    ],
    [counts, status],
  )
  // any filter change goes back to page 1
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }
  const filtered = !!(q.trim() || court || instance)
  // the banner under the search: only while the list shows that very case
  const showResult = searched !== null && normalizeCaseNumber(q) === searched && !!data

  return (
    <div>
      <div className="hero" style={{ marginBottom: 12 }}>
        <div className="eyebrow">public.sud.uz · mahalliy arxiv</div>
        <h1>
          Qarorlar <span className="g2">arxivi</span>
        </h1>
        <p>
          Eʼlon qilingan sud qarorlari: yangi ish raqamini qidirib yuklab oling, arxivdan qidiring va qaysilari kompyuteringizga yuklab olinganini koʻring.
          {data ? ` Yuklangan PDF: ${data.savedPdfs} ta · roʻyxatdagi qarorlar: ${data.stored} ta.` : ''}
        </p>
      </div>

      <div className="p-card rise-c" style={{ marginBottom: 14 }}>
        <div className="card-h">
          <div className="ico"><Download /></div>
          <h2>Yangi qaror qidirish va yuklab olish</h2>
        </div>
        <div className="filterbar" style={{ marginBottom: 0 }}>
          <div className="f-search" style={{ flex: '1 1 300px', minWidth: 240 }}>
            <Search />
            <input
              value={newNumber}
              onChange={(e) => setNewNumber(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newValid && !looking) void search()
              }}
              placeholder="Ish raqami: 4-1001-2615/40333"
              aria-label="Yangi qaror uchun ish raqami"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <select
            value={newCourtShown}
            onChange={(e) => setNewCourt(e.target.value as PublicCourtType)}
            aria-label="Sud turi"
            style={{ height: 40, borderRadius: 'var(--radius-sm)', border: '1px solid var(--line)', background: 'var(--surface-inset)', color: 'var(--text-1)', padding: '0 10px', fontSize: 13 }}
          >
            <option value="ECONOMIC">Iqtisodiy</option>
            <option value="CIVIL">Fuqarolik</option>
            <option value="ADMINISTRATIVE">Maʼmuriy</option>
            <option value="CRIMINAL">Jinoyat</option>
          </select>
          <button className="btn btn-primary" disabled={!newValid || looking} onClick={() => void search()} title="Bu ish raqamini public.sud.uz dan qidirib, topilgan qarorlarni arxivga qoʻshadi">
            {looking ? <Loader2 className="spin" /> : <Search />}
            <span>{looking ? 'Qidirilmoqda…' : 'Qidirish'}</span>
          </button>
        </div>
        <p className="faint" style={{ fontSize: 12, lineHeight: 1.5, margin: '8px 0 0' }}>
          2024 dan oldingi va keyingi qarorlar ikkalasi ham qidiriladi (jinoyat ishlari ham). Topilgan qarorlar quyidagi roʻyxatda chiqadi; PDF ni “Yuklab olish” bilan saqlaysiz.
          {newNumber && !newValid ? ' Ish raqami shu koʻrinishda boʻlsin: 4-1001-2615/40333.' : ''}
        </p>
        {showResult && (
          <div className="dw-orders-empty" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap', marginTop: 10 }}>
            {data!.counts.all === 0 ? (
              <span>
                <b className="mono">{searched}</b> boʻyicha public.sud.uz da eʼlon qilingan qaror topilmadi (ish hali koʻrilayotgan boʻlishi yoki qaror eʼlon qilinmagan boʻlishi mumkin).
              </span>
            ) : (
              <>
                <span>
                  <b className="mono">{searched}</b>: {data!.counts.all} ta qaror topildi{todo.length ? `, ${todo.length} tasi hali yuklanmagan` : ' — hammasi yuklangan'}.
                </span>
                {todo.length > 0 && (
                  <button className="btn btn-primary btn-sm" disabled={!!bulk} onClick={() => void downloadAll()}>
                    {bulk ? <Loader2 className="spin" /> : <Download />}
                    <span>{bulk ? `Yuklanmoqda ${bulk.done}/${bulk.total}…` : `Hammasini yuklab olish (${todo.length})`}</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="p-card rise-c">
        <div className="filterbar">
          <div className="f-search" style={{ flex: '1 1 380px', minWidth: 260 }}>
            <Search />
            <input
              value={q}
              onChange={(e) => reset(setQ)(e.target.value)}
              placeholder="Arxivdan qidirish: ish raqami (2615) yoki sud, sudya, toifa…"
              aria-label="Arxivdan qidirish"
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
                ? status === 'saved' && counts && counts.never + counts.gone > 0
                  ? `Yuklanmagan yoki fayli oʻchirilgan ${counts.never + counts.gone} ta mos qaror bor — “Hammasi” ni tanlang.`
                  : 'Boshqa soʻz yoki filtr bilan urinib koʻring. Yangi ish boʻlsa, yuqoridagi “Qidirish” bilan public.sud.uz dan oling.'
                : 'Yuqorida ish raqamini qidirib, qarorlarni yuklab oling.'
            }
          />
        ) : (
          <>
            <div className="list">
              {items.map((o) => (
                <div className="lrow" key={o.id} data-order={o.caseNumber} style={{ cursor: 'default' }}>
                  <div className={`lead${o.state === 'saved' ? ' ink' : ''}`}>
                    <FileText />
                  </div>
                  <div className="main-c">
                    <b className="mono">{o.caseNumber}</b>
                    <div className="sub">
                      {[PUBLIC_INSTANCE_LABEL[o.instance] || o.instance, o.court, o.judge].filter(Boolean).join(' · ') || '-'}
                      {o.category ? ` · ${o.category}` : ''}
                    </div>
                  </div>
                  {o.result ? <span className="badge b-neu">{PUBLIC_RESULT_LABEL[o.result] || o.result}</span> : null}
                  {o.state === 'saved' ? (
                    <span className="badge b-pos">
                      <CheckCircle2 style={{ width: 12, height: 12, marginRight: 4, verticalAlign: '-2px' }} />
                      Yuklangan
                    </span>
                  ) : o.state === 'gone' ? (
                    <span className="badge b-warn" title={`${dmy(o.savedAt)} da yuklangan, keyin fayl oʻchirilgan. “Qayta yuklash” ni bossangiz qaytadan yuklab olinadi.`}>
                      Mavjud emas
                    </span>
                  ) : (
                    <span className="badge b-neu">Yuklanmagan</span>
                  )}
                  <div className="amt">
                    {o.state !== 'never' ? size(o.size) : o.pdfSize ? size(o.pdfSize) : '-'}
                    <small>{o.state === 'saved' ? dmy(o.savedAt) : o.state === 'gone' ? `${dmy(o.savedAt)} · oʻchirilgan` : ''}</small>
                  </div>
                  <button
                    className={`btn btn-sm ${o.state === 'saved' ? 'btn-primary' : 'btn-outline'}`}
                    disabled={!o.pdfId || busy === o.id || !!bulk}
                    onClick={() => void open(o)}
                    title={o.state === 'saved' ? 'Saqlangan PDF ni ochish' : o.state === 'gone' ? 'Fayl oʻchirilgan: public.sud.uz dan qayta yuklab ochish' : 'public.sud.uz dan yuklab olib ochish'}
                  >
                    {busy === o.id ? <Loader2 className="spin" /> : o.state === 'saved' ? <FileText /> : <Download />}
                    <span>{o.state === 'saved' ? 'Ochish' : o.state === 'gone' ? 'Qayta yuklash' : 'Yuklab olish'}</span>
                  </button>
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
            <OrderHandover importing={importing} busy={busy === manual.id} onFile={(f) => void importFile(f)} onRetry={() => void open(manual, true)} />
          </div>
        )}
      </div>
    </div>
  )
}
