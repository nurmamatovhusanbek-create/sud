'use client'

/**
 * Hujjatlar — the document-generation engine.
 *
 * Landing: a search box + category cards. A category is either
 *  - combined (visa, iio): opens ONE shared form (company + applicant panels)
 *    that generates every document in the category (fill once, generate all); or
 *  - separate (court): opens a grid of document cards, and each document opens
 *    its own full-window form.
 * The search box finds a document type across categories and opens it directly.
 *
 * Data model lives in src/lib/documents/registry.ts; the fill happens server
 * side at /api/documents/generate.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FileDown, FileText, Building2, UserRound, Loader2, ImagePlus, X,
  Plane, Landmark, Scale, ChevronRight, ArrowLeft, Search, FileSpreadsheet,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  TABS,
  DOCS,
  FIELDS,
  tabById,
  docsByTab,
  docById,
  docExtraFields,
  categoryDefaults,
  docDefaults,
  type DocTab,
  type TabDef,
  type DocDef,
  type FieldDef,
} from '@/lib/documents/registry'
import { generateDocument } from '@/lib/api-client'
import { PretenziyaFlow } from './pretenzia-view'

const CAT_ICON: Record<DocTab, React.ReactNode> = {
  visa: <Plane />,
  iio: <Landmark />,
  court: <Scale />,
}

// ---- a single field --------------------------------------------------------

function Field({ def, value, onChange }: { def: FieldDef; value: string; onChange: (v: string) => void }) {
  const wide = def.kind === 'textarea'
  return (
    <label className={`doc-field${wide ? ' doc-field-wide' : ''}`}>
      <span className="doc-field-label">{def.label}</span>
      {wide ? (
        <textarea
          className={`dinput${def.mono ? ' mono' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
          rows={2}
        />
      ) : (
        <input
          className={`dinput${def.mono ? ' mono' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={def.placeholder}
        />
      )}
      {def.hint && <span className="doc-field-hint">{def.hint}</span>}
    </label>
  )
}

function FieldGrid({ keys, values, set }: { keys: string[]; values: Record<string, string>; set: (k: string, v: string) => void }) {
  return (
    <div className="doc-grid">
      {keys.map((k) => (
        <Field key={k} def={FIELDS[k]} value={values[k] ?? ''} onChange={(v) => set(k, v)} />
      ))}
    </div>
  )
}

// ---- letterhead ------------------------------------------------------------

const LH_KEY = 'sud-doc-letterhead-v1'

/** Read a file and re-encode it to a bounded PNG via canvas, entirely in the
 *  browser — the server then never needs an image toolchain (no native deps). */
async function fileToPng(file: File, maxW = 1600): Promise<string> {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result || ''))
    r.onerror = () => rej(new Error('read'))
    r.readAsDataURL(file)
  })
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image()
    i.onload = () => res(i)
    i.onerror = () => rej(new Error('img'))
    i.src = dataUrl
  })
  const iw = img.width || maxW
  const ih = img.height || 1
  const scale = Math.min(1, maxW / iw)
  const w = Math.max(1, Math.round(iw * scale))
  const h = Math.max(1, Math.round(ih * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(img, 0, 0, w, h)
  return canvas.toDataURL('image/png')
}

function LetterheadRow({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)

  const onFile = async (f: File | null) => {
    if (!f) return
    if (!f.type.startsWith('image/')) { toast.error('Rasm fayl tanlang (PNG/JPG)'); return }
    if (f.size > 8 * 1024 * 1024) { toast.error('Rasm juda katta (maks 8MB)'); return }
    try {
      onChange(await fileToPng(f))
      toast.success('Blanka yuklandi')
    } catch {
      toast.error('Rasmni oʻqib boʻlmadi')
    }
  }

  return (
    <div className="lh-row">
      <div className="lh-prev">
        {value
          ? <img src={value} alt="Korxona blankasi" />
          : <div className="lh-empty"><ImagePlus /><span>Blanka yoʻq — boʻsh joy qoldiriladi</span></div>}
      </div>
      <div className="lh-ctl">
        <span className="doc-field-label">Korxona blankasi (letterhead)</span>
        <div className="faint" style={{ fontSize: 12, margin: '4px 0 10px', lineHeight: 1.4 }}>
          Yuklanmasa, hujjat tepasida blanka uchun boʻsh joy qoldiriladi. Keng banner tavsiya etiladi (masalan 1600×420 px).
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
        <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => void onFile(e.target.files?.[0] || null)} />
      </div>
    </div>
  )
}

