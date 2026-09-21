'use client'

/**
 * Command palette — the prototypeʼs ⌘K / ⌘F / "/" surface: mode chip (STIR ·
 * Kvitansiya · Ish raqami · PINFL · Nom), quick actions for case numbers and
 * invoices, registry companies with monograms and status badges, live orginfo
 * lookup for name queries, full keyboard navigation, and the 'add' purpose
 * that adds the picked company to the watchlist.
 *
 * State lives in an inner component mounted only while open — closing the
 * palette remounts it fresh (no reset effects).
 */

import { useEffect, useRef, useState } from 'react'
import { Gavel, Receipt, Search } from 'lucide-react'
import { useAppStore } from '@/lib/store/app-store'
import { detectSearchMode } from '@/core/search-mode'
import { allRecords, setWatched } from '@/lib/registry'
import { useRegistryVersion } from '@/lib/use-registry'
import { searchCompanies } from '@/lib/api-client'
import { toast } from 'sonner'
import { familyBadgeClass, grp, initials } from '@/components/proto/primitives'

const isKnownActive = (s?: string) => !!s && /фаол|faol|active|мавжуд|mavjud/i.test(s)
const statusText = (s?: string) => {
  if (!s) return ''
  const v = s.toLowerCase()
  if (v.includes('фаол') || v.includes('faol') || v.includes('active') || v.includes('мавжуд') || v.includes('mavjud')) return 'Faoliyatda'
  if (v.includes('тўхтатилган') || v.includes("to'xtatilgan") || v.includes('suspended')) return "Toʻxtatilgan"
  if (v.includes('тугатилган') || v.includes('tugatilgan') || v.includes('liquidat')) return 'Tugatilgan'
  return s
}
const statusBadge = (s?: string) => (s ? (isKnownActive(s) ? 'b-pos' : /тўхтатилган|тугатилган|tugatilgan|suspended|liquidat/i.test(s) ? 'b-neg' : 'b-warn') : 'b-neu')

interface Row {
  key: string
  icon: React.ReactNode
  title: string
  sub: string
  badge?: React.ReactNode
  run: () => void
}

export function CommandPalette() {
  const open = useAppStore((s) => s.commandOpen)
  const setOpen = useAppStore((s) => s.setCommandOpen)

  // Global open shortcuts (⌘K / ⌘F / /)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === 'k' || e.key === 'f') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!useAppStore.getState().commandOpen)
      }
      if (e.key === '/' && !useAppStore.getState().commandOpen) {
        const target = e.target as HTMLElement
        if (['INPUT', 'TEXTAREA'].includes(target.tagName)) return
        e.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [setOpen])

  if (!open) return null
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="cmdk" role="dialog" aria-label="Qidiruv">
        <PaletteInner />
      </div>
    </div>
  )
}

