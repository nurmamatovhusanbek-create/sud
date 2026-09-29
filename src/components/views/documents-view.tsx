'use client'

/**
 * Hujjatlar — the document-generation engine.
 *
 * Landing: a search box + category cards. A category is either
 *  - combined (visa, iio): opens ONE editor — a shared form beside a live
 *    preview of the real document — that drives every document in the category
 *    (fill once, preview and download each); or
 *  - separate (court): opens a grid of document cards, and each document opens
 *    the same editor for just that document.
 * The search box finds a document type across categories and opens it directly.
 *
 * The editor (doc-editor.tsx) previews the template live in the browser; the
 * data model lives in src/lib/documents/registry.ts and the downloaded file is
 * filled server side at /api/documents/generate (same fill function).
 */

import { useEffect, useMemo, useState } from 'react'
import {
  X, Plane, Landmark, Scale, ChevronRight, ArrowLeft, Search, FileSpreadsheet,
} from 'lucide-react'
import {
  TABS,
  DOCS,
  tabById,
  docsByTab,
  docById,
  type DocTab,
  type TabDef,
  type DocDef,
} from '@/lib/documents/registry'
import { PretenziyaFlow } from './pretenzia-view'
import { DocEditor } from './doc-editor'
import { useLetterhead } from '@/components/proto/letterhead'
import { useAppStore } from '@/lib/store/app-store'

const CAT_ICON: Record<DocTab, React.ReactNode> = {
  visa: <Plane />,
  iio: <Landmark />,
  court: <Scale />,
}

// ---- cards -----------------------------------------------------------------

const CAT_BLURB: Record<DocTab, string> = {
  visa: 'Taklifnoma, kafolat, viza talabnomasi',
  iio: 'IIO / MvaPB kafolat va roʻyxat xati',
  court: 'Sudga arizalar va iltimosnomalar',
}

function CategoryCard({ tab, onOpen }: { tab: TabDef; onOpen: () => void }) {
  return (
    <button className="doc-cat rise-c" onClick={onOpen}>
      <div className="doc-cat-ico">{CAT_ICON[tab.id]}</div>
      <div className="doc-cat-body">
        <b>{tab.label}</b>
        <span>{CAT_BLURB[tab.id]}</span>
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
  // a case drawer can hand us a petition prefilled from the case data: open that document and use its values
  const prefill = useAppStore((s) => s.docPrefill)
  const setDocPrefill = useAppStore((s) => s.setDocPrefill)
  const [initial, setInitial] = useState<Record<string, string> | null>(null)

  const [letterhead, updateLetterhead] = useLetterhead()

  useEffect(() => {
    if (!prefill) return
    const d = docById(prefill.docId)
    if (!d) {
      setDocPrefill(null)
      return
    }
    setActive(d.tab)
    setActiveDoc(d.id)
    setInitial(prefill.values)
    setDocPrefill(null)
  }, [prefill, setDocPrefill])

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
    return <PretenziyaFlow onBack={() => setPretenzia(false)} letterhead={letterhead} onLetterhead={updateLetterhead} />
  }

  // ---- single document form
  if (doc) {
    const docTab = tabById(doc.tab)!
    return (
      <DocEditor
        key={doc.id + (initial ? ':prefilled' : '')}
        tab={docTab}
        doc={doc}
        initialValues={initial ?? undefined}
        letterhead={letterhead}
        onLetterhead={updateLetterhead}
        onBack={() => {
          setActiveDoc(null)
          setInitial(null)
        }}
        backLabel="Orqaga"
        icon={CAT_ICON[doc.tab]}
      />
    )
  }

  // ---- a combined category → one editor for all its documents
  if (activeTab && !activeTab.separate) {
    return (
      <DocEditor
        key={activeTab.id}
        tab={activeTab}
        letterhead={letterhead}
        onLetterhead={updateLetterhead}
        onBack={() => setActive(null)}
        backLabel="Barcha toifalar"
        icon={CAT_ICON[activeTab.id]}
      />
    )
  }

  // ---- a separate category → its document tiles
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
        <p className="faint" style={{ fontSize: 13, margin: '0 0 16px' }}>{activeTab.intro}</p>
        <div className="doc-tiles">
          {docsByTab(activeTab.id).map((d) => (
            <DocTile key={d.id} doc={d} onOpen={() => setActiveDoc(d.id)} />
          ))}
        </div>
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
              <b>Talabnoma</b>
              <span>Akt-sverka asosida, penya bilan</span>
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
