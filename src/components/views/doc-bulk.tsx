'use client'

/**
 * «Jadvaldan» — one document for MANY rows. Upload a spreadsheet (xlsx / csv): each column is matched to a form field by
 * its header (change any match), each row becomes one document laid over the values already in the form (what is the same
 * for everyone is typed once), and the result is one ZIP. Every row is checked with the same checks as a single form.
 * The file is read here, in the browser; only the finished rows are sent to fill the template.
 */

import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, FileDown, FileSpreadsheet, Loader2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { FIELDS, type DocDef } from '@/lib/documents/registry'
import { MAX_BULK_ROWS, gridToRows, matchColumns, parseCsv, rowsToValues, templateCsv } from '@/lib/documents/bulk'
import { withDerived } from '@/lib/documents/derive'
import { checkDoc } from '@/lib/documents/validate'
import { generateDocumentsBulk } from '@/lib/api-client'
import { readFirstSheet } from '@/lib/xlsx-grid'

export function BulkPanel({ doc, base, defaults, letterhead }: {
  doc: DocDef
  /** the form's current values: the same for every row */
  base: Record<string, string>
  defaults: Record<string, string>
  letterhead?: { letterhead?: string; blank?: boolean }
}) {
  const [name, setName] = useState('')
  const [grid, setGrid] = useState<string[][] | null>(null)
  const [mapping, setMapping] = useState<(string | null)[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const load = async (f: File | null) => {
    if (!f) return
    setErr('')
    try {
      let rows: string[][]
      if (/\.xlsx$/i.test(f.name)) rows = gridToRows(await readFirstSheet(await f.arrayBuffer()))
      else if (/\.(csv|tsv|txt)$/i.test(f.name)) rows = parseCsv(await f.text())
      else throw new Error('Fayl turi: .xlsx yoki .csv')
      if (rows.length < 2) throw new Error('Faylda sarlavha va kamida bitta qator boʻlishi kerak')
      setName(f.name)
      setGrid(rows)
      setMapping(matchColumns(rows[0], doc.fields))
    } catch (e) {
      setGrid(null)
      setErr(e instanceof Error ? e.message : 'Faylni oʻqib boʻlmadi')
    }
  }

  const values = useMemo(() => (grid ? rowsToValues(grid.slice(1), mapping, base) : []), [grid, mapping, base])
  const checks = useMemo(() => values.map((v) => checkDoc(doc.fields, withDerived(v))), [values, doc.fields])
  const mapped = mapping.filter(Boolean).length
  const problems = checks.flatMap((c, i) => c.issues.map((x) => ({ row: i + 1, ...x })))
  const tooMany = values.length > MAX_BULK_ROWS

  const run = async () => {
    setBusy(true)
    try {
      await generateDocumentsBulk(doc.id, values, letterhead)
      toast.success(`${values.length} ta hujjat bitta ZIP faylda yuklab olindi`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Hujjatlarni yaratib boʻlmadi')
    } finally {
      setBusy(false)
    }
  }

  const downloadTemplate = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([templateCsv(doc.fields, defaults)], { type: 'text/csv;charset=utf-8' }))
    a.download = `${doc.slug}-namuna.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="dbulk">
      <div className="dbulk-h">
        <FileSpreadsheet />
        <div>
          <b>{doc.title} — jadvaldan</b>
          <p className="faint">Har bir qator bitta hujjat. Chapdagi formada kiritilgan umumiy qiymatlar (korxona, sud…) hammasiga qoʻshiladi; jadvaldagi katak ularni almashtiradi.</p>
        </div>
      </div>

      <div className="dbulk-actions">
        <input ref={input} type="file" accept=".xlsx,.csv,.tsv,.txt" hidden onChange={(e) => { void load(e.target.files?.[0] ?? null); e.target.value = '' }} />
        <button className="btn btn-outline btn-sm" onClick={() => input.current?.click()}><Upload /><span>{grid ? 'Boshqa fayl' : 'Fayl tanlash (.xlsx, .csv)'}</span></button>
        <button className="btn btn-ghost btn-sm" onClick={downloadTemplate}><FileDown /><span>Namuna (.csv)</span></button>
        {name && <span className="faint mono" style={{ fontSize: 12 }}>{name}</span>}
      </div>
      {err && <div className="dbulk-err"><AlertTriangle />{err}</div>}

      {grid && (
        <>
          <div className="dedit-grp">Ustunlar</div>
          <div className="dbulk-map">
            {grid[0].map((h, i) => (
              <label key={i}>
                <span className="mono" title={h}>{h || `(${i + 1}-ustun)`}</span>
                <select
                  className="dinput"
                  value={mapping[i] ?? ''}
                  onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? e.target.value || null : x === e.target.value ? null : x)))}
                >
                  <option value="">— oʻtkazib yuborish —</option>
                  {doc.fields.map((k) => <option key={k} value={k}>{FIELDS[k]?.label ?? k}</option>)}
                </select>
              </label>
            ))}
          </div>

          <div className="dbulk-sum">
            <b>{values.length} ta qator</b>
            <span className="faint">{mapped} ta ustun maydonga bogʻlandi{problems.length ? ` · ${new Set(problems.map((p) => p.row)).size} ta qatorda muammo` : ''}</span>
          </div>
          {problems.length > 0 && (
            <ul className="dbulk-problems">
              {problems.slice(0, 6).map((p, i) => (
                <li key={i} className={p.level}>{p.row}-qator · <b>{FIELDS[p.key]?.label ?? p.key}</b> — {p.msg}</li>
              ))}
              {problems.length > 6 && <li className="faint">…va yana {problems.length - 6} ta</li>}
            </ul>
          )}
          {tooMany && <div className="dbulk-err"><AlertTriangle />Bir martada eng koʻpi bilan {MAX_BULK_ROWS} ta qator. Faylni boʻlib yuklang.</div>}
          <div className="dbulk-actions">
            <button className="btn btn-primary btn-sm" onClick={() => void run()} disabled={busy || !mapped || !values.length || tooMany}>
              {busy ? <Loader2 className="spin" style={{ width: 15, height: 15 }} /> : <FileDown />}
              <span>ZIP yaratish ({values.length})</span>
            </button>
            {problems.length > 0 && <span className="faint" style={{ fontSize: 12 }}>Muammoli qatorlar ham yaratiladi: tekshiruv faqat ogohlantiradi.</span>}
          </div>
        </>
      )}
    </div>
  )
}
