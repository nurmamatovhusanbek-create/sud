'use client'

/**
 * Home / Launcher — the prototypeʼs home view: eyebrow + display headline,
 * hero search with live mode hint, removable recent chips, the four overview
 * KPIs and the companies grid (ring-gauge cards) with Barchasi/Faol/Xavfli
 * filter. Cards render registry-cached meta; unknown values stay neutral.
 */

import { useMemo, useState, useSyncExternalStore } from 'react'
import { BarChart3, CalendarDays, Gavel, RefreshCw, Search, Trash2, Users, Wallet, X } from 'lucide-react'
import { useAppStore } from '@/lib/store/app-store'
import { detectSearchMode } from '@/core/search-mode'
import { recents, removeRecent, removeRecord, allRecords } from '@/lib/registry'
import { useRegistryVersion } from '@/lib/use-registry'
import { searchCompanies } from '@/lib/api-client'
import { enrichCompany } from '@/lib/enrich'
import { toast } from 'sonner'
import { CountUp, Kpi, Seg, CardStats, grp, initials } from '@/components/proto/primitives'
import type { CompanyRecord } from '@/lib/registry'

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']

const isKnownActive = (s?: string) =>
  !!s && /фаол|faol|active|мавжуд|mavjud/i.test(s)
const isKnownInactive = (s?: string) =>
  !!s && /тўхтатилган|тугатилган|to'xtatilgan|to‘xtatilgan|tugatilgan|suspended|liquidat/i.test(s)

function CompanyCard({ rec, onRefresh, onDelete }: {
  rec: CompanyRecord
  onRefresh: (stir: string) => Promise<void>
  onDelete: (stir: string) => void
}) {
  const openCompany = useAppStore((s) => s.openCompany)
  const [refreshing, setRefreshing] = useState(false)
  const meta = rec.meta

  const refresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (refreshing) return
    setRefreshing(true)
    void onRefresh(rec.stir)
      .catch(() => toast.error('Yangilashda xatolik — manbalar javob bermadi'))
      .finally(() => setRefreshing(false))
  }

  return (
    <div className="ccard" data-open={rec.stir} onClick={() => openCompany(rec.stir, { name: rec.name })}>
      <div className="cc-head">
        <div className="mono-tile">{initials(rec.name || '')}</div>
        <div className="cc-id">
          <div className="nm">{rec.name || `STIR ${grp(rec.stir)}`}</div>
          <div className="tin">{grp(rec.stir)}</div>
        </div>
        <div className="ccard-tools">
          <button className="ccard-act" title="Yangilash" aria-label="Yangilash" onClick={refresh}>
            {refreshing ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <RefreshCw />}
          </button>
          {/* Delete only removes a searched company from this list — watched
              companies are managed in Kuzatuv, so they show no delete here. */}
          {!rec.watched && (
            <button
              className="ccard-act ccard-act-danger"
              title="Roʻyxatdan oʻchirish"
              aria-label="Oʻchirish"
              onClick={(e) => { e.stopPropagation(); onDelete(rec.stir) }}
            >
              <X />
            </button>
          )}
        </div>
      </div>
      <CardStats score={meta?.score} rating={meta?.rating} hearingIso={meta?.nextHearingIso} />
    </div>
  )
}

const noopSubscribe = () => () => {}

