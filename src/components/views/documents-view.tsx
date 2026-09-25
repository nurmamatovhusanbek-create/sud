'use client'

/**
 * Hujjatlar — the document-generation engine. A card grid of document
 * categories (scales as more template sets are added); opening a category
 * shows its form. Company + applicant data is entered once per category
 * (shared panels); each document adds only its own extra fields, then fills
 * the real company .docx template and downloads an editable Word file.
 *
 * Data model lives in src/lib/documents/registry.ts; the fill happens server
 * side at /api/documents/generate.
 */

import { useEffect, useRef, useState } from 'react'
import {
  FileDown, FileText, Building2, UserRound, Loader2, ImagePlus, X,
  Plane, Landmark, Scale, ChevronRight, ArrowLeft,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  TABS,
  FIELDS,
  tabDefaults,
  type DocTab,
  type TabDef,
  type DocDef,
  type FieldDef,
} from '@/lib/documents/registry'
import { generateDocument } from '@/lib/api-client'

const CAT_ICON: Record<DocTab, React.ReactNode> = {
  visa: <Plane />,
  iio: <Landmark />,
  court: <Scale />,
}

// ---- a single field --------------------------------------------------------

function Field({ def, value, onChange }: { def: FieldDef; value: string; onChange: (v: string) => void }) {
  return (
    <label className="doc-field">
      <span className="doc-field-label">{def.label}</span>
      {def.kind === 'textarea' ? (
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

/** Per-company letterhead: upload an image that replaces the embedded banner
 *  in generated documents. No upload → blank space is left in the document.
 *  Persisted (localStorage) and shared across categories. */
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

// ---- one document card -----------------------------------------------------

function DocCard({
  doc, values, set, busy, blocked, blockHint, onGenerate,
}: {
  doc: DocDef
  values: Record<string, string>
  set: (k: string, v: string) => void
  busy: boolean
  blocked: boolean
  blockHint?: string
  onGenerate: () => void
}) {
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
        disabled={busy || blocked}
        title={blocked ? blockHint : undefined}
      >
        {busy ? <Loader2 className="spin" style={{ width: 16, height: 16 }} /> : <FileDown />}
        <span>Word (.docx) yuklab olish</span>
      </button>
    </div>
  )
}

// ---- a category form (shared panels + its documents) -----------------------

function CategoryForm({ tab, letterhead, onLetterhead }: { tab: TabDef; letterhead: string; onLetterhead: (v: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => tabDefaults(tab))
  const [busy, setBusy] = useState<string | null>(null)

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }))

  const reqKey = tab.requireKey
  const blocked = reqKey ? !values[reqKey]?.trim() : false
  const blockHint = reqKey ? `Avval «${FIELDS[reqKey]?.label ?? reqKey}» maydonini toʻldiring` : undefined

  const generate = async (doc: DocDef) => {
    if (reqKey && !values[reqKey]?.trim()) {
      toast.error(blockHint!)
      return
    }
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
          {g.title === 'Korxona' && tab.letterhead && <LetterheadRow value={letterhead} onChange={onLetterhead} />}
        </div>
      ))}

      <div className="section-head" style={{ margin: '22px 0 14px' }}>
        <h2>Hujjatlar</h2>
        <span className="count">{tab.docs.length}</span>
        <div className="sp" />
        <span className="faint" style={{ fontSize: 12 }}>tahrirlanadigan .docx</span>
      </div>

      <div className="doc-cards">
        {tab.docs.map((doc) => (
          <DocCard
            key={doc.id}
            doc={doc}
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

// ---- the view --------------------------------------------------------------

export function DocumentsView() {
  const [active, setActive] = useState<DocTab | null>(null)
  const activeTab = active ? TABS.find((t) => t.id === active) ?? null : null

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
      <div className="hero" style={{ marginBottom: 18 }}>
        <div className="eyebrow">Hujjat generatori</div>
        <h1>Hujjatlar</h1>
        <p>Viza, ichki ishlar va sud hujjatlarini tayyor shablonlar asosida yarating. Toifani tanlang.</p>
      </div>

      {!activeTab ? (
        <div className="doc-cat-cards">
          {TABS.map((t) => (
            <button key={t.id} className="doc-cat rise-c" onClick={() => setActive(t.id)}>
              <div className="doc-cat-ico">{CAT_ICON[t.id]}</div>
              <div className="doc-cat-body">
                <b>{t.label}</b>
                <span>{t.intro}</span>
                <span className="doc-cat-meta"><FileText />{t.docs.length} ta hujjat</span>
              </div>
              <ChevronRight className="doc-cat-arrow" />
            </button>
          ))}
        </div>
      ) : (
        <div>
          <div className="doc-crumb">
            <button className="btn btn-ghost btn-sm" onClick={() => setActive(null)}>
              <ArrowLeft />Barcha toifalar
            </button>
            <div className="doc-crumb-title">
              <span className="doc-crumb-ico">{CAT_ICON[activeTab.id]}</span>
              <b>{activeTab.label}</b>
            </div>
          </div>
          <CategoryForm key={activeTab.id} tab={activeTab} letterhead={letterhead} onLetterhead={updateLetterhead} />
        </div>
      )}
    </div>
  )
}