function PaletteInner() {
  const setOpen = useAppStore((s) => s.setCommandOpen)
  const purpose = useAppStore((s) => s.commandPurpose)
  const openCompany = useAppStore((s) => s.openCompany)
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const [remote, setRemote] = useState<{ q: string; results: { tin: string; name: string }[] }>({ q: '', results: [] })
  const [remoteBusy, setRemoteBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const rv = useRegistryVersion()

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [])

  const detected = detectSearchMode(query)
  const modeLabel =
    detected.mode === 'stir' ? 'STIR' : detected.mode === 'invoice' ? 'Kvitansiya' : detected.mode === 'caseNumber' ? 'Ish raqami' : detected.mode === 'pinfl' ? 'PINFL' : query ? 'Nom' : 'STIR'

  // Live orginfo lookup for free-text (name) queries — debounced, abortable
  useEffect(() => {
    const q = query.trim()
    if (detected.mode !== 'unknown' || q.length < 3) return
    const ac = new AbortController()
    const t = setTimeout(() => {
      setRemoteBusy(true)
      searchCompanies(q, ac.signal)
        .then((res) => setRemote({ q, results: res.ok ? (res.data.results?.slice(0, 6) ?? []) : [] }))
        .catch(() => setRemote({ q, results: [] }))
        .finally(() => setRemoteBusy(false))
    }, 350)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [query, detected.mode])

  // Reset selection when the query changes (adjust-during-render pattern)
  const [prevQuery, setPrevQuery] = useState(query)
  if (prevQuery !== query) {
    setPrevQuery(query)
    setSel(0)
  }

  const pickCompany = (stir: string, name?: string) => {
    // Capture the target section BEFORE closing (close clears pendingSection).
    const target = useAppStore.getState().pendingSection ?? undefined
    setOpen(false)
    if (purpose === 'add') {
      setWatched(stir, name, true)
      toast.success('Kuzatuvga qoʻshildi', { description: name || `STIR ${grp(stir)}` })
      return
    }
    openCompany(stir, { name }, target)
  }

  const q = query.trim().toLowerCase()
  const rows: Row[] = []

  if (detected.mode === 'caseNumber' && q) {
    rows.push({
      key: 'case',
      icon: <Gavel />,
      title: `Ishni ochish: ${query.trim().toUpperCase()}`,
      sub: 'sud ishi tafsiloti',
      run: () => {
        setOpen(false)
        const stir = useAppStore.getState().activeCompany?.stir || allRecords()[0]?.stir
        if (stir) {
          openCompany(stir)
          useAppStore.getState().setSection('cases')
          setTimeout(
            () => window.dispatchEvent(new CustomEvent('sud:open-case', { detail: { caseNumber: query.trim(), courtType: 'economic' } })),
            350,
          )
        } else {
          toast.warning('Avval kompaniya kerak')
        }
      },
    })
  }
  if (detected.mode === 'invoice' && q.replace(/\s/g, '').length >= 6) {
    rows.push({
      key: 'invoice',
      icon: <Receipt />,
      title: 'Kvitansiyani tekshirish',
      sub: query.trim(),
      run: () => {
        setOpen(false)
        const stir = useAppStore.getState().activeCompany?.stir || allRecords()[0]?.stir
        if (stir) {
          openCompany(stir)
          useAppStore.getState().setSection('bills')
        } else {
          toast.warning('Avval kompaniya kerak')
        }
      },
    })
  }
  if (detected.mode === 'stir' && /^\d{9}$/.test(q.replace(/\s/g, ''))) {
    const digits = q.replace(/\s/g, '')
    rows.push({
      key: 'stir',
      icon: <Search />,
      title: `Ochish: ${grp(digits)}`,
      sub: "STIR boʻyicha ish maydoni",
      run: () => pickCompany(digits),
    })
  }

  const local = allRecords()
    .filter((r) => !q || r.stir.includes(q) || (r.name || '').toLowerCase().includes(q))
    .slice(0, 6)
  for (const r of local) {
    const meta = r.meta
    rows.push({
      key: `c-${r.stir}`,
      icon: <span className="mono-tile">{r.name ? initials(r.name) : grp(r.stir).slice(0, 2)}</span>,
      title: r.name || `STIR ${grp(r.stir)}`,
      sub: `STIR ${grp(r.stir)}${meta?.cases !== undefined ? ` · ${meta.cases} ish` : ''}${meta?.rating ? ` · reyting ${meta.rating}` : ''}`,
      badge: meta?.status ? (
        <span className={`badge ${familyBadgeClass(statusBadge(meta.status))}`}>{statusText(meta.status)}</span>
      ) : undefined,
      run: () => pickCompany(r.stir, r.name),
    })
  }
  if (remote.q === query.trim()) {
    for (const r of remote.results) {
      if (local.some((l) => l.stir === r.tin)) continue
      rows.push({
        key: `r-${r.tin}`,
        icon: <span className="mono-tile">{r.name ? initials(r.name) : grp(r.tin).slice(0, 2)}</span>,
        title: r.name || `STIR ${grp(r.tin)}`,
        sub: `STIR ${grp(r.tin)} · orginfo.uz`,
        run: () => pickCompany(r.tin, r.name),
      })
    }
  }

  const selIdx = Math.max(0, Math.min(sel, rows.length - 1))

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel(Math.min(selIdx + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel(Math.max(selIdx - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      rows[selIdx]?.run()
    }
  }

  useEffect(() => {
    listRef.current?.querySelectorAll('.cmdk-item')[selIdx]?.scrollIntoView({ block: 'nearest' })
  }, [selIdx])

  return (
    <>
      <div className="cmdk-in">
        <Search />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="STIR (9), kvitansiya (12), ish raqami (4-…) yoki nom…"
          autoComplete="off"
        />
        <span className="cmdk-mode">{purpose === 'add' ? 'Kuzatuvga' : modeLabel}</span>
      </div>
      <div className="cmdk-list" ref={listRef}>
        {rows.length > 0 && (
          <div className="cmdk-cap">{rows[0].key.startsWith('c-') || rows[0].key.startsWith('r-') ? 'Kompaniyalar' : 'Amal'}</div>
        )}
        {rows.map((r, i) => (
          <div key={r.key} className={`cmdk-item ${i === selIdx ? 'sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={r.run}>
            <div className="ci">{r.icon}</div>
            <div className="t">
              <b>{r.title}</b>
              <span>{r.sub}</span>
            </div>
            {r.badge}
          </div>
        ))}
        {remoteBusy && (
          <div className="cmdk-item" style={{ cursor: 'default' }}>
            <div className="ci">
              <span className="spinner" />
            </div>
            <div className="t">
              <b>Qidirilmoqda…</b>
              <span>orginfo.uz</span>
            </div>
          </div>
        )}
        {!remoteBusy && rows.length === 0 && query.trim() && (
          <div className="empty" style={{ padding: 26 }}>
            <div className="ico">
              <Search />
            </div>
            <h3>Topilmadi</h3>
            <p style={{ margin: 0 }}>«{query.trim()}» boʻyicha kompaniya yoʻq</p>
          </div>
        )}
        {!query.trim() && rows.length === 0 && (
          <div className="empty" style={{ padding: 26 }}>
            <div className="ico">
              <Search />
            </div>
            <h3>Qidiruv</h3>
            <p style={{ margin: 0 }}>STIR yoki kompaniya nomini kiriting</p>
          </div>
        )}
      </div>
      <div className="cmdk-foot">
        <span>
          <span className="kbd">↑↓</span> tanlash
        </span>
        <span>
          <span className="kbd">↵</span> ochish
        </span>
        <span>
          <span className="kbd">1–5</span> boʻlim
        </span>
        <span>
          <span className="kbd">esc</span> yopish
        </span>
      </div>
    </>
  )
}
