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

import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, FileDown, Files, Loader2 } from 'lucide-react'
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
import { generateDocument } from '@/lib/api-client'
import { LetterheadRow } from '@/components/proto/letterhead'
import { DocPreview } from '@/components/proto/doc-preview'

// ---- a single field --------------------------------------------------------

function Field({ def, value, unused, onChange, onFocus }: {
  def: FieldDef; value: string; unused: boolean
  onChange: (v: string) => void; onFocus: () => void
}) {
  const wide = def.kind === 'textarea'
  // ids, dates and phones sit two-up; anything that can hold a long value (a
  // company name, even in the mono font) keeps the full row.
  const sample = def.default ?? def.placeholder ?? ''
  const short = !wide && (def.kind === 'date' || (!!def.mono && sample.length <= 22))
  return (
    <label
      className={`doc-field${wide ? ' doc-field-wide' : ''}${short ? ' dedit-short' : ''}${unused ? ' is-unused' : ''}`}
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
          placeholder={def.placeholder}
          rows={3}
        />
      ) : (
        <input
          className={`dinput${def.mono ? ' mono' : ''}`}
          data-fk={def.key}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          placeholder={def.placeholder}
        />
      )}
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
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...(doc ? docDefaults(doc) : categoryDefaults(tab)), ...(initialValues ?? {}) }))
  const [curId, setCurId] = useState(docs[0].id)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const formRef = useRef<HTMLDivElement>(null)

  const cur = docs.find((d) => d.id === curId) ?? docs[0]
  const used = useMemo(() => new Set(cur.fields), [cur])
  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }))

  const sections = useMemo(() => {
    if (!tab.groups) return sectionsFor(cur.fields)
    const extra = docExtraFields(cur, tab)
    return [...tab.groups, ...(extra.length ? [{ title: 'Bu hujjat uchun', keys: extra }] : [])]
  }, [tab, cur])

  const filled = cur.fields.filter((k) => values[k]?.trim()).length
  const total = cur.fields.length

  const reqKey = tab.requireKey
  const blocked = reqKey ? !values[reqKey]?.trim() : false
  const blockHint = reqKey ? `Avval «${FIELDS[reqKey]?.label ?? reqKey}» maydonini toʻldiring` : undefined

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

  const runOne = async () => {
    if (blocked) { toast.error(blockHint!); return }
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

  const runAll = async () => {
    if (blocked) { toast.error(blockHint!); return }
    setBusy('all')
    try {
      for (const d of docs) await download(d)
      toast.success(`${docs.length} ta hujjat yuklab olindi`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Hujjatlarni yaratib boʻlmadi')
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
            {sections.map((s) => (
              <section key={s.title}>
                <div className="dedit-grp">{s.title}</div>
                <div className="dedit-fields">
                  {s.keys.map((k) => (
                    <Field
                      key={k}
                      def={FIELDS[k]}
                      value={values[k] ?? ''}
                      unused={!used.has(k)}
                      onChange={(v) => set(k, v)}
                      onFocus={() => setActiveKey(k)}
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
              <button className="btn btn-outline btn-sm" onClick={() => void runAll()} disabled={busy !== null || blocked} title={blocked ? blockHint : `${docs.length} ta hujjatni yuklab olish`}>
                {busy === 'all' ? <Loader2 className="spin" style={{ width: 15, height: 15 }} /> : <Files />}
                <span>Barchasi ({docs.length})</span>
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => void runOne()} disabled={busy !== null || blocked} title={blocked ? blockHint : undefined}>
              {busy === cur.id ? <Loader2 className="spin" style={{ width: 15, height: 15 }} /> : <FileDown />}
              <span>Word (.docx)</span>
            </button>
          </div>
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