export function Launcher() {
  const openCompany = useAppStore((s) => s.openCompany)
  const setSection = useAppStore((s) => s.setSection)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'risk'>('all')
  const [searching, setSearching] = useState(false)
  const [refreshingAll, setRefreshingAll] = useState(false)
  const rv = useRegistryVersion()

  // Hydration-safe listing: registry is localStorage-backed (renders after
  // hydration via useSyncExternalStore — no setState-in-effect).
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)

  const companies = useMemo(() => {
    if (!hydrated) return [] as CompanyRecord[]
    const seen = new Map<string, CompanyRecord>()
    for (const r of allRecords()) seen.set(r.stir, r)
    return [...seen.values()]
  }, [hydrated, rv])

  const recentList = useMemo(() => (hydrated ? recents().slice(0, 5) : []), [hydrated, rv])

  const detected = useMemo(() => detectSearchMode(query), [query])
  const modeLabel =
    detected.mode === 'stir' ? 'STIR' : detected.mode === 'invoice' ? 'Kvitansiya' : detected.mode === 'caseNumber' ? 'Ish raqami' : detected.mode === 'pinfl' ? 'PINFL' : query ? 'Nom' : ''

  const totCases = companies.reduce((a, c) => a + (c.meta?.cases ?? 0), 0)
  const nearHearings = companies.filter((c) => c.meta?.nextHearingIso).length

  // Nearest known hearing across listed companies (prototype: "Eng yaqini — 16 Sen")
  const nearest = useMemo(() => {
    const isos = companies.map((c) => c.meta?.nextHearingIso).filter((v): v is string => !!v).sort()
    return isos[0]
  }, [companies])

  // Prototype KPI 4: total overdue debt across companies with known billing
  const overdueTotal = companies.reduce((a, c) => a + (c.meta?.overdueTotal ?? 0), 0)
  const overdueCompanies = companies.filter((c) => (c.meta?.overdueTotal ?? 0) > 0).length

  const resolve = async (raw: string) => {
    const d = detectSearchMode(raw)
    if (!raw.trim()) return
    if (d.mode === 'stir') {
      openCompany(d.normalized)
      return
    }
    if (d.mode === 'pinfl') {
      toast.info('PINFL qidiruvi', { description: 'Jismoniy shaxslar boʻyicha sud ishlari boʻlimida qidiriladi.' })
      openCompany(d.normalized)
      return
    }
    if (d.mode === 'invoice') {
      // Straight into the bills section of the active (or first known) company
      const stir = useAppStore.getState().activeCompany?.stir || recentList[0]?.stir || companies[0]?.stir
      if (stir) {
        openCompany(stir)
        setSection('bills')
      } else {
        toast.warning('Avval kompaniya kerak', { description: 'Kvitansiyani tekshirish uchun STIR kiriting.' })
      }
      return
    }
    if (d.mode === 'caseNumber') {
      const stir = useAppStore.getState().activeCompany?.stir || recentList[0]?.stir || companies[0]?.stir
      if (stir) {
        openCompany(stir)
        setSection('cases')
        toast.info('Ish raqami bilan qidiring', { description: `Sud ishlari boʻlimida «${raw}» ni kiriting.` })
      } else {
        toast.warning('Avval kompaniya kerak', { description: 'Ish raqami kompaniya kontekstida qidiriladi.' })
      }
      return
    }
    // name → orginfo search
    setSearching(true)
    const res = await searchCompanies(raw)
    setSearching(false)
    if (res.ok && res.data.results?.length) {
      const first = res.data.results[0]
      openCompany(first.tin, { name: first.name })
    } else if (res.ok) {
      toast.warning('Topilmadi', { description: `«${raw}» boʻyicha kompaniya topilmadi.` })
    } else {
      toast.error(res.error)
    }
  }

  const filtered = companies.filter((c) => {
    if (filter === 'active') return isKnownActive(c.meta?.status)
    if (filter === 'risk') return isKnownInactive(c.meta?.status) || (c.meta?.overdueTotal ?? 0) > 0
    return true
  })

  // ---- refresh + delete --------------------------------------------------
  const refreshOne = (stir: string): Promise<void> =>
    enrichCompany(stir, true).then((ok) => { if (!ok) throw new Error('refresh failed') })

  const refreshAll = async () => {
    if (refreshingAll || filtered.length === 0) return
    setRefreshingAll(true)
    let ok = 0
    for (const c of filtered) {
      if (await enrichCompany(c.stir, true)) ok++
    }
    setRefreshingAll(false)
    toast.success(`${ok}/${filtered.length} kompaniya yangilandi`)
  }

  // Delete removes a single searched (non-watched) company from the list.
  const deleteOne = (stir: string) => {
    removeRecord(stir)
    toast.success('Roʻyxatdan oʻchirildi')
  }

  // «Tozalash» clears every searched company but keeps the ones in Kuzatuv.
  const searchedCount = companies.filter((c) => !c.watched).length
  const clearSearched = () => {
    const searched = companies.filter((c) => !c.watched)
    if (searched.length === 0) {
      toast('Tozalash uchun qidirilgan kompaniya yoʻq')
      return
    }
    searched.forEach((c) => removeRecord(c.stir))
    toast.success(`${searched.length} ta qidirilgan kompaniya tozalandi`)
  }

  return (
    <div>
      <div className="hero">
        <div className="eyebrow">Kompaniyalarni kuzatish tizimi</div>
        <h1>
          Kompaniyani <span className="g2">toping,</span> hammasini <span className="g2">bir joyda</span> koʻring.
        </h1>
        <p>
          STIR (9 xonali), kvitansiya (12 xonali) yoki ish raqamini kiriting. Toʻlovlar, sud ishlari, majlislar va
          reyting bitta ish maydoniga jamlanadi.
        </p>
        <div className="hero-search">
          <label className="field">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void resolve(query)
              }}
              inputMode="text"
              placeholder="STIR raqamini kiriting…"
              autoComplete="off"
            />
            {modeLabel && <span className="modehint">{modeLabel}</span>}
          </label>
          <button className="btn btn-primary" onClick={() => void resolve(query)} disabled={!query.trim() || searching}>
            {searching ? <span className="spinner" /> : <BarChart3 />}
            <span>{searching ? 'Qidirilmoqda…' : 'Ochish'}</span>
          </button>
        </div>
        <div className="chips">
          <span className="faint" style={{ fontSize: 12 }}>Soʻnggi:</span>
          {recentList.length === 0 && <span className="faint" style={{ fontSize: 12 }}>· hali qidiruv yoʻq</span>}
          {recentList.map((r) => (
            <span key={r.stir} className="chip" onClick={() => openCompany(r.stir, { name: r.name })} role="button">
              {grp(r.stir)}
              <span
                className="rm"
                role="button"
                aria-label="Olib tashlash"
                onClick={(e) => {
                  e.stopPropagation()
                  removeRecent(r.stir)
                }}
              >
                <X />
              </span>
            </span>
          ))}
        </div>
      </div>

      <div className="kpis" style={{ marginTop: 24 }}>
        <Kpi label="Kompaniyalar" icon={<Users />} ink foot="Kuzatuv + soʻnggi">
          <CountUp value={companies.length} id="lnch-companies" />
        </Kpi>
        <Kpi
          label="Jami sud ishlari"
          icon={<Gavel />}
          foot={
            <>
              <span className="p-dot d-pos" />
              {companies.filter((c) => isKnownActive(c.meta?.status)).length} faol kompaniya
            </>
          }
        >
          <CountUp value={totCases} id="lnch-cases" />
        </Kpi>
        <Kpi
          label="Yaqin majlislar"
          icon={<CalendarDays />}
          foot={
            <>
              <span className="p-dot d-warn" />
              {nearest
                ? `Eng yaqini · ${(() => {
                    const [, m, d] = nearest.split('-').map(Number)
                    return `${String(d).padStart(2, '0')} ${MONTHS[m - 1] ?? ''}`
                  })()}`
                : 'Majlis topilmadi'}
            </>
          }
        >
          <CountUp value={nearHearings} id="lnch-hearings" />
        </Kpi>
        <Kpi label="Umumiy qarzdorlik" icon={<Wallet />} foot={`${overdueCompanies} kompaniyada`}>
          <span style={{ fontSize: 19 }}>
            <CountUp value={Math.round(overdueTotal / 1e6)} suffix="" id="lnch-overdue" />
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}> mln soʻm</span>
          </span>
        </Kpi>
      </div>

      <div className="section-head">
        <h2>Kompaniyalar</h2>
        <span className="count">{filtered.length}</span>
        <div className="sp" />
        <div className="p-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline btn-sm" onClick={() => void refreshAll()} disabled={refreshingAll || filtered.length === 0}>
            {refreshingAll ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <RefreshCw />}Yangilash
          </button>
          <button className="btn btn-outline btn-sm" onClick={clearSearched} disabled={searchedCount === 0} title="Qidirilgan kompaniyalarni tozalash (Kuzatuvdagilar qoladi)">
            <Trash2 />Tozalash
          </button>
          <Seg
            options={[
              { key: 'all', label: 'Barchasi' },
              { key: 'active', label: 'Faol' },
              { key: 'risk', label: 'Xavfli' },
            ]}
            value={filter}
            onChange={(k) => setFilter(k as typeof filter)}
          />
        </div>
      </div>
      <div className="ccards">
        {filtered.map((c, i) => (
          <div key={c.stir} className="rise" style={{ ['--i' as string]: Math.min(i, 10) }}>
            <CompanyCard rec={c} onRefresh={refreshOne} onDelete={deleteOne} />
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            <div className="ico">
              <Users />
            </div>
            <h3>Kompaniya topilmadi</h3>
            <p>STIR kiriting yoki kompaniya nomi boʻyicha qidiring. Natijalar shu yerda jamlanadi.</p>
          </div>
        )}
      </div>
    </div>
  )
}
