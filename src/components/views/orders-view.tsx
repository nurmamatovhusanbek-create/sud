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

import { CopyText } from '@/components/ui-custom/copy-text'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Download, FileText, Loader2, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyBlock, Seg, SkRows } from '@/components/proto/primitives'
import { HarHowTo, HarPicker, OrderHandover } from '@/components/proto/order-handover'
import { ListPagination, clampPage } from '@/components/ui-custom/list-pagination'
import { downloadPublicOrderPdf, getPublicOrdersLibrary, importPublicOrderPdf, importPublicOrdersHar, setOrdersHidden, ManualOrderError, openPublicOrderPdf, type LibraryPage } from '@/lib/api-client'
import { ORDERS_FILE_GAP_SECONDS_DEFAULT, PUBLIC_INSTANCE_LABEL, PUBLIC_RESULT_LABEL, type LibraryItem, type LibraryStatus } from '@/core/public-orders'

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
  const [sel, setSel] = useState<Map<string, LibraryItem>>(new Map()) // orders ticked in «Yuklanmagan» / «Mavjud emas» (by file id)
  const first = useRef(true)

  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null)
  const stopRef = useRef(false) // «Toʻxtatish»: the running bulk download stops after the order in flight

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

  // a selection belongs to the view it was made in
  useEffect(() => setSel(new Map()), [status, q, court, instance])

  // a page that no longer exists (the list got shorter) falls back to the last one
  const total = data?.total ?? 0
  const safePage = clampPage(page, total, pageSize)
  useEffect(() => {
    if (data && safePage !== page) setPage(safePage)
  }, [data, safePage, page])

  // ---- opening / downloading ---------------------------------------------------------------------------------------
  const open = async (o: LibraryItem, retryAuto = false) => {
    if (!o.pdfId) {
      toast.error('Bu yozuvda fayl yoʻq')
      return
    }
    setBusy(o.id)
    try {
      const r = await openPublicOrderPdf(o.pdfId, o.pdfName, { retryAuto })
      setManual(null)
      if (!r.saved) toast.error(`PDF ochildi, lekin kompyuterga saqlanmadi${r.saveError ? `: ${r.saveError}` : ''}. Shuning uchun u “Yuklangan” boʻlmaydi`, { duration: 15000 })
      else if (o.state === 'gone') toast.success('Qaror qayta yuklab olindi') // its file had been deleted: the stored order data fetched it again
      setTick((n) => n + 1) // it is on disk now: the badge, the lists and the counts change
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

  /** A HAR saved from the browser: every order PDF in it is stored, matched by the id in its own file request. */
  const importHar = async (file: File | undefined) => {
    if (!file) return
    setImporting(true)
    const r = await importPublicOrdersHar(file)
    setImporting(false)
    if (!r.ok) {
      toast.error(r.error, { duration: 12000 })
      return
    }
    const n = r.data.saved.length
    const had = r.data.skipped
    const lost = n - r.data.matched.length
    const back = r.data.restored
    if (n === 0) {
      // no new file: a log of search pages only, or an overlapping export where every file was already here
      const parts = [r.data.orders ? `${r.data.orders} ta yangi yozuv roʻyxatga qoʻshildi` : '', back ? `${back} ta qaror «Tozalangan» dan qaytdi` : '', had ? `${had} ta fayl allaqachon bor` : ''].filter(Boolean)
      toast.success(r.data.orders || back ? 'Qarorlar roʻyxatga qoʻshildi' : 'Yangi qaror yoʻq', { description: parts.length ? `${parts.join(', ')}.` : 'Hech narsa oʻzgarmadi.', duration: 8000 })
      setTick((t) => t + 1)
      return
    }
    toast.success(n === 1 ? 'Qaror saqlandi' : `${n} ta qaror saqlandi`, {
      description: lost
        ? `${lost} tasi roʻyxatda koʻrinmaydi: HAR faylda uning ish raqami yoʻq. Network ochiq turib sahifani yangilang (F5), qarorni qidirib oching va HAR ni qayta saqlang.`
        : `${r.data.orders} ta yozuv roʻyxatga qoʻshildi${had ? `, ${had} ta fayl allaqachon bor edi` : ''}${back ? `, ${back} ta qaror «Tozalangan» dan qaytdi` : ''}.`,
      duration: lost ? 20000 : 6000,
    })
    if (manual && r.data.saved.some((x) => x.id === manual.pdfId)) setManual(null)
    setTick((t) => t + 1) // the lists and counts re-read what is on disk now
  }

  // ---- «Tozalash»: clear orders from the lists (their records stay; a search still finds them) -----------------------
  const hide = async (ids: string[]) => {
    if (!ids.length) return
    const r = await setOrdersHidden('hide', ids)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    setSel(new Map())
    setTick((t) => t + 1)
    toast.success(`${r.data.changed} ta qaror tozalandi`, {
      description: 'Roʻyxatdan va sonlardan chiqdi. Yozuvi (va yuklangan PDF fayli) saqlandi: «Tozalangan» boʻlimidan yoki ish raqami bilan qidirib bir bosishda ochasiz.',
      action: { label: 'Qaytarish', onClick: () => void restore(ids) },
      duration: 12000,
    })
  }
  const restore = async (ids: string[]) => {
    const r = await setOrdersHidden('restore', ids)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    setTick((t) => t + 1)
    toast.success(`${r.data.changed} ta qaror qaytarildi`)
  }
  /** everything in this view that is NOT ticked, across all pages */
  const clearTheRest = async (state: 'never' | 'gone' | 'saved') => {
    let all: LibraryItem[]
    try {
      all = await collect(state)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Roʻyxatni olib boʻlmadi')
      return
    }
    const rest = all.filter((o) => !sel.has(o.pdfId.toLowerCase()))
    if (!rest.length) {
      toast.info('Tozalanadigan qaror yoʻq')
      return
    }
    if (!window.confirm(`${sel.size} ta tanlangan qaror qoladi, qolgan ${rest.length} tasi roʻyxatdan olib tashlanadi (yozuvlari va PDF fayllari saqlanadi, ish raqami bilan qidirsangiz topiladi). Davom etamizmi?`)) return
    await hide(rest.map((o) => o.pdfId))
  }
  const toggle = (o: LibraryItem) =>
    setSel((m) => {
      const n = new Map(m)
      const k = o.pdfId.toLowerCase()
      if (n.has(k)) n.delete(k)
      else n.set(k, o)
      return n
    })

  const items = data?.items ?? []
  const todo = items.filter((o) => o.state !== 'saved' && o.pdfId)

  /**
   * Save a list of orders one after another (the server spaces the captchas). The list and the counts are re-read after EACH order,
   * so they move while it works. Stops at the first order that needs a person, at the first file the server could not keep (that
   * is systematic: say why instead of failing 80 times), or when «Toʻxtatish» is pressed; any other failure is counted and skipped.
   */
  const runBulk = async (list: LibraryItem[]) => {
    stopRef.current = false
    setBulk({ done: 0, total: list.length })
    let ok = 0
    let failed = 0
    let lastErr = ''
    let notSaved = ''
    let needsPerson: LibraryItem | null = null
    for (const o of list) {
      if (stopRef.current) break
      try {
        const r = await downloadPublicOrderPdf(o.pdfId, o.pdfName)
        if (r.saved) ok++
        else {
          notSaved = r.saveError || 'sababi nomaʼlum'
          break
        }
      } catch (e) {
        if (e instanceof ManualOrderError) {
          needsPerson = o
          break
        }
        failed++
        lastErr = `${o.caseNumber}: ${e instanceof Error ? e.message : 'yuklab boʻlmadi'}`
      } finally {
        setBulk((b) => (b ? { ...b, done: b.done + 1 } : b))
        setTick((n) => n + 1) // the order that just landed leaves «Yuklanmagan» now, not at the end
      }
    }
    setBulk(null)
    setTick((n) => n + 1)
    if (needsPerson) {
      setManual(needsPerson)
      toast.error('public.sud.uz bu qarorni qoʻlda yuklashni talab qildi — pastdagi yoʻriqnomaga qarang')
    }
    if (notSaved) toast.error(`PDF olindi, lekin kompyuterga saqlanmadi: ${notSaved}. Yuklash toʻxtatildi.`, { duration: 20000 })
    else if (failed) toast.error(`${failed} ta qaror yuklanmadi (${lastErr})`, { duration: 12000 })
    if (ok) toast.success(`${ok} ta qaror yuklab olindi${stopRef.current ? ' (toʻxtatildi)' : ''}`)
    else if (stopRef.current) toast.info('Yuklash toʻxtatildi')
  }

  /** Every order in `state` that matches the current filters, across ALL pages (not only the one on screen). */
  const collect = async (state: 'never' | 'gone' | 'saved'): Promise<LibraryItem[]> => {
    const all: LibraryItem[] = []
    for (let pg = 1; pg <= 40; pg++) {
      const r = await getPublicOrdersLibrary({ q: q.trim(), status: state, court, instance, page: pg, size: 100 })
      if (!r.ok) throw new Error(r.error)
      all.push(...r.data.items.filter((i) => i.pdfId))
      if (!r.data.items.length || all.length >= r.data.total) break
    }
    return all
  }

  /** «Barchasini yuklash» in the Yuklanmagan / Mavjud emas view. */
  const downloadView = async (state: 'never' | 'gone') => {
    let list: LibraryItem[]
    try {
      list = await collect(state)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Roʻyxatni olib boʻlmadi')
      return
    }
    if (!list.length) {
      toast.info('Yuklanadigan qaror yoʻq')
      return
    }
    // each one costs a captcha and a few seconds: a long list is a decision, not a click
    if (list.length > 20 && !window.confirm(`${list.length} ta qaror birin-ketin yuklanadi (har biri bir necha soniya, jami taxminan ${Math.ceil((list.length * (ORDERS_FILE_GAP_SECONDS_DEFAULT + 4)) / 60)} daqiqa: sayt bloklamasligi uchun bittasi tugagach ${ORDERS_FILE_GAP_SECONDS_DEFAULT} soniya dam olinib keyingisi boshlanadi). Davom etamizmi?`)) return
    await runBulk(list)
  }

  const downloadAll = () => runBulk(todo) // the search result banner: what is on screen

  const counts = data?.counts
  const statusOptions = useMemo(
    () => [
      { key: 'saved', label: `Yuklangan${counts ? ` · ${counts.saved}` : ''}` },
      { key: 'never', label: `Yuklanmagan${counts ? ` · ${counts.never}` : ''}` },
      // saved once, the file has been deleted since: shown only when there is such an order (it is the exception)
      ...(counts && counts.gone > 0 ? [{ key: 'gone', label: `Mavjud emas · ${counts.gone}` }] : status === 'gone' ? [{ key: 'gone', label: 'Mavjud emas' }] : []),
      { key: 'all', label: `Hammasi${counts ? ` · ${counts.all}` : ''}` },
      // cleared by the person: shown only when there are some (their records are kept)
      ...(counts && counts.hidden > 0 ? [{ key: 'hidden', label: `Tozalangan · ${counts.hidden}` }] : status === 'hidden' ? [{ key: 'hidden', label: 'Tozalangan' }] : []),
    ],
    [counts, status],
  )
  // any filter change goes back to page 1
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }
  const filtered = !!(q.trim() || court || instance)

  return (
    <div>
      <div className="hero" style={{ marginBottom: 12 }}>
        <div className="eyebrow">public.sud.uz · mahalliy arxiv</div>
        <h1>
          Qarorlar <span className="g2">arxivi</span>
        </h1>
        <p>
          Eʼlon qilingan sud qarorlari: arxivdan qidiring va qaysilari kompyuteringizga yuklab olinganini koʻring.
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
              placeholder="Arxivdan qidirish: ish raqami (2615) yoki sud, sudya, toifa…"
              aria-label="Arxivdan qidirish"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Seg options={COURT_SEG} value={court} onChange={reset(setCourt)} />
          <div style={{ flex: 1 }} />
          <button className="btn btn-outline btn-sm" onClick={() => setTick((n) => n + 1)} title="Roʻyxatni qayta oʻqish">
            <RefreshCw />
            <span>Yangilash</span>
          </button>
        </div>
        {/* second row: stage and download state, so the refresh button never ends up alone on a line of its own */}
        <div className="filterbar">
          <Seg options={INSTANCE_SEG} value={instance} onChange={reset(setInstance)} />
          <Seg options={statusOptions} value={status} onChange={(k) => reset(setStatus)(k as LibraryStatus)} />
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
            {status === 'hidden' && (
              <div className="dw-orders-empty" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap', margin: '0 0 10px' }}>
                <span>Tozalangan qarorlar: <b>{data?.counts.hidden ?? 0} ta</b>. Yozuvlari saqlangan; kerak boʻlsa yuklab oling yoki roʻyxatga qaytaring.</span>
                <button className="btn btn-outline btn-sm" onClick={() => void restore(items.map((o) => o.pdfId))} title="Shu sahifadagilarni roʻyxatga qaytarish">
                  <RefreshCw />
                  <span>Sahifadagilarni qaytarish</span>
                </button>
              </div>
            )}
            {status === 'saved' && sel.size > 0 && (
              <div className="dw-orders-empty" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap', margin: '0 0 10px' }}>
                <span>Tanlangan: <b>{sel.size} ta</b>. Roʻyxatdan olib tashlansa, yozuvi va PDF fayli saqlanadi; «Tozalangan» boʻlimidan bir bosishda ochiladi.</span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => void hide([...sel.values()].map((o) => o.pdfId))} title="Tanlanganlarni roʻyxatdan olib tashlash (yozuvi va PDF fayli saqlanadi)">
                    <Trash2 />
                    <span>Tanlanganlarni oʻchirish</span>
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => void clearTheRest('saved')} title="Tanlanmaganlarning hammasini (barcha sahifalardan) roʻyxatdan olib tashlash">
                    <Trash2 />
                    <span>Qolganlarini oʻchirish</span>
                  </button>
                </span>
              </div>
            )}
            {(status === 'never' || status === 'gone') && counts && (status === 'never' ? counts.never : counts.gone) > 0 && (
              <div className="dw-orders-empty" style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', flexWrap: 'wrap', margin: '0 0 10px' }}>
                <span>
                  {status === 'never' ? 'Yuklanmagan' : 'Fayli oʻchirilgan'} qarorlar: <b>{status === 'never' ? counts.never : counts.gone} ta</b>
                  {filtered ? ' (filtr boʻyicha)' : ''}
                  {bulk ? ` · yuklanmoqda ${bulk.done}/${bulk.total}` : ''}
                </span>
                <span style={{ display: 'flex', gap: 8 }}>
                  {bulk && (
                    <button className="btn btn-outline btn-sm" onClick={() => { stopRef.current = true }} title="Hozirgi qarordan keyin toʻxtaydi">
                      <X />
                      <span>Toʻxtatish</span>
                    </button>
                  )}
                  {sel.size > 0 && !bulk && (
                    <>
                      <button className="btn btn-outline btn-sm" onClick={() => void runBulk([...sel.values()])} title="Faqat tanlangan qarorlarni birin-ketin yuklab olish">
                        <Download />
                        <span>Tanlanganlarni yuklash ({sel.size})</span>
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => void hide([...sel.values()].map((o) => o.pdfId))} title="Tanlanganlarni roʻyxatdan tozalash (yozuvlari saqlanadi)">
                        <X />
                        <span>Tanlanganlarni tozalash</span>
                      </button>
                      <button className="btn btn-outline btn-sm" onClick={() => void clearTheRest(status)} title="Tanlanmaganlarning hammasini (barcha sahifalardan) tozalash">
                        <X />
                        <span>Qolganlarini tozalash</span>
                      </button>
                    </>
                  )}
                  <button className="btn btn-primary btn-sm" disabled={!!bulk} onClick={() => void downloadView(status)} title="Roʻyxatdagi barcha qarorlarni (hamma sahifalardan) birin-ketin yuklab olish">
                    {bulk ? <Loader2 className="spin" /> : <Download />}
                    <span>{bulk ? `Yuklanmoqda ${bulk.done}/${bulk.total}…` : status === 'never' ? `Barchasini yuklash (${counts.never})` : `Barchasini qayta yuklash (${counts.gone})`}</span>
                  </button>
                </span>
              </div>
            )}
            <ListPagination top page={safePage} pageSize={pageSize} total={total} hideWhenSinglePage={false} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }} />
            <div className="list">
              {items.map((o) => (
                <div className="lrow" key={o.id} data-order={o.caseNumber} style={{ cursor: 'default' }}>
                  <div className={`lead${o.state === 'saved' ? ' ink' : ''}`}>
                    {(status === 'never' || status === 'gone' ? o.state !== 'saved' : status === 'saved') && o.pdfId ? (
                      <input
                        type="checkbox"
                        checked={sel.has(o.pdfId.toLowerCase())}
                        disabled={!!bulk}
                        onChange={() => toggle(o)}
                        aria-label={`${o.caseNumber} ni tanlash`}
                        style={{ width: 16, height: 16, cursor: 'pointer' }}
                      />
                    ) : (
                      <FileText />
                    )}
                  </div>
                  <div className="main-c">
                    <CopyText text={o.caseNumber} />
                    <div className="sub">
                      {[PUBLIC_INSTANCE_LABEL[o.instance] || o.instance, o.court, o.judge].filter(Boolean).join(' · ') || '-'}
                      {o.category ? ` · ${o.category}` : ''}
                    </div>
                  </div>
                  {o.result ? <span className="badge b-neu">{PUBLIC_RESULT_LABEL[o.result] || o.result}</span> : null}
                  {o.state === 'saved' && o.hidden ? <span className="badge b-neu" title="Roʻyxatdan olib tashlangan; yozuvi va PDF fayli saqlangan">Tozalangan</span> : null}
                  {o.state === 'saved' ? (
                    <span className="badge b-pos">
                      <CheckCircle2 style={{ width: 12, height: 12, marginRight: 4, verticalAlign: '-2px' }} />
                      Yuklangan
                    </span>
                  ) : o.state === 'gone' ? (
                    <span className="badge b-warn" title={`${dmy(o.savedAt)} da yuklangan, keyin fayl oʻchirilgan. “Qayta yuklash” ni bossangiz qaytadan yuklab olinadi.`}>
                      Mavjud emas
                    </span>
                  ) : o.hidden ? (
                    <span className="badge b-neu" title="Roʻyxatdan tozalangan; yozuvi saqlangan">Tozalangan</span>
                  ) : (
                    <span className="badge b-neu">Yuklanmagan</span>
                  )}
                  <div className="amt">
                    {o.state !== 'never' ? size(o.size) : o.pdfSize ? size(o.pdfSize) : '-'}
                    <small>{o.state === 'saved' ? dmy(o.savedAt) : o.state === 'gone' ? `${dmy(o.savedAt)} · oʻchirilgan` : ''}</small>
                  </div>
                  {o.state === 'saved' && !o.hidden && o.pdfId && (
                    <button className="btn btn-outline btn-sm" disabled={!!bulk} onClick={() => void hide([o.pdfId])} title="Roʻyxatdan olib tashlash (yozuvi va PDF fayli saqlanadi; «Tozalangan» boʻlimidan ochiladi)" aria-label={`${o.caseNumber} ni roʻyxatdan oʻchirish`}>
                      <Trash2 />
                      <span>Oʻchirish</span>
                    </button>
                  )}
                  {o.hidden && (
                    <button className="btn btn-outline btn-sm" disabled={!!bulk} onClick={() => void restore([o.pdfId])} title="Roʻyxatga qaytarish">
                      <RefreshCw />
                      <span>Qaytarish</span>
                    </button>
                  )}
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
          </>
        )}

        {/* the site shows some orders only in a pop-up (no download button): a HAR saved from the browser carries the file */}
        <div className="dw-orders-empty" style={{ marginTop: 12, display: 'grid', gap: 6 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <HarPicker importing={importing} onHar={(f) => void importHar(f)} />
            <span className="faint" style={{ fontSize: 12.5 }}>Brauzerdan saqlangan HAR fayl: qarorni oʻzi topadi.</span>
          </span>
          <HarHowTo />
        </div>

        {manual && (
          <div style={{ marginTop: 12 }}>
            <p className="faint" style={{ fontSize: 12.5, margin: '0 0 6px' }}>
              Qaror: <b className="mono">{manual.caseNumber}</b>
            </p>
            <OrderHandover importing={importing} busy={busy === manual.id} onFile={(f) => void importFile(f)} onHar={(f) => void importHar(f)} onRetry={() => void open(manual, true)} />
          </div>
        )}
      </div>
    </div>
  )
}
