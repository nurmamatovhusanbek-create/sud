'use client'

/**
 * Watchlist — the prototypeʼs Kuzatuv surface: hero, the imminent-hearings
 * alert strip, the upcoming datecards and the watched companies grid with
 * hover-remove. Data is enriched per company (stats + hearings, staggered)
 * and cached into the registry meta so home cards and the bell stay in sync.
 */

import { winRate } from '@/core/rates'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, CalendarDays, ChevronDown, Eye, FileText, Pause, Play, Plus, RefreshCw, X } from 'lucide-react'
import { EmptyBlock, CardStats, grp, initials } from '@/components/proto/primitives'
import { useAppStore } from '@/lib/store/app-store'
import { daysUntilIso, futureUpcoming, hearingMetaPatch, orderCasesPatch, patchMeta, setWatched, watched, type CompanyRecord, type UpcomingHearing } from '@/lib/registry'
import { useRegistryVersion } from '@/lib/use-registry'
import { getStats, getUpcomingHearings } from '@/lib/api-client'
import { toast } from 'sonner'
import { OrdersControl } from '@/components/views/orders-control'

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']

interface HearingRow {
  stir: string
  name?: string
  isoDate: string
  court?: string
  caseNumber?: string
  time?: string
  judge?: string
}

function RemovableCard({ rec, onUnwatch, onRefresh }: { rec: CompanyRecord; onUnwatch: (stir: string) => void; onRefresh: (stir: string) => Promise<void> }) {
  const openCompany = useAppStore((s) => s.openCompany)
  const meta = rec.meta
  const [refreshing, setRefreshing] = useState(false)
  const refresh = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (refreshing) return
    setRefreshing(true)
    void onRefresh(rec.stir)
      .catch(() => toast.error('Yangilashda xatolik — manbalar javob bermadi'))
      .finally(() => setRefreshing(false))
  }
  return (
    <div className="ccard" onClick={() => openCompany(rec.stir, { name: rec.name })}>
      <div className="cc-head">
        <div className="mono-tile">{initials(rec.name || '')}</div>
        <div className="cc-id">
          <div className="nm">{rec.name || `STIR ${grp(rec.stir)}`}</div>
          <div className="tin">{grp(rec.stir)}</div>
        </div>
        {/* Hover tools (top-right): refresh + remove — unchanged behavior. */}
        <div className="ccard-tools">
          <button className="ccard-act" title="Yangilash" aria-label="Yangilash" onClick={refresh}>
            {refreshing ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <RefreshCw />}
          </button>
          <button
            className="ccard-act ccard-act-danger"
            title="Kuzatuvdan olib tashlash"
            aria-label="Kuzatuvdan olib tashlash"
            onClick={(e) => {
              e.stopPropagation()
              onUnwatch(rec.stir)
            }}
          >
            <X />
          </button>
        </div>
      </div>
      <CardStats score={meta?.score} rating={meta?.rating} hearingIso={meta?.nextHearingIso} />
    </div>
  )
}

