'use client'

/**
 * Settings › Qarorlar › «Qarorlarni qidirish»: find a stored order by its case number (or a part of it) and open the PDF
 * from here. Each row says whether the PDF is already on this computer. Everything is a LOCAL read (the order index and
 * the saved PDFs): typing never reaches public.sud.uz. A row that is not downloaded yet is fetched on click like in the case
 * drawer (and falls back to the same hand-over when the site wants a person).
 */

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, FileText, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { getPublicOrdersLibrary, importPublicOrderPdf, ManualOrderError, openPublicOrderPdf } from '@/lib/api-client'
import { PUBLIC_INSTANCE_LABEL, PUBLIC_RESULT_LABEL, type LibraryItem } from '@/core/public-orders'
import { OrderHandover } from '@/components/proto/order-handover'

type Data = { total: number; items: LibraryItem[]; savedPdfs: number; stored: number }

const p2 = (n: number) => String(n).padStart(2, '0')
const dmy = (t: number): string => {
  const d = new Date(t)
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`
}
const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`)

export function OrdersLibrary() {
  const [q, setQ] = useState('')
  const [savedOnly, setSavedOnly] = useState(true)
  const [data, setData] = useState<Data | null>(null)
  const [failed, setFailed] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [manual, setManual] = useState<LibraryItem | null>(null)
  const [importing, setImporting] = useState(false)
  const [tick, setTick] = useState(0)
  const first = useRef(true)

  // local read; typing is debounced and a newer search cancels the older one
  useEffect(() => {
    const ac = new AbortController()
    const t = setTimeout(() => {
      getPublicOrdersLibrary(q.trim(), savedOnly, ac.signal)
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
  }, [q, savedOnly, tick])

  const open = async (o: LibraryItem, retryAuto = false) => {
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

  const items = data?.items ?? []
  return (
    <div className="p-card rise-c">
      <div className="card-h">
        <div className="ico"><Search /></div>
        <h2>Qarorlarni qidirish</h2>
        <div className="sp" />
        {data && <span className="badge b-neu">{data.savedPdfs} ta PDF yuklangan</span>}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 10px' }}>
        <label className="field" style={{ height: 40, flex: '1 1 260px', minWidth: 220 }}>
          <Search />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ish raqami yoki uning qismi: 4-1001-2615/40333, 2615"
            aria-label="Ish raqami boʻyicha qidirish"
            autoComplete="off"
            spellCheck={false}
            style={{ fontSize: 13 }}
          />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={savedOnly} onChange={(e) => setSavedOnly(e.target.checked)} />
          Faqat yuklanganlar
        </label>
      </div>

      {failed && !data && <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>Qidiruvni bajarib boʻlmadi.</p>}
      {!data && !failed && <p className="faint" style={{ fontSize: 12.5, margin: 0 }}>Yuklanmoqda…</p>}

      {data && !items.length && (
        <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0 }}>
          {q.trim()
            ? savedOnly
              ? `«${q.trim()}» boʻyicha yuklangan qaror yoʻq. “Faqat yuklanganlar” belgisini oʻchirsangiz, hali yuklanmagan (lekin eʼlon qilingan) qarorlar ham koʻrinadi.`
              : `«${q.trim()}» boʻyicha saqlangan qaror topilmadi. Ish kartasida “Tekshirish” bosilganda eʼlon qilingan qarorlar shu yerga qoʻshiladi.`
            : savedOnly
              ? 'Hali birorta qaror PDF si yuklanmagan. Ish kartasidagi “PDF” tugmasini bossangiz, qaror bu yerga saqlanadi.'
              : 'Hali saqlangan qaror yoʻq.'}
        </p>
      )}

      {items.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          {items.map((o) => (
            <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--surface-inset)' }}>
              <div style={{ flex: '1 1 260px', minWidth: 0, display: 'grid', gap: 2 }}>
                <b className="mono" style={{ fontSize: 13 }}>{o.caseNumber}</b>
                <span className="faint" style={{ fontSize: 12.5, overflowWrap: 'anywhere' }}>{[PUBLIC_INSTANCE_LABEL[o.instance] || o.instance, o.court, o.judge].filter(Boolean).join(' · ')}</span>
                {o.category ? <span className="faint" style={{ fontSize: 12 }}>{o.category}</span> : null}
              </div>
              {o.downloaded ? (
                <span className="badge b-pos" title={`Saqlangan: ${dmy(o.savedAt)}`}><CheckCircle2 style={{ width: 12, height: 12, marginRight: 4, verticalAlign: '-2px' }} />Yuklangan · {size(o.size)}</span>
              ) : (
                <span className="badge b-neu">Yuklanmagan</span>
              )}
              <span className="badge b-neu">{PUBLIC_RESULT_LABEL[o.result] || o.result || '–'}</span>
              <button className="btn btn-outline btn-sm" disabled={!o.pdfId || opening === o.id} onClick={() => void open(o)} title={o.downloaded ? 'Saqlangan PDF ni ochish' : 'public.sud.uz dan yuklab ochish'}>
                {opening === o.id ? <Loader2 className="spin" /> : <FileText />}
                <span>PDF</span>
              </button>
            </div>
          ))}
        </div>
      )}
      {data && data.total > items.length && (
        <p className="faint" style={{ fontSize: 12.5, margin: '8px 0 0' }}>
          {data.total} tadan {items.length} tasi koʻrsatilmoqda — aniqroq raqam yozing.
        </p>
      )}
      {manual && (
        <div style={{ marginTop: 10 }}>
          <p className="faint" style={{ fontSize: 12.5, margin: '0 0 6px' }}>Qaror: <b className="mono">{manual.caseNumber}</b></p>
          <OrderHandover importing={importing} busy={opening === manual.id} onFile={(f) => void importFile(f)} onRetry={() => void open(manual, true)} />
        </div>
      )}
    </div>
  )
}