// ---- generate button (shared) ----------------------------------------------

function GenerateButton({ busy, blocked, blockHint, onClick, full = true }: {
  busy: boolean; blocked: boolean; blockHint?: string; onClick: () => void; full?: boolean
}) {
  return (
    <button
      className="btn btn-primary"
      style={{ width: full ? '100%' : undefined, marginTop: 14 }}
      onClick={onClick}
      disabled={busy || blocked}
      title={blocked ? blockHint : undefined}
    >
      {busy ? <Loader2 className="spin" style={{ width: 16, height: 16 }} /> : <FileDown />}
      <span>Word (.docx) yuklab olish</span>
    </button>
  )
}

// ---- single-document full-window form (separate categories) -----------------

function DocForm({ doc, letterhead, onLetterhead, onBack }: {
  doc: DocDef; letterhead: string; onLetterhead: (v: string) => void; onBack: () => void
}) {
  const tab = tabById(doc.tab)!
  const [values, setValues] = useState<Record<string, string>>(() => docDefaults(doc))
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }))

  const reqKey = tab.requireKey
  const blocked = reqKey ? !values[reqKey]?.trim() : false
  const blockHint = reqKey ? `Avval «${FIELDS[reqKey]?.label ?? reqKey}» maydonini toʻldiring` : undefined

  const generate = async () => {
    if (blocked) { toast.error(blockHint!); return }
    setBusy(true)
    try {
      await generateDocument(doc.id, values, tab.letterhead ? { letterhead: letterhead || undefined, blank: !letterhead } : {})
      toast.success(`${doc.title} tayyor — yuklab olindi`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Hujjatni yaratib boʻlmadi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="doc-crumb">
        <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft />Orqaga</button>
        <div className="doc-crumb-title">
          <span className="doc-crumb-ico">{CAT_ICON[doc.tab]}</span>
          <b>{doc.title}</b>
          <span className="badge b-neu" style={{ textTransform: 'uppercase' }}>{doc.lang}</span>
        </div>
      </div>

      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><FileText /></div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ marginBottom: 2 }}>{doc.title}</h3>
            <div className="faint" style={{ fontSize: 12 }}>{doc.subtitle}</div>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <FieldGrid keys={doc.fields} values={values} set={set} />
        </div>
        {tab.letterhead && <LetterheadRow value={letterhead} onChange={onLetterhead} />}
        <GenerateButton busy={busy} blocked={blocked} blockHint={blockHint} onClick={() => void generate()} />
      </div>
    </div>
  )
}

// ---- combined-category form (visa, iio): one form → many documents ----------

function CombinedDocCard({ doc, tab, values, set, busy, blocked, blockHint, onGenerate }: {
  doc: DocDef; tab: TabDef; values: Record<string, string>; set: (k: string, v: string) => void
  busy: boolean; blocked: boolean; blockHint?: string; onGenerate: () => void
}) {
  const extra = docExtraFields(doc, tab)
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
      {extra.length > 0 && <div style={{ marginTop: 12 }}><FieldGrid keys={extra} values={values} set={set} /></div>}
      <GenerateButton busy={busy} blocked={blocked} blockHint={blockHint} onClick={onGenerate} />
    </div>
  )
}

