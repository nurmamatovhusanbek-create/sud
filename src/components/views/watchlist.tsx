'use client'

/**
 * Watchlist — the prototypeʼs Kuzatuv surface: hero, the imminent-hearings
 * alert strip, the upcoming datecards and the watched companies grid with
 * hover-remove. Data is enriched per company (stats + hearings, staggered)
 * and cached into the registry meta so home cards and the bell stay in sync.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CalendarDays, Eye, Plus, X } from 'lucide-react'
import { EmptyBlock, Ring, bandOf, familyDotClass, familyBadgeClass, grp, initials } from '@/components/proto/primitives'
import { useAppStore } from '@/lib/store/app-store'
import { patchMeta, setWatched, watched, type CompanyRecord } from '@/lib/registry'
import { useRegistryVersion } from '@/lib/use-registry'
import { getStats, getUpcomingHearings } from '@/lib/api-client'
import { toast } from 'sonner'

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']

const isKnownActive = (s?: string) => !!s && /фаол|faol|active|мавжуд|mavjud/i.test(s)

const statusLabel = (s?: string) => {
  if (!s) return ''
  const v = s.toLowerCase()
  if (v.includes('фаол') || v.includes('faol') || v.includes('active') || v.includes('мавжуд') || v.includes('mavjud')) return 'Faoliyatda'
  if (v.includes('тўхтатилган') || v.includes("to'xtatilgan") || v.includes('suspended')) return "Toʻxtatilgan"
  if (v.includes('тугатилган') || v.includes('tugatilgan') || v.includes('liquidat')) return 'Tugatilgan'
  return s
}

interface HearingRow {
  stir: string
  name?: string
  isoDate: string
  court?: string
  caseNumber?: string
  time?: string
  judge?: string
}

function RatingBadge({ rating }: { rating?: string | null }) {
  if (!rating) return null
  const letter = rating.trim().toUpperCase()[0]
  const band = letter === 'A' ? 'pos' : letter === 'B' ? 'warn' : letter === 'C' || letter === 'D' ? 'neg' : 'neu'
  return <span className={`badge ${familyBadgeClass(band)}`}>Reyting {rating}</span>
}

function RemovableCard({ rec, onUnwatch }: { rec: CompanyRecord; onUnwatch: (stir: string) => void }) {
  const openCompany = useAppStore((s) => s.openCompany)
  const meta = rec.meta
  const wr = meta?.winRate
  const iso = meta?.nextHearingIso
  const inactive = !!meta?.status && !isKnownActive(meta.status) && /тўхтатилган|тугатилган|tugatilgan|suspended|liquidat/i.test(meta.status)
  return (
    <div className="ccard" onClick={() => openCompany(rec.stir, { name: rec.name })}>
      <button
        className="ccard-x"
        title="Kuzatuvdan olib tashlash"
        onClick={(e) => {
          e.stopPropagation()
          onUnwatch(rec.stir)
        }}
      >
        <X />
      </button>
      <div className="ccard-top">
        <div className="mono-tile">{initials(rec.name || '')}</div>
        <RatingBadge rating={meta?.rating} />
      </div>
      <h3>{rec.name || `STIR ${grp(rec.stir)}`}</h3>
      <div className="p-row" style={{ gap: 8 }}>
        {meta?.status && (
          <span className={`p-dot ${familyDotClass(isKnownActive(meta.status) ? 'positive' : inactive ? 'negative' : 'neutral')}`} />
        )}
        <span className="stir">{grp(rec.stir)}</span>
        {meta?.status && <span className="faint" style={{ fontSize: 11 }}>· {statusLabel(meta.status)}</span>}
      </div>
      <div className="ccard-foot">
        <Ring pct={wr ?? 0} size={52} band={wr === undefined ? 'neu' : bandOf(wr)} />
        <div className="mini">
          <b>{meta?.cases ?? '-'}</b>
          <span>Ishlar</span>
        </div>
        {iso && !inactive ? (
          (() => {
            const [, m, d] = iso.split('-').map(Number)
            return (
              <span className="hearing-pill b-warn">
                <CalendarDays />
                {`${String(d).padStart(2, '0')} ${MONTHS[m - 1] ?? ''}`}
              </span>
            )
          })()
        ) : (
          <span className="hearing-pill b-neu">
            <CalendarDays />
            Majlis yoʻq
          </span>
        )}
      </div>
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
  useEffect(() => {
    if (!hydrated) return
    const list = watched()
    const timers: ReturnType<typeof setTimeout>[] = []
    list.forEach((w, idx) => {
      if (enrichedRef.current.has(w.stir)) return
      enrichedRef.current.add(w.stir)
      timers.push(
        setTimeout(() => {
          void (async () => {
            try {
              const [stats, hearings] = await Promise.allSettled([getStats(w.stir), getUpcomingHearings(w.stir)])
              if (stats.status === 'fulfilled' && stats.value.ok) {
                const s = stats.value.data
                patchMeta(w.stir, {
                  cases: s.summary.total,
                  winRate: s.summary.total ? Math.round((s.summary.win / s.summary.total) * 100) : 0,
                  status: s.company?.status,
                })
              }
              if (hearings.status === 'fulfilled' && hearings.value.ok) {
                const h = hearings.value.data.hearings[0] as Record<string, unknown> | undefined
                if (h?.isoDate) {
                  patchMeta(w.stir, {
                    nextHearingIso: h.isoDate as string,
                    nextHearingCourt: (h.courtName as string) || (h.courtTypeLabel as string) || undefined,
                    nextHearingCase: (h.caseNumber as string) || undefined,
                    nextHearingTime: (h.hearingTime as string) || undefined,
                    nextHearingJudge: (h.judge as string) || undefined,
                  })
                }
              }
              setTick((t) => t + 1)
            } catch {
              /* best-effort enrichment */
            }
          })()
        }, idx * 350),
      )
    })
    return () => timers.forEach(clearTimeout)
  }, [hydrated, items.length])

  const alerts = useMemo(() => {
    const out: HearingRow[] = []
    const now = Date.now()
    for (const w of items) {
      const iso = w.meta?.nextHearingIso
      if (!iso) continue
      const [y, m, d] = iso.split('-').map(Number)
      const days = Math.ceil((new Date(y, m - 1, d).getTime() - now) / 86_400_000)
      if (days >= 0 && days <= 7) {
        out.push({
          stir: w.stir,
          name: w.name,
          isoDate: iso,
          court: w.meta?.nextHearingCourt,
          caseNumber: w.meta?.nextHearingCase,
          time: w.meta?.nextHearingTime,
          judge: w.meta?.nextHearingJudge,
        })
      }
    }
    return out.sort((a, b) => a.isoDate.localeCompare(b.isoDate))
  }, [items])

  const upcoming = useMemo(
    () =>
      items
        .flatMap((w) =>
          w.meta?.nextHearingIso
            ? [
                {
                  stir: w.stir,
                  name: w.name,
                  isoDate: w.meta.nextHearingIso,
                  court: w.meta.nextHearingCourt,
                  caseNumber: w.meta.nextHearingCase,
                  time: w.meta.nextHearingTime,
                  judge: w.meta.nextHearingJudge,
                },
              ]
            : [],
        )
        .sort((a, b) => a.isoDate.localeCompare(b.isoDate)),
    [items],
  )

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
              {alerts
                .map((a) => {
                  const p = isoParts(a.isoDate)
                  return `${(a.name || a.stir).slice(0, 16)} · ${p.d} ${p.m}`
                })
                .join(' · ')}
            </p>
          </div>
        </div>
      )}

      <div className="section-head">
        <h2>Yaqinlashayotgan majlislar</h2>
        <span className="count">{upcoming.length}</span>
      </div>
      <div className="p-card rise-c">
        {upcoming.length === 0 ? (
          <EmptyBlock icon={<CalendarDays />} title="Majlis yoʻq" hint="Kuzatuvdagi kompaniyalar boʻyicha rejalashtirilgan majlis topilmadi." />
        ) : (
          <div className="datecards" style={{ flexDirection: 'column' }}>
            {upcoming.map((h, i) => {
              const p = isoParts(h.isoDate)
              // Prototype: .now marks hearings inside the 7-day alert window
              const near = alerts.some((a) => a.stir === h.stir && a.isoDate === h.isoDate)
              return (
                <div key={`${h.stir}-${i}`} className={`datecard ${near ? 'now' : ''}`} onClick={() => openCompany(h.stir, { name: h.name })}>
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
          <RemovableCard key={c.stir} rec={c} onUnwatch={unwatch} />
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
