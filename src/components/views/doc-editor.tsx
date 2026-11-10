'use client'

/**
 * Hujjat muharriri — the form and the finished document side by side.
 *
 * Left: the fields, in sections. Right: the REAL .docx template (letterhead
 * and all), filled live as you type. Every filled value on the page is
 * clickable: click it and the form jumps to (and focuses) that field; focus a
 * field and its spots light up on the page.
 *
 * One editor serves both shapes of category:
 *  - combined (visa, iio): ONE shared form drives several documents; a switcher
 *    above the page chooses which one you are looking at / downloading.
 *  - separate (court): one document, its own fields in readable sections.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, FileDown, FileText, Files, Loader2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import {
  FIELDS,
  categoryDefaults,
  docDefaults,
  docExtraFields,
  docsByTab,
  sectionsFor,
  type DocDef,
  type FieldDef,
  type TabDef,
} from '@/lib/documents/registry'
import { DERIVED_RULES, withDerived } from '@/lib/documents/derive'
import { generateDocument, generateDocumentsZip } from '@/lib/api-client'
import { openPrintWindow, printIntoWindow } from '@/lib/print'
import { printSheet, renderPrintHtml } from '@/lib/documents/print-render'
import { LetterheadRow } from '@/components/proto/letterhead'
import { DocPreview } from '@/components/proto/doc-preview'
import { SectionProfiles } from '@/components/views/doc-profiles'
import { clearDraft, draftKeyFor, loadDraft, saveDraft } from '@/lib/documents/drafts'
import { checkDoc, validateField, type DocCheck, type Issue } from '@/lib/documents/validate'

// ---- a single field --------------------------------------------------------

function Field({ def, value, auto, unused, issue, onChange, onFocus, onBlur }: {
  def: FieldDef; value: string; unused: boolean
  /** a check that failed for what is typed (shown once the field has been left) */
  issue?: Issue | null
  /** what the field falls back to when left empty (derived from another input), shown as its hint */
  auto?: string
  onChange: (v: string) => void; onFocus: () => void; onBlur: () => void
}) {
  const wide = def.kind === 'textarea'
  // ids, dates and phones sit two-up; anything that can hold a long value (a
  // company name, even in the mono font) keeps the full row.
  const sample = def.default ?? def.placeholder ?? ''
  const short = !wide && (def.kind === 'date' || (!!def.mono && sample.length <= 22))
  return (
    <label
      className={`doc-field${wide ? ' doc-field-wide' : ''}${short ? ' dedit-short' : ''}${unused ? ' is-unused' : ''}${issue ? ` has-${issue.level}` : ''}`}
      title={unused ? 'Bu hujjatda ishlatilmaydi' : undefined}
    >
      <span className="doc-field-label">{def.label}</span>
      {wide ? (
        <textarea
          className={`dinput${def.mono ? ' mono' : ''}`}
          data-fk={def.key}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={auto || def.placeholder}
          rows={3}
        />
      ) : (
        <input
          className={`dinput${def.mono ? ' mono' : ''}`}
          data-fk={def.key}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={auto || def.placeholder}
        />
      )}
      {issue && <span className={`doc-field-issue ${issue.level}`} role={issue.level === 'error' ? 'alert' : undefined}>{issue.msg}</span>}
      {def.hint && <span className="doc-field-hint">{def.hint}</span>}
    </label>
  )
}

// ---- the editor -------------------------------------------------------------