function CategoryForm({ tab, letterhead, onLetterhead }: { tab: TabDef; letterhead: string; onLetterhead: (v: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => categoryDefaults(tab))
  const [busy, setBusy] = useState<string | null>(null)
  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }))
  const docs = docsByTab(tab.id)

  const reqKey = tab.requireKey
  const blocked = reqKey ? !values[reqKey]?.trim() : false
  const blockHint = reqKey ? `Avval «${FIELDS[reqKey]?.label ?? reqKey}» maydonini toʻldiring` : undefined

  const generate = async (doc: DocDef) => {
    if (blocked) { toast.error(blockHint!); return }
    setBusy(doc.id)
    try {
      await generateDocument(doc.id, values, tab.letterhead ? { letterhead: letterhead || undefined, blank: !letterhead } : {})
      toast.success(`${doc.title} tayyor — yuklab olindi`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Hujjatni yaratib boʻlmadi')
    } finally {
      setBusy(null)
    }
  }

  const groupIcon = (title: string) => (title === 'Korxona' ? <Building2 /> : <UserRound />)

  return (
    <div>
      {(tab.groups ?? []).map((g) => (
        <div className="p-card rise-c" style={{ marginBottom: 16 }} key={g.title}>
          <div className="card-h">
            <div className="ico">{groupIcon(g.title)}</div>
            <h3>{g.title}</h3>
          </div>
          <div style={{ marginTop: 12 }}><FieldGrid keys={g.keys} values={values} set={set} /></div>
          {g.title === 'Korxona' && tab.letterhead && <LetterheadRow value={letterhead} onChange={onLetterhead} />}
        </div>
      ))}

      <div className="section-head" style={{ margin: '22px 0 14px' }}>
        <h2>Hujjatlar</h2>
        <span className="count">{docs.length}</span>
        <div className="sp" />
        <span className="faint" style={{ fontSize: 12 }}>tahrirlanadigan .docx</span>
      </div>

      <div className="doc-cards">
        {docs.map((doc) => (
          <CombinedDocCard
            key={doc.id}
            doc={doc}
            tab={tab}
            values={values}
            set={set}
            busy={busy === doc.id}
            blocked={blocked}
            blockHint={blockHint}
            onGenerate={() => void generate(doc)}
          />
        ))}
      </div>
    </div>
  )
}

// ---- cards -----------------------------------------------------------------

function CategoryCard({ tab, onOpen }: { tab: TabDef; onOpen: () => void }) {
  const count = docsByTab(tab.id).length
  return (
    <button className="doc-cat rise-c" onClick={onOpen}>
      <div className="doc-cat-ico">{CAT_ICON[tab.id]}</div>
      <div className="doc-cat-body">
        <b>{tab.label}</b>
        <span>{tab.intro}</span>
        <span className="doc-cat-meta"><FileText />{count} ta hujjat</span>
      </div>
      <ChevronRight className="doc-cat-arrow" />
    </button>
  )
}

function DocTile({ doc, onOpen }: { doc: DocDef; onOpen: () => void }) {
  return (
    <button className="doc-tile rise-c" onClick={onOpen}>
      <div className="doc-tile-ico">{CAT_ICON[doc.tab]}</div>
      <div className="doc-tile-body">
        <b>{doc.title}</b>
        <span>{doc.subtitle}</span>
      </div>
      <span className="badge b-neu" style={{ textTransform: 'uppercase' }}>{doc.lang}</span>
      <ChevronRight className="doc-cat-arrow" />
    </button>
  )
}

// ---- the view --------------------------------------------------------------

