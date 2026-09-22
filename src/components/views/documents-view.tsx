'use client'

/**
 * Hujjatlar — the document-generation engine. Two independent tabs (Viza
 * hujjatlari · Ichki ishlar); each fills real company .docx templates and
 * downloads an editable Word file. Company + applicant data is entered once
 * per tab (shared panels); each document adds only its own extra fields.
 *
 * Data model lives in src/lib/documents/registry.ts; the fill happens server
 * side at /api/documents/generate.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, FileText, Building2, UserRound, Loader2, ImagePlus, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  TABS,
  FIELDS,
  tabDefaults,
  type TabDef,
  type DocDef,
  type FieldDef,
} from '@/lib/documents/registry'
import { generateDocument } from '@/lib/api-client'

function Field({
  def,
  value,
  onChange,
}: {
  def: FieldDef
  value: string
  onChange: (v: string) => void
}) {
  const font: React.CSSProperties = def.mono
    ? { fontFamily: 'var(--font-mono)', fontSize: 14.5, letterSpacing: '.02em' }
    : { fontFamily: 'var(--font-sans)', fontSize: 15, letterSpacing: 'normal' }
  return (
    <label className="doc-field">
      <span className="doc-field-label">{def.label}</span>
      {def.kind === 'textarea' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
          rows={2}
          style={font}
        />
      ) : (
        <span className="field" style={{ height: 48 }}>
          <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={def.placeholder} style={font} />
        </span>
      )}
      {def.hint && <span className="doc-field-hint">{def.hint}</span>}
    </label>
  )
}

const LH_KEY = 'sud-doc-letterhead-v1'

/** Per-company letterhead: upload an image that replaces the embedded banner
 *  in generated documents. Persisted (localStorage) and shared across tabs. */
function LetterheadRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)

  const onFile = (f: File | null) => {
    if (!f) return
    if (!f.type.startsWith('image/')) { toast.error('Rasm fayl tanlang (PNG/JPG)'); return }
    if (f.size > 8 * 1024 * 1024) { toast.error('Rasm juda katta (maks 8MB)'); return }
    const reader = new FileReader()
    reader.onload = () => { onChange(String(reader.result || '')); toast.success('Blanka yuklandi') }
    reader.onerror = () => toast.error('Rasmni oʻqib boʻlmadi')
    reader.readAsDataURL(f)
  }

  return (
    <div className="lh-row">
      <div className="lh-prev">
        {value
          ? <img src={value} alt="Korxona blankasi" />
          : <div className="lh-empty"><ImagePlus /><span>Standart blanka</span></div>}
      </div>
      <div className="lh-ctl">
        <span className="doc-field-label">Korxona blankasi (letterhead)</span>
        <div className="faint" style={{ fontSize: 12, margin: '4px 0 10px', lineHeight: 1.4 }}>
          Yuklanmasa, hujjatning standart blankasi ishlatiladi. Keng banner tavsiya etiladi (masalan 1600×420 px).
        </div>
        <div className="p-row" style={{ gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => inputRef.current?.click()}>
            <ImagePlus />{value ? 'Almashtirish' : 'Rasm yuklash'}
          </button>
          {value && (
            <button className="btn btn-ghost btn-sm" onClick={() => { onChange(''); toast('Blanka olib tashlandi') }}>
              <X />Olib tashlash
            </button>
          )}
        </div>
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0] || null)} />
      </div>
    </div>
  )
}

function DocCard({
  doc,
  values,
  set,
  busy,
  onGenerate,
}: {
  doc: DocDef
  values: Record<string, string>
  set: (k: string, v: string) => void
  busy: boolean
  onGenerate: () => void
}) {
  const missingName = !values.full_name?.trim()
  return (
    <div className="p-card rise-c doc-card">
      <div className="card-h">
        <div className="ico"><FileText /></div>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ marginBottom: 2 }}>{doc.title}</h3>
          <div className="faint" style={{ fontSize: 12 }}>{doc.subtitle}</div>
        </div>
        <div className="sp" />
        <span className="badge b-neu" style={{ textTransform: 'uppercase' }}>{doc.lang}</span>
      </div>

      {doc.extra.length > 0 && (
        <div className="doc-grid" style={{ marginTop: 12 }}>
          {doc.extra.map((k) => (
            <Field key={k} def={FIELDS[k]} value={values[k] ?? ''} onChange={(v) => set(k, v)} />
          ))}
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 14 }}
        onClick={onGenerate}
        disabled={busy || missingName}
        title={missingName ? 'Avval F.I.Sh kiriting' : undefined}
      >
        {busy ? <Loader2 className="spin" style={{ width: 16, height: 16 }} /> : <FileDown />}
        <span>Word (.docx) yuklab olish</span>
      </button>
    </div>
  )
}