export function WatchlistView() {
  const openCompany = useAppStore((s) => s.openCompany)
  const setCommandOpen = useAppStore((s) => s.setCommandOpen)
  const setCommandPurpose = useAppStore((s) => s.setCommandPurpose)
  const rv = useRegistryVersion()
  const [hydrated, setHydrated] = useState(false)
  const [tick, setTick] = useState(0)
  const enrichedRef = useRef<Set<string>>(new Set())

  useEffect(() => setHydrated(true), [])

  const items = useMemo(() => (hydrated ? watched() : []), [hydrated, rv, tick])

  // Staggered enrichment — mirrors the shipped watchlist optimization; results
  // land in registry meta so every surface (home, bell) benefits. Each company
  // is enriched once per mount (no fetch loop from registry-change bumps).
  // v204 (P-E): extracted into enrichCompany() so the per-card refresh button
  // can re-run it for ONE company; also stores the chamber rating (score +
  // category) that getStats already fetches.
  // v206: `force` — the per-card refresh passes force=true so the server
  // bypasses its 60s caches (stats route clears the court-case cache for the
  // TIN; statsCache itself is skipped). Forced runs go SEQUENTIAL (stats →
  // hearings) so the hearings read sees the freshly-cleared court cache.
  // Both sources failing now THROWS so the card can toast the error —
  // before, failures were swallowed and the button looked dead.
  const enrichCompany = useRef(async (stir: string, force = false): Promise<void> => {
    if (!force && enrichedRef.current.has(stir)) return
    enrichedRef.current.add(stir)
    let statsOk = false
    let hearingsOk = false
    try {
      const applyStats = (res: Awaited<ReturnType<typeof getStats>>) => {
        // a PARTIAL answer (a court site failed) counts too few cases: writing them would lower what a complete one learned
        if (res.ok && !(res.partial && res.partial.length > 0) && res.data.errors.length === 0) {
          statsOk = true
          const s = res.data
          patchMeta(stir, {
            cases: s.summary.total,
            ...orderCasesPatch(s.cases),
            winRate: winRate(s.summary.win, s.summary.lose) ?? undefined,
            // a source that did not answer must not erase what an earlier refresh learned (status «Faoliyatda», rating)
            ...(s.company?.status ? { status: s.company.status } : {}),
            ...(s.rating ? { rating: s.rating.category, score: s.rating.score } : {}),
          })
        }
      }
      const applyHearings = (res: Awaited<ReturnType<typeof getUpcomingHearings>>) => {
        if (res.ok) {
          hearingsOk = true
          // the WHOLE upcoming list goes to the registry (not just the first hearing); an empty list is never written
          // (the server used to answer «no hearings» when a court site did not respond)
          const hs = (res.data.hearings as unknown as Record<string, unknown>[]) || []
          if (hs.some((h) => h?.isoDate)) patchMeta(stir, hearingMetaPatch(hs))
        }
      }
      if (force) {
        applyStats(await getStats(stir, { force: true }).catch(() => ({ ok: false } as Awaited<ReturnType<typeof getStats>>)))
        applyHearings(await getUpcomingHearings(stir).catch(() => ({ ok: false } as Awaited<ReturnType<typeof getUpcomingHearings>>)))
      } else {
        const [stats, hearings] = await Promise.allSettled([getStats(stir), getUpcomingHearings(stir)])
        if (stats.status === 'fulfilled') applyStats(stats.value)
        if (hearings.status === 'fulfilled') applyHearings(hearings.value)
      }
    } catch {
      /* best-effort enrichment */
    } finally {
      setTick((t) => t + 1)
    }
    if (!statsOk && !hearingsOk) {
      throw new Error('enrichment failed: both sources unavailable')
    }
  }).current

  useEffect(() => {
    if (!hydrated) return
    const list = watched()
    const timers: ReturnType<typeof setTimeout>[] = []
    list.forEach((w, idx) => {
      timers.push(setTimeout(() => void enrichCompany(w.stir), idx * 350))
    })
    return () => timers.forEach(clearTimeout)
  }, [hydrated, items.length, enrichCompany])

  /** Per-card refresh: forget the one-shot guard and re-enrich with fresh data. */
  const refreshCompany = (stir: string): Promise<void> => {
    enrichedRef.current.delete(stir)
    return enrichCompany(stir, true)
  }

  // The registry meta is the ONE source for hearings (enrichment writes the company's whole upcoming list there), so the
  // alert, the list and the «Barchasi» toggle always agree, and a failed / empty reload can never blank them out.
  // Only hearings that are still ahead count: a stale «next hearing» that has passed is not upcoming.
  const rowOf = (w: CompanyRecord, h: UpcomingHearing): HearingRow => ({ stir: w.stir, name: w.name, isoDate: h.iso, court: h.court, caseNumber: h.caseNumber, time: h.time, judge: h.judge })
  const byDate = (a: HearingRow, b: HearingRow) => a.isoDate.localeCompare(b.isoDate) || (a.time || '').localeCompare(b.time || '')

  /** EVERY upcoming hearing of every watched company */
  const upcomingAll = useMemo(() => items.flatMap((w) => futureUpcoming(w.meta).map((h) => rowOf(w, h))).sort(byDate), [items])
  /** each company's next hearing only (the collapsed list) */
  const nextPerCompany = useMemo(
    () => items.flatMap((w) => { const h = futureUpcoming(w.meta)[0]; return h ? [rowOf(w, h)] : [] }).sort(byDate),
    [items],
  )

  /** hearings within the next 7 days — all of them, several per company included */
  const alerts = useMemo(() => {
    const now = Date.now()
    return upcomingAll.filter((h) => { const d = daysUntilIso(h.isoDate, now); return d !== null && d <= 7 })
  }, [upcomingAll])

  /** the alert line: one entry per company and day («×2» when it has several that day) — the headline counts every hearing */
  const alertSummary = useMemo(() => {
    const groups = new Map<string, { row: HearingRow; n: number }>()
    for (const a of alerts) {
      const k = `${a.stir}|${a.isoDate}`
      const g = groups.get(k)
      if (g) g.n++
      else groups.set(k, { row: a, n: 1 })
    }
    return [...groups.values()]
  }, [alerts])

  // «Barchasi»: shows every upcoming hearing at once (from the cache) and refreshes them from the courts meanwhile.
  // A refresh that fails or comes back empty NEVER replaces what is cached — an empty answer can mean «the court site
  // did not answer», so only a non-empty list is written.
  const [showAll, setShowAll] = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)

  const refreshHearings = async (): Promise<void> => {
    await Promise.all(
      watched().map(async (w) => {
        try {
          const res = await getUpcomingHearings(w.stir)
          if (!res.ok) return
          const hs = (res.data.hearings as unknown as Record<string, unknown>[]) || []
          if (hs.some((h) => h?.isoDate)) patchMeta(w.stir, hearingMetaPatch(hs))
        } catch {
          /* keep the cache */
        }
      }),
    )
  }

  const toggleAll = async () => {
    if (loadingAll) return
    if (showAll) {
      setShowAll(false)
      return
    }
    if (items.length === 0) return
    setShowAll(true) // instant, from the cache
    setLoadingAll(true)
    try {
      await refreshHearings()
    } finally {
      setLoadingAll(false)
    }
  }

  const shownRows = showAll ? upcomingAll : nextPerCompany

  const unwatch = (stir: string) => {
    setWatched(stir, undefined, false)
    toast.success('Kuzatuvdan olib tashlandi')
  }

  const isoParts = (iso: string) => {
    const [, m, d] = iso.split('-').map(Number)
    return { d: String(d).padStart(2, '0'), m: MONTHS[m - 1] ?? '' }
  }

  return (
    <div>
      <div className="hero" style={{ marginBottom: 0 }}>
        <div className="eyebrow">Koʻp kompaniyali monitoring</div>
        <h1>
          Kuzatuv <span className="g2">roʻyxati</span>
        </h1>
        <p>Belgilangan kompaniyalar bo&apos;yicha yaqinlashayotgan majlislar, yutuq va reyting · bir qarashda.</p>
      </div>

      {alerts.length > 0 && (
        <div className="alert warn" style={{ marginTop: 18 }}>
          <AlertTriangle />
          <div className="at">
            <b>{alerts.length} ta majlis 7 kun ichida</b>
            <p>
              {alertSummary
                .map(({ row: a, n }) => {
                  const p = isoParts(a.isoDate)
                  return `${(a.name || a.stir).slice(0, 16)} · ${p.d} ${p.m}${n > 1 ? ` ×${n}` : ''}`
                })
                .join(' · ')}
            </p>
          </div>
        </div>
      )}

      <div
        className="section-head sh-click"
        role="button"
        tabIndex={0}
        title="Barcha kuzatuvdagi kompaniyalar majlislarini koʻrsatish"
        onClick={() => void toggleAll()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && void toggleAll()}
      >
        <h2>Yaqinlashayotgan majlislar</h2>
        <span className="count">{shownRows.length}</span>
        <div className="sp" />
        <span className="faint sh-hint">
          {loadingAll ? (
            <><span className="spinner" style={{ width: 13, height: 13 }} />Yuklanmoqda…</>
          ) : showAll ? (
            <>Yaqinlarini koʻrsatish<ChevronDown style={{ transform: 'rotate(180deg)' }} /></>
          ) : (
            <>Barcha majlislar<ChevronDown /></>
          )}
        </span>
      </div>
      <div className="p-card rise-c">
        {shownRows.length === 0 ? (
          <EmptyBlock icon={<CalendarDays />} title="Majlis yoʻq" hint="Kuzatuvdagi kompaniyalar boʻyicha rejalashtirilgan majlis topilmadi." />
        ) : (
          <div className="datecards" style={{ flexDirection: 'column' }}>
            {shownRows.map((h, i) => {
              const p = isoParts(h.isoDate)
              // Prototype: .now marks hearings inside the 7-day alert window
              const near = alerts.some((a) => a.stir === h.stir && a.isoDate === h.isoDate)
              return (
                <div key={`${h.stir}-${i}`} className={`datecard ${near ? 'now' : ''}`} onClick={() => openCompany(h.stir, { name: h.name }, 'hearings')}>
                  <div className="dc-date">
                    <div className="d">{p.d}</div>
                    <div className="m">{p.m}</div>
                  </div>
                  <div className="dc-body">
                    <b>{(h.name || h.stir).slice(0, 24)} · {h.court || 'Sud'}</b>
                    <span>
                      Ish {h.caseNumber || '-'}
                      {h.judge ? ` · ${h.judge}` : ''}
                    </span>
                  </div>
                  <div className="dc-time">{h.time || ''}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="section-head">
        <h2>Kuzatuvdagi kompaniyalar</h2>
        <span className="count">{items.length}</span>
        <div className="sp" />
        <OrdersControl companies={items.length} registryVersion={rv} />
        <button
          className="btn btn-outline btn-sm"
          onClick={() => {
            setCommandPurpose('add')
            setCommandOpen(true)
          }}
        >
          <Plus />
          <span>Kompaniya qoʻshish</span>
        </button>
      </div>
      <div className="ccards">
        {items.map((c) => (
          <RemovableCard key={c.stir} rec={c} onUnwatch={unwatch} onRefresh={refreshCompany} />
        ))}
        {items.length === 0 && (
          <div className="empty" style={{ gridColumn: '1/-1' }}>
            <div className="ico">
              <Eye />
            </div>
            <h3>Kuzatuv roʻyxati boʻsh</h3>
            <p>Kompaniya ish maydonida «Kuzatish» tugmasi orqali qoʻshiladi.</p>
          </div>
        )}
      </div>
    </div>
  )
}