export function DocumentsView() {
  const [active, setActive] = useState<DocTab | null>(null)
  const [activeDoc, setActiveDoc] = useState<string | null>(null)
  const [pretenzia, setPretenzia] = useState(false)
  const [query, setQuery] = useState('')

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

  useEffect(() => { document.title = 'Hujjatlar · Sud tizimi' }, [])

  const activeTab = active ? tabById(active) ?? null : null
  const doc = activeDoc ? docById(activeDoc) ?? null : null

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return DOCS.filter((d) => {
      const cat = tabById(d.tab)?.label ?? ''
      return `${d.title} ${d.subtitle} ${cat} ${d.keywords ?? ''}`.toLowerCase().includes(q)
    })
  }, [query])

  const openDoc = (d: DocDef) => {
    setActive(d.tab)
    // Combined categories share one form, so only "select" the document for
    // separate categories; otherwise just open the category's combined form.
    setActiveDoc(tabById(d.tab)?.separate ? d.id : null)
    setQuery('')
  }

  // ---- Pretenziya (akt sverka) upload flow
  if (pretenzia) {
    return <PretenziyaFlow onBack={() => setPretenzia(false)} />
  }

  // ---- single document form
  if (doc) {
    return (
      <div>
        <Hero />
        <DocForm doc={doc} letterhead={letterhead} onLetterhead={updateLetterhead} onBack={() => setActiveDoc(null)} />
      </div>
    )
  }

  // ---- a category
  if (activeTab) {
    return (
      <div>
        <Hero />
        <div className="doc-crumb">
          <button className="btn btn-ghost btn-sm" onClick={() => setActive(null)}><ArrowLeft />Barcha toifalar</button>
          <div className="doc-crumb-title">
            <span className="doc-crumb-ico">{CAT_ICON[activeTab.id]}</span>
            <b>{activeTab.label}</b>
          </div>
        </div>
        {activeTab.separate ? (
          <>
            <p className="faint" style={{ fontSize: 13, margin: '0 0 16px' }}>{activeTab.intro}</p>
            <div className="doc-tiles">
              {docsByTab(activeTab.id).map((d) => (
                <DocTile key={d.id} doc={d} onOpen={() => setActiveDoc(d.id)} />
              ))}
            </div>
          </>
        ) : (
          <CategoryForm key={activeTab.id} tab={activeTab} letterhead={letterhead} onLetterhead={updateLetterhead} />
        )}
      </div>
    )
  }

  // ---- landing: search + category cards (or search results)
  return (
    <div>
      <Hero />
      <div className="doc-search">
        <Search />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hujjat turini qidiring… (masalan «viza», «buyruq», «majlis»)"
        />
        {query && <button className="doc-search-clear" onClick={() => setQuery('')} aria-label="Tozalash"><X /></button>}
      </div>

      {query.trim() ? (
        results.length ? (
          <div className="doc-tiles">
            {results.map((d) => <DocTile key={d.id} doc={d} onOpen={() => openDoc(d)} />)}
          </div>
        ) : (
          <div className="empty"><div className="ico"><Search /></div><h3>Topilmadi</h3><p>«{query}» boʻyicha hujjat turi topilmadi.</p></div>
        )
      ) : (
        <div className="doc-cat-cards">
          {TABS.map((t) => <CategoryCard key={t.id} tab={t} onOpen={() => setActive(t.id)} />)}
          <button className="doc-cat rise-c" onClick={() => setPretenzia(true)}>
            <div className="doc-cat-ico"><FileSpreadsheet /></div>
            <div className="doc-cat-body">
              <b>Pretenziya (Akt sverka)</b>
              <span>«Акт сверки» xlsx yuklang — qarzdor shartnomalar boʻyicha talabnoma (penya bilan) yaratiladi.</span>
              <span className="doc-cat-meta"><FileSpreadsheet />xlsx orqali</span>
            </div>
            <ChevronRight className="doc-cat-arrow" />
          </button>
        </div>
      )}
    </div>
  )
}

function Hero() {
  return (
    <div className="hero" style={{ marginBottom: 18 }}>
      <div className="eyebrow">Hujjat generatori</div>
      <h1>Hujjatlar</h1>
      <p>Viza, ichki ishlar va sud hujjatlarini tayyor shablonlar asosida yarating. Toifani tanlang yoki qidiring.</p>
    </div>
  )
}
