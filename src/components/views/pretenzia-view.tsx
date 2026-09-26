'use client'

/**
 * Претензия (Talabnoma) generator — upload an «Акт сверки» xlsx, pick the
 * debtor contracts, and generate a demand letter for each.
 *
 * The spreadsheet is parsed entirely in the browser (lib/pretenzia/parse), so
 * the financial statement never leaves the machine; only the derived figures
 * are posted to /api/pretenzia/generate, which fills the .docx template.
 *
 * Constants (parties, court, signatories) are editable — inputs start blank
 * with the usual sample values as ghost placeholders; a blank field falls back
 * to its sample default at generate time.
 */

import { useMemo, useRef, useState } from 'react'
import { FileUp, FileDown, Loader2, X, AlertTriangle, ArrowLeft, ShieldCheck, CalendarDays } from 'lucide-react'
import { toast } from 'sonner'
import { parseSverka, type SverkaParseResult } from '@/lib/pretenzia/parse'
import { computeClaim, addBankingDays, formatSum, formatDate } from '@/core/pretenzia'
import { generatePretenzia } from '@/lib/api-client'
import { LetterheadRow } from '@/components/proto/letterhead'

type Lang = 'ru' | 'uz'

/** Sample-value defaults (ghost placeholders + blank fallback), per language. */
const DEFAULTS: Record<Lang, Record<string, string>> = {
  ru: {
    creditorName: 'ARTIKUL AZIYA KABEL',
    debtorName: 'HUDUDIY ELEKTR TARMOQLARI',
    debtorAddress: 'Юнусабадский район ул. Осиё 8-дом',
    courtName: 'Ташкентский межрайонный экономический суд',
    director: 'Тургунов Ш.А.',
    executor: 'Нурмаматов Ҳ.',
    executorPhone: '+998 91 773 22 72',
  },
  uz: {
    creditorName: 'ARTIKUL AZIYA KABEL',
    debtorName: 'HUDUDIY ELEKTR TARMOQLARI',
    debtorAddress: 'Toshkent sh., Yunusobod tumani, Osiyo koʻchasi, 8-uy',
    courtName: 'Toshkent tumanlararo iqtisodiy sudi',
    director: 'Turgunov Sh.A.',
    executor: 'Nurmamatov H.',
    executorPhone: '+998 91 773 22 72',
  },
}

const CONST_FIELDS: { key: string; label: string }[] = [
  { key: 'creditorName', label: 'Kreditor (bizning korxona)' },
  { key: 'debtorName', label: 'Qarzdor korxona' },
  { key: 'debtorAddress', label: 'Qarzdor manzili' },
  { key: 'courtName', label: 'Sud nomi' },
  { key: 'director', label: 'Direktor' },
  { key: 'executor', label: 'Ijrochi' },
  { key: 'executorPhone', label: 'Ijrochi tel.' },
]

const GRACE_DAYS = 5 // banking days after the contract date → delay start