export function DocEditor({ tab, doc, letterhead, onLetterhead, onBack, backLabel, icon, initialValues }: {
  tab: TabDef
  /** set for a separate category's single document; omit for a combined category */
  doc?: DocDef
  letterhead: string
  onLetterhead: (v: string) => void
  onBack: () => void
  backLabel: string
  icon: React.ReactNode
  /** values laid over the document's defaults (e.g. prefilled from a scraped case) */
  initialValues?: Record<string, string>
}) {
  const docs = useMemo(() => (doc ? [doc] : docsByTab(tab.id)), [doc, tab.id])
  const defaults = useMemo(() => (doc ? docDefaults(doc) : categoryDefaults(tab)), [doc, tab])
  const draftKey = draftKeyFor({ docId: doc?.id, tabId: tab.id })
  // A half-filled form comes back after a refresh. A form opened FROM A CASE starts fresh (the case's values, not an
  // old draft's), and its edits replace the draft.
  const [restored, setRestored] = useState<number | null>(() => {
    if (initialValues || typeof window === 'undefined') return null
    try { return loadDraft(window.localStorage, draftKey)?.savedAt ?? null } catch { return null }
  })
  const [values, setValues] = useState<Record<string, string>>(() => {
    let draft: Record<string, string> = {}
    if (!initialValues && typeof window !== 'undefined') {
      try { draft = loadDraft(window.localStorage, draftKey)?.values ?? {} } catch { /* no draft */ }
    }
    return { ...defaults, ...draft, ...(initialValues ?? {}) }
  })
  const [curId, setCurId] = useState(docs[0].id)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  // fields the person has left (their problems show then, not while typing «AA12…»)
  const [left, setLeft] = useState<Set<string>>(() => new Set())
  // the check shown before a download, with what to do when it is confirmed
  const [review, setReview] = useState<{ report: DocCheck; go: () => void } | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  const cur = docs.find((d) => d.id === curId) ?? docs[0]
  const used = useMemo(() => new Set(cur.fields), [cur])
  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }))
  const effective = useMemo(() => withDerived(values), [values])

  // autosave (debounced): only what differs from the defaults is stored
  useEffect(() => {
    const t = setTimeout(() => {
      try { saveDraft(window.localStorage, draftKey, values, defaults) } catch { /* storage blocked */ }
    }, 600)
    return () => clearTimeout(t)
  }, [values, defaults, draftKey])
  // a check is about THESE values: as soon as one changes it is stale
  useEffect(() => setReview(null), [values])
  const resetForm = () => {
    try { clearDraft(window.localStorage, draftKey) } catch { /* nothing stored */ }
    setValues(defaults)
    setRestored(null)
  }

  const sections = useMemo(() => {
    if (!tab.groups) return sectionsFor(cur.fields)
    const extra = docExtraFields(cur, tab)
    return [...tab.groups, ...(extra.length ? [{ title: 'Bu hujjat uchun', keys: extra }] : [])]
  }, [tab, cur])

  const filled = cur.fields.filter((k) => values[k]?.trim()).length
  const total = cur.fields.length

  // a document can name its own required field (the order needs its number, the agreement the employee)
  const missingFor = (d: DocDef) => {
    const k = d.requireKey ?? tab.requireKey
    return k && !values[k]?.trim() ? k : null
  }
  const hintFor = (k: string) => `Avval «${FIELDS[k]?.label ?? k}» maydonini toʻldiring`
  const reqKey = missingFor(cur)
  const blocked = !!reqKey
  const blockHint = reqKey ? hintFor(reqKey) : undefined
  const blockedAll = docs.map(missingFor).find((k) => k) ?? null

  // page → form: jump to and focus the field behind a clicked value
  const pick = (key: string) => {
    const el = formRef.current?.querySelector<HTMLElement>(`[data-fk="${key}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.focus({ preventScroll: true })
  }

  const download = async (d: DocDef) => {
    await generateDocument(d.id, values, tab.letterhead ? { letterhead: letterhead || undefined, blank: !letterhead } : {})
  }

  // What the download would contain, checked: filled values that look wrong, and fields left empty.
  const checkFor = (ds: DocDef[]): DocCheck => {
    const seen = new Set<string>()
    const merged: DocCheck = { issues: [], empty: [] }
    for (const d of ds) {
      const c = checkDoc(d.fields, effective)
      for (const i of c.issues) if (!seen.has(`i:${i.key}`)) { seen.add(`i:${i.key}`); merged.issues.push(i) }
      for (const k of c.empty) if (!seen.has(`e:${k}`)) { seen.add(`e:${k}`); merged.empty.push(k) }
    }
    return merged
  }

  /** run `go` now when the check is clean, else show the check first (the person decides) */
  const guarded = (ds: DocDef[], go: () => void) => {
    const report = checkFor(ds)
    if (report.issues.length) setReview({ report, go })
    else {
      go()
      if (report.empty.length) toast(`${report.empty.length} ta maydon boʻsh qoldi: ${report.empty.slice(0, 3).map((k) => FIELDS[k]?.label ?? k).join(', ')}${report.empty.length > 3 ? '…' : ''}`)
    }
  }

  const runOne = () => {
    if (blocked) { toast.error(blockHint!); return }
    guarded([cur], () => void doOne())
  }
  const doOne = async () => {
    setBusy(cur.id)
    try {
      await download(cur)
      toast.success(`${cur.title} tayyor — yuklab olindi`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Hujjatni yaratib boʻlmadi')
    } finally {
      setBusy(null)
    }
  }

  const runAll = () => {
    if (blockedAll) { toast.error(hintFor(blockedAll)); return }
    guarded(docs, () => void doAll())
  }
  const doAll = async () => {
    setBusy('all')
    try {
      await generateDocumentsZip(docs.map((d) => d.id), values, tab.letterhead ? { letterhead: letterhead || undefined, blank: !letterhead } : {}, tab.id === 'visa' ? 'viza-hujjatlari' : tab.id === 'iio' ? 'ichki-ishlar-hujjatlari' : `${tab.id}-hujjatlari`)
      toast.success(`${docs.length} ta hujjat bitta ZIP faylda yuklab olindi`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Hujjatlarni yaratib boʻlmadi')
    } finally {
      setBusy(null)
    }
  }

  // PDF = the browser's print of the same filled document («Save as PDF»); the window must open inside the click
  const runPdf = () => {
    if (blocked) { toast.error(blockHint!); return }
    guarded([cur], () => void doPdf())
  }
  const doPdf = async () => {
    let w: Window
    try {
      w = openPrintWindow()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Chop etish oynasi ochilmadi')
      return
    }
    w.document.title = 'Hujjat tayyorlanmoqda…'
    w.document.body.textContent = 'Hujjat tayyorlanmoqda…'
    setBusy(`pdf:${cur.id}`)
    try {
      const pages = await renderPrintHtml(cur.id, values, tab.letterhead ? { letterhead: letterhead || undefined, blank: !letterhead } : {})
      printIntoWindow(w, printSheet(cur.title, pages))
    } catch (e) {
      try { w.close() } catch { /* already closed */ }
      toast.error(e instanceof Error ? e.message : 'PDF tayyorlab boʻlmadi')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <div className="doc-crumb">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft />{backLabel}</button>
        <div className="doc-crumb-title">
          <span className="doc-crumb-ico">{icon}</span>
          <b>{doc ? doc.title : tab.label}</b>
          {doc && <span className="badge b-neu" style={{ textTransform: 'uppercase' }}>{doc.lang}</span>}
        </div>
      </div>

      <div className="dedit">
        {/* ---- form ---- */}
        <div className="dedit-form">
          <div className="dedit-scroll" ref={formRef}>
            {restored !== null && (
              <div className="dedit-restored">
                <span>Qoralama tiklandi · {new Date(restored).toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}. Shu kompyuterda saqlanadi.</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={resetForm}><RotateCcw /><span>Tozalash</span></button>
              </div>
            )}
            {sections.map((s) => (
              <section key={s.title}>
                <div className="dedit-grp">{s.title}<SectionProfiles keys={s.keys} values={values} onApply={setValues} /></div>
                <div className="dedit-fields">
                  {s.keys.map((k) => (
                    <Field
                      key={k}
                      def={FIELDS[k]}
                      value={values[k] ?? ''}
                      auto={DERIVED_RULES[k] ? effective[k] : undefined}
                      unused={!used.has(k)}
                      issue={left.has(k) ? validateField(k, values[k] ?? '') : null}
                      onChange={(v) => set(k, v)}
                      onFocus={() => setActiveKey(k)}
                      onBlur={() => setLeft((p) => (p.has(k) ? p : new Set(p).add(k)))}
                    />
                  ))}
                </div>
                {s.title === 'Korxona' && tab.letterhead && <LetterheadRow value={letterhead} onChange={onLetterhead} />}
              </section>
            ))}
          </div>
          <div className="dedit-foot">
            <div className="dedit-prog"><i style={{ width: `${total ? (filled / total) * 100 : 0}%` }} /></div>
            <b>{filled}/{total}</b>
          </div>
        </div>

        {/* ---- live document ---- */}
        <div className="dedit-doc">
          <div className="dedit-bar">
            {docs.length > 1 ? (
              <div className="seg dedit-seg" role="tablist" aria-label="Hujjat">
                {docs.map((d) => (
                  <button key={d.id} role="tab" aria-selected={d.id === cur.id} className={d.id === cur.id ? 'on' : ''} onClick={() => setCurId(d.id)}>
                    {d.title}
                  </button>
                ))}
              </div>
            ) : (
              <div className="dedit-bar-title"><b>{cur.title}</b><span>{cur.subtitle}</span></div>
            )}
            <div className="sp" />
            <span className="badge b-neu" style={{ textTransform: 'uppercase' }}>{cur.lang}</span>
            {docs.length > 1 && (
              <button className="btn btn-outline btn-sm" onClick={runAll} disabled={busy !== null || !!blockedAll} title={blockedAll ? hintFor(blockedAll) : `${docs.length} ta hujjatni bitta ZIP faylda yuklab olish`}>
                {busy === 'all' ? <Loader2 className="spin" style={{ width: 15, height: 15 }} /> : <Files />}
                <span>Barchasi · ZIP ({docs.length})</span>
              </button>
            )}
            <button className="btn btn-outline btn-sm" onClick={runPdf} disabled={busy !== null || blocked} title={blocked ? blockHint : 'Chop etish oynasida «PDF sifatida saqlash» ni tanlang'}>
              {busy === `pdf:${cur.id}` ? <Loader2 className="spin" style={{ width: 15, height: 15 }} /> : <FileText />}
              <span>PDF</span>
            </button>
            <button className="btn btn-primary btn-sm" onClick={runOne} disabled={busy !== null || blocked} title={blocked ? blockHint : undefined}>
              {busy === cur.id ? <Loader2 className="spin" style={{ width: 15, height: 15 }} /> : <FileDown />}
              <span>Word (.docx)</span>
            </button>
          </div>
          {review && (
            <div className="dedit-review" role="alertdialog" aria-label="Yuklashdan oldin tekshiruv">
              <div className="dedit-review-h"><AlertTriangle /><b>Yuklashdan oldin tekshiring</b></div>
              <ul>
                {review.report.issues.slice(0, 8).map((i) => (
                  <li key={i.key} className={i.level}>
                    <button type="button" onClick={() => { setReview(null); setLeft((p) => new Set(p).add(i.key)); pick(i.key) }}>
                      <b>{FIELDS[i.key]?.label ?? i.key}</b> — {i.msg}
                    </button>
                  </li>
                ))}
              </ul>
              {review.report.issues.length > 8 && <div className="faint" style={{ fontSize: 12 }}>…va yana {review.report.issues.length - 8} ta</div>}
              {review.report.empty.length > 0 && <div className="faint" style={{ fontSize: 12, marginTop: 6 }}>Boʻsh maydonlar: {review.report.empty.length} ta</div>}
              <div className="dedit-review-a">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => { const first = review.report.issues[0]; setReview(null); if (first) pick(first.key) }}>Tuzatish</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => { const go = review.go; setReview(null); go() }}>Baribir yuklash</button>
              </div>
            </div>
          )}
          <DocPreview
            docId={cur.id}
            values={values}
            letterhead={tab.letterhead ? letterhead : ''}
            blank={!!tab.letterhead && !letterhead}
            activeKey={activeKey}
            onPick={pick}
          />
          <div className="dedit-hint">Hujjatdagi belgilangan joyni bosing — maydon ochiladi. Boʻsh joylar faqat koʻrinishda koʻrsatiladi.</div>
        </div>
      </div>
    </div>
  )
}