function TabPanel({ tab, letterhead, onLetterhead }: { tab: TabDef; letterhead: string; onLetterhead: (v: string) => void }) {
  // TabPanel is remounted per tab (key={tab.id} in the parent), so the form
  // seeds once from this tab's defaults and each tab stays an independent flow.
  const [values, setValues] = useState<Record<string, string>>(() => tabDefaults(tab))
  const [busy, setBusy] = useState<string | null>(null)

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }))

  const generate = async (doc: DocDef) => {
    if (!values.full_name?.trim()) {
      toast.error('Avval chet ellik xodimning F.I.Sh sini kiriting')
      return
    }
    setBusy(doc.id)
    try {
      await generateDocument(doc.id, values, letterhead || undefined)
      toast.success(`${doc.title} tayyor — yuklab olindi`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Hujjatni yaratib boʻlmadi')
    } finally {
      setBusy(null)
    }
  }

  const groupIcon = (title: string) =>
    title === 'Korxona' ? <Building2 /> : <UserRound />

  return (
    <div>
      <p className="faint" style={{ fontSize: 13, margin: '0 0 16px' }}>{tab.intro}</p>

      {tab.groups.map((g) => (
        <div className="p-card rise-c" style={{ marginBottom: 16 }} key={g.title}>
          <div className="card-h">
            <div className="ico">{groupIcon(g.title)}</div>
            <h3>{g.title}</h3>
          </div>
          <div className="doc-grid" style={{ marginTop: 12 }}>
            {g.keys.map((k) => (
              <Field key={k} def={FIELDS[k]} value={values[k] ?? ''} onChange={(v) => set(k, v)} />
            ))}
          </div>
          {g.title === 'Korxona' && <LetterheadRow value={letterhead} onChange={onLetterhead} />}
        </div>
      ))}

      <div className="section-head" style={{ margin: '22px 0 14px' }}>
        <h2>Hujjatlar</h2>
        <span className="count">{tab.docs.length}</span>
        <div className="sp" />
        <span className="faint" style={{ fontSize: 12 }}>letterhead saqlanadi · tahrirlanadigan .docx</span>
      </div>

      <div className="doc-cards">
        {tab.docs.map((doc) => (
          <DocCard
            key={doc.id}
            doc={doc}
            values={values}
            set={set}
            busy={busy === doc.id}
            onGenerate={() => void generate(doc)}
          />
        ))}
      </div>
    </div>
  )
}

export function DocumentsView() {
  const [tabId, setTabId] = useState<TabDef['id']>('visa')
  const tab = useMemo(() => TABS.find((t) => t.id === tabId) ?? TABS[0], [tabId])

  // Company letterhead is app-level (one company) and persisted across sessions.
  // Lazy init from localStorage — this view only mounts on a client click, so
  // there is no SSR pass to mismatch against.
  const [letterhead, setLetterhead] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    try { return localStorage.getItem(LH_KEY) || '' } catch { return '' }
  })
  const updateLetterhead = (v: string) => {
    setLetterhead(v)
    try {
      if (v) localStorage.setItem(LH_KEY, v)
      else localStorage.removeItem(LH_KEY)
    } catch { /* private mode / quota */ }
  }

  useEffect(() => {
    document.title = 'Hujjatlar · Sud tizimi'
  }, [])

  return (
    <div>
      <div className="hero" style={{ marginBottom: 14 }}>
        <div className="eyebrow">Hujjat generatori</div>
        <h1>Hujjatlar</h1>
        <p>Chet ellik xodimlar uchun viza va ichki ishlar hujjatlarini korxona blankasida yarating.</p>
      </div>

      <div className="set-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={`set-tab ${tabId === t.id ? 'on' : ''}`} onClick={() => setTabId(t.id)}>
            <FileText />
            {t.label}
          </button>
        ))}
      </div>

      <TabPanel key={tab.id} tab={tab} letterhead={letterhead} onLetterhead={updateLetterhead} />
    </div>
  )
}