const pad = (n: number) => String(n).padStart(2, '0')
const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
function fromInput(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

interface Row {
  sel: boolean
  delayStart: string // yyyy-mm-dd
}

export function PretenziyaFlow({ onBack, letterhead, onLetterhead }: {
  onBack: () => void
  letterhead: string
  onLetterhead: (v: string) => void
}) {
  const [parsing, setParsing] = useState(false)
  const [err, setErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [result, setResult] = useState<SverkaParseResult | null>(null)
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [claimDate, setClaimDate] = useState(toInput(new Date()))
  const [consts, setConsts] = useState<Record<string, string>>({})
  const [lang, setLang] = useState<Lang>('ru')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const claim = useMemo(() => fromInput(claimDate), [claimDate])

  const loadFile = async (f: File) => {
    setParsing(true)
    setErr('')
    try {
      const buf = await f.arrayBuffer()
      const r = await parseSverka(buf)
      if (r.contracts.length === 0) {
        setResult(null)
        setErr('Bu faylda qarzdor shartnoma topilmadi (yopiq saldo boʻlgan shartnomalar).')
        return
      }
      const next: Record<string, Row> = {}
      for (const c of r.contracts) next[c.no] = { sel: true, delayStart: toInput(addBankingDays(c.date, GRACE_DAYS)) }
      setRows(next)
      setResult(r)
      setClaimDate(toInput(r.periodEnd ?? new Date()))
    } catch {
      setResult(null)
      setErr('Faylni oʻqib boʻlmadi — bu «Акт сверки» (xlsx) ekaniga ishonch hosil qiling.')
    } finally {
      setParsing(false)
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (parsing) return
    const f = e.dataTransfer.files?.[0]
    if (!f) return
    if (!/\.xlsx$/i.test(f.name)) { setErr('Faqat .xlsx fayl qabul qilinadi.'); return }
    void loadFile(f)
  }

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void loadFile(f)
    e.target.value = ''
  }

  const reset = () => {
    setResult(null)
    setRows({})
    setErr('')
    setConsts({})
  }

  const selectedCount = result ? result.contracts.filter((c) => rows[c.no]?.sel).length : 0

  const resolvedConstants = (): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const { key } of CONST_FIELDS) out[key] = (consts[key]?.trim() || DEFAULTS[lang][key])
    return out
  }

  const generate = async () => {
    if (!result) return
    const selected = result.contracts.filter((c) => rows[c.no]?.sel)
    if (selected.length === 0) {
      toast.error('Kamida bitta shartnomani tanlang')
      return
    }
    setBusy(true)
    try {
      await generatePretenzia({
        claimDate: claim.toISOString(),
        lang,
        letterhead: letterhead || undefined,
        blankLetterhead: !letterhead,
        constants: resolvedConstants(),
        contracts: selected.map((c) => ({
          no: c.no,
          date: c.date.toISOString(),
          mainDebtTiyin: c.mainDebtTiyin,
          paymentTiyin: c.paymentTiyin,
          delayStart: fromInput(rows[c.no].delayStart).toISOString(),
        })),
      })
      toast.success(
        selected.length > 1
          ? `${selected.length} ta talabnoma (ZIP) yuklab olindi`
          : 'Talabnoma yuklab olindi',
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Hujjatni yaratib boʻlmadi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="hero" style={{ marginBottom: 18 }}>
        <div className="eyebrow">Hujjat generatori</div>
        <h1>Talabnoma (akt-sverka asosida)</h1>
        <p>«Акт сверки» faylini yuklang — dastur qarzdor shartnomalarni aniqlaydi, asosiy qarz va penyani hisoblab, har biri uchun talabnoma (pretenziya) tayyorlaydi. Hujjat tilini tanlashingiz mumkin.</p>
      </div>

      <div className="doc-crumb">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft />Barcha toifalar</button>
      </div>

      {!result ? (
        <>
          <label
            className={`pz-drop${parsing ? ' busy' : ''}${dragOver ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); if (!parsing) setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <input ref={inputRef} type="file" accept=".xlsx" onChange={onPick} hidden disabled={parsing} />
            <div className="pz-drop-ico">{parsing ? <Loader2 className="spin" /> : <FileUp />}</div>
            <b>{parsing ? 'Oʻqilmoqda…' : dragOver ? 'Faylni shu yerga tashlang' : 'Akt sverka (.xlsx) faylini tanlang yoki shu yerga tashlang'}</b>
            <span className="faint">Fayl brauzeringizda oʻqiladi — hech qayerga yuborilmaydi.</span>
          </label>
          {err && (
            <div className="pz-alert"><AlertTriangle />{err}</div>
          )}
          <div className="pz-note faint">
            <ShieldCheck style={{ width: 14, height: 14 }} />
            Faqat yakuniy raqamlar (qarz, penya) hujjat yaratish uchun serverga yuboriladi.
          </div>
        </>
      ) : (
        <>
          <div className="pz-summary">
            <div>
              <span className="lbl">Kreditor</span><b>{result.creditorName || DEFAULTS[lang].creditorName}</b>
            </div>
            <div>
              <span className="lbl">Qarzdor</span><b>{result.debtorName || DEFAULTS[lang].debtorName}</b>
            </div>
            <div>
              <span className="lbl">Qarzdor shartnomalar</span>
              <b>{result.contracts.length} <span className="faint" style={{ fontWeight: 400 }}>/ {result.totalBlocks} shartnoma</span></b>
            </div>
            <div className="pz-summary-date">
              <span className="lbl"><CalendarDays style={{ width: 13, height: 13 }} /> Talabnoma sanasi</span>
              <input type="date" className="dinput" value={claimDate} onChange={(e) => setClaimDate(e.target.value)} />
            </div>
            <button className="btn btn-ghost btn-sm" onClick={reset}><X />Boshqa fayl</button>
          </div>

          <div className="pz-table">
            <div className="pz-th">
              <span className="pz-c-sel" />
              <span>Shartnoma</span>
              <span className="pz-c-num">Asosiy qarz</span>
              <span className="pz-c-date">Prosrochka (dan)</span>
              <span className="pz-c-num">Penya</span>
            </div>
            {result.contracts.map((c) => {
              const row = rows[c.no]
              if (!row) return null
              const start = fromInput(row.delayStart)
              const r = computeClaim({
                mainDebtTiyin: c.mainDebtTiyin,
                paymentTiyin: c.paymentTiyin,
                delayStart: start,
                claimDate: claim,
              })
              const toggle = () => setRows((s) => ({ ...s, [c.no]: { ...s[c.no], sel: !s[c.no].sel } }))
              const setStart = (v: string) => setRows((s) => ({ ...s, [c.no]: { ...s[c.no], delayStart: v } }))
              return (
                <div className={`pz-tr${row.sel ? ' on' : ''}`} key={c.no}>
                  <span className="pz-c-sel">
                    <input type="checkbox" checked={row.sel} onChange={toggle} aria-label={`${c.no} tanlash`} />
                  </span>
                  <span className="pz-c-name">
                    <b className="mono">{c.no}</b>
                    <span className="faint">{formatDate(c.date)}{c.paymentTiyin > 0 ? ' · qisman toʻlangan' : ' · toʻlanmagan'}</span>
                  </span>
                  <span className="pz-c-num mono">{formatSum(c.mainDebtTiyin)}</span>
                  <span className="pz-c-date">
                    <input type="date" className="dinput" value={row.delayStart} onChange={(e) => setStart(e.target.value)} />
                    <span className="faint">{r.days} kun</span>
                  </span>
                  <span className="pz-c-num mono">
                    {formatSum(r.penaltyTiyin)}
                    {r.penaltyCapped && <span className="pz-cap" title="50% chegara qoʻllandi">50%</span>}
                  </span>
                </div>
              )
            })}
          </div>

          <details className="pz-consts">
            <summary>Hujjat rekvizitlari (blanka, kreditor, sud, imzo) — oʻzgartirish ixtiyoriy</summary>
            <div style={{ padding: '4px 0 14px' }}>
              <LetterheadRow value={letterhead} onChange={onLetterhead} />
            </div>
            <div className="pz-const-grid">
              {CONST_FIELDS.map(({ key, label }) => (
                <label className="doc-field" key={key}>
                  <span className="doc-field-label">{label}</span>
                  <input
                    className="dinput"
                    value={consts[key] ?? ''}
                    placeholder={DEFAULTS[lang][key]}
                    onChange={(e) => setConsts((s) => ({ ...s, [key]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <p className="faint" style={{ fontSize: 12, margin: '2px 2px 0' }}>
              Boʻsh qoldirilgan maydonlar uchun namunadagi qiymat ishlatiladi.
            </p>
          </details>

          <div className="pz-actions">
            <div className="pz-lang" role="group" aria-label="Hujjat tili">
              <span className="faint">Til:</span>
              <button className={`pz-lang-btn${lang === 'ru' ? ' on' : ''}`} onClick={() => setLang('ru')}>Ruscha</button>
              <button className={`pz-lang-btn${lang === 'uz' ? ' on' : ''}`} onClick={() => setLang('uz')}>Oʻzbekcha</button>
            </div>
            <button className="btn btn-primary" onClick={() => void generate()} disabled={busy || selectedCount === 0}>
              {busy ? <Loader2 className="spin" /> : <FileDown />}
              {selectedCount > 1 ? `${selectedCount} ta talabnoma yaratish (ZIP)` : 'Talabnoma yaratish'}
            </button>
            <span className="faint">{selectedCount} / {result.contracts.length} tanlandi</span>
          </div>
        </>
      )}
    </div>
  )
}
