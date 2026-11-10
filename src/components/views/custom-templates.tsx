'use client'

/**
 * Hujjatlar › Oʻz shablonlarim — add your own .docx as a document, without code. Write `{{maydon}}` markers where a
 * value goes (a name the catalog knows, such as `{{company}}` or `{{court}}`, keeps its label, default and checks); the
 * markers become the form's fields, with the same live preview, drafts, checks, PDF and spreadsheet fill as the built-in
 * documents. The file stays on this computer (~/.sud-tizimi/templates).
 */

import { useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, FilePlus, FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { DOCS, FIELDS, docsByTab } from '@/lib/documents/registry'
import { isCustomId } from '@/lib/documents/custom'
import { deleteCustomDoc, uploadCustomDoc } from '@/lib/api-client'

export function CustomTemplates({ onBack, onOpen, onChanged }: {
  onBack: () => void
  onOpen: (docId: string) => void
  /** the saved list changed: reload it into the registry */
  onChanged: () => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const docs = docsByTab('custom')

  const pick = (f: File | null) => {
    setFile(f)
    if (f && !title.trim()) setTitle(f.name.replace(/\.docx$/i, '').replace(/[_-]+/g, ' ').trim())
  }

  const upload = async () => {
    if (!file) return
    setBusy(true)
    try {
      const r = await uploadCustomDoc(file, title)
      await onChanged()
      setFile(null)
      setTitle('')
      toast.success(`«${r.meta.title}» qoʻshildi · ${r.meta.fields.length} ta maydon`)
      if (r.invalid.length) toast.warning(`Oʻqib boʻlmagan belgilar: ${r.invalid.slice(0, 3).join(', ')}${r.invalid.length > 3 ? '…' : ''}. Maydon nomi kichik lotin harf, raqam va «_» dan iborat boʻlsin.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Shablonni saqlab boʻlmadi')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string, name: string) => {
    try {
      await deleteCustomDoc(id)
      await onChanged()
      toast.success(`«${name}» oʻchirildi`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Oʻchirib boʻlmadi')
    }
  }

  // the catalog's own field names, so a template can reuse them (label, default and checks come along)
  const builtin = new Set(DOCS.filter((d) => !isCustomId(d.id)).flatMap((d) => d.fields))
  const known = Object.values(FIELDS).filter((f) => builtin.has(f.key))

  return (
    <div>
      <div className="doc-crumb">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft />Barcha toifalar</button>
        <div className="doc-crumb-title"><span className="doc-crumb-ico"><FilePlus /></span><b>Oʻz shablonlarim</b></div>
      </div>
      <p className="faint" style={{ fontSize: 13, margin: '0 0 16px', lineHeight: 1.5 }}>
        Word (.docx) faylingizda qiymat boradigan joyga <span className="mono">{'{{maydon}}'}</span> deb yozing (kichik lotin harflar, raqam, «_»). Masalan:{' '}
        <span className="mono">{'{{company}}'}</span>, <span className="mono">{'{{director}}'}</span>, <span className="mono">{'{{contract_no}}'}</span>.
        Yuklangach har bir belgi forma maydoniga aylanadi. Fayl faqat shu kompyuterda saqlanadi.
      </p>

      <div className="p-card rise-c" style={{ marginBottom: 16 }}>
        <div className="p-row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <input ref={input} type="file" accept=".docx" hidden onChange={(e) => { pick(e.target.files?.[0] ?? null); e.target.value = '' }} />
          <button className="btn btn-outline" onClick={() => input.current?.click()}><Upload />{file ? file.name : 'Shablon fayli (.docx)'}</button>
          <label className="field" style={{ height: 40, flex: 1, minWidth: 200 }}>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shablon nomi" maxLength={80} />
          </label>
          <button className="btn btn-primary" onClick={() => void upload()} disabled={!file || !title.trim() || busy}>
            {busy ? <Loader2 className="spin" style={{ width: 15, height: 15 }} /> : null}
            Qoʻshish
          </button>
        </div>
      </div>

      {docs.length > 0 ? (
        <div className="doc-tiles">
          {docs.map((d) => (
            <div key={d.id} style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
              <button className="doc-tile rise-c" style={{ flex: 1 }} onClick={() => onOpen(d.id)}>
                <div className="doc-tile-ico"><FileText /></div>
                <div className="doc-tile-body"><b>{d.title}</b><span>{d.subtitle}</span></div>
                <ChevronRight className="doc-cat-arrow" />
              </button>
              <button className="btn btn-ghost btn-sm" aria-label={`«${d.title}» ni oʻchirish`} onClick={() => void remove(d.id, d.title)}><Trash2 /></button>
            </div>
          ))}
        </div>
      ) : (
        <p className="faint" style={{ fontSize: 13 }}>Hozircha shablon yoʻq.</p>
      )}

      <details style={{ marginTop: 18 }}>
        <summary className="faint" style={{ cursor: 'pointer', fontSize: 13 }}>Tayyor maydon nomlari ({known.length}): ularning nomi, boshlangʻich qiymati va tekshiruvi tayyor</summary>
        <div className="dbulk-map" style={{ marginTop: 10 }}>
          {known.map((f) => <div key={f.key} style={{ fontSize: 12 }}><span className="mono">{`{{${f.key}}}`}</span> <span className="faint">— {f.label}</span></div>)}
        </div>
      </details>
    </div>
  )
}
