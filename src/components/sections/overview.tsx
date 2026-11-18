'use client'

/**
 * Statistika (v18) — the prototypeʼs Umumiy surface, rebuilt around the
 * interactive PIZZA chart: radial won/lost wedges per sud turi (or turkum),
 * click-to-select with blur-on-others, Sud turi ↔ Turkum dropdown and the
 * expandable detail panel whose «Ishlarni koʻrish» jumps to Sud ishlari
 * pre-filtered by the selected wedge (store caseCourtFilter / query event).
 *
 * Also v18: mini filter cards (Iqtisodiy / Fuqarolik / Maʼmuriy → Sud
 * ishlari), the in-page side-by-side company comparison (two real
 * dashboards, each with its own independent pizza; the single-company
 * dashboard hides while comparing), the ScrapeProgress first-load card and
 * the KPI row (jami ishlar · yutuq · kutilayotgan majlis · qarzdorlik).
 *
 * Data stays on the sanctioned rails: getStats + getUpcomingHearings through
 * useResource, bills totals from the bills cache. No synth data — both
 * comparison columns group the REAL CompanyStats.cases (the prototypeʼs
 * synthCourts/synthTurkum mocks are gone).
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { stillAhead } from '@/core/dates'
import { Activity, BarChart3, CalendarDays, CircleX, Clock, Gavel, Minus, Receipt, Scale, Timer, Trophy, Users, Wallet } from 'lucide-react'
import { SolidIcon, StatusIcon } from '@/components/ui-custom/solid-icons'
import {
  Kpi,
  BarChart,
  EmptyBlock,
  OutcomeBoard,
  grp,
  initials,
  familyBadgeClass,
} from '@/components/proto/primitives'
import { PartialBanner } from '@/components/ui-custom/states'
import { ScrapeProgress, SCRAPE_CFG } from '@/components/proto/scrape-progress'
import { DateTile, HearingWhen, dateParts } from '@/components/proto/date-tile'
import { courtItems, turkumItems, type PizzaItem } from '@/components/proto/pizza-geometry'
import { winRate as calcWinRate, winRateText } from '@/core/rates'
import { useResource } from '@/hooks/use-resource'
import { monthlyTrend } from '@/core/trend'
import { getStats, getUpcomingHearings } from '@/lib/api-client'
import { clearCached } from '@/lib/cache'
import type { CompanyStats } from '@/lib/api-types'
import type { UpcomingHearingsData } from '@/lib/api-types'
import { useAppStore } from '@/lib/store/app-store'
import { useTabCounts } from '@/lib/tab-counts'
import { patchMeta, patchRecord, companyFactsPatch, getRecord, allRecords, orderCasesPatch } from '@/lib/registry'
import { billsTotals, getCachedBills, subscribeBills, billsCacheVersion } from '@/lib/bills-cache'
import { billStatusFamilySafe } from './bills-helpers'
import { categoryLabel, courtTypeLabel, statusLabel as billStatusLabel, formatSum } from '@/core/billing-format'
import type { EnrichedBill } from '@/lib/api-types'
import { openReceipt } from '@/components/sections/bills'
import type { ResourceState } from '@/hooks/use-resource'
import { toast } from 'sonner'
import { reportAge } from '@/lib/data-age'
import { COMPANY_REFRESHED } from '@/lib/hard-refresh'

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']

/** Bills-cache version (primitive snapshot — safe for useSyncExternalStore). */
function useBillsVersion(): number {
  return useSyncExternalStore(subscribeBills, billsCacheVersion, () => 0)
}

/** Integer soʻm formatting for the KPI cards. */
const fmtSumShort = (tiyins: number): string => formatSum(tiyins).split(',')[0]

/** Decision-row metadata — the prototypeʼs CASE_META (icon/label/band/text). */
const DECISION_META: Record<string, { icon: React.ReactNode; label: string; band: string; text: string }> = {
  win: { icon: <StatusIcon family="win" size={20} />, label: 'Yutgan', band: 'positive', text: "Yutgan" },
  lose: { icon: <StatusIcon family="lose" size={20} />, label: 'Yutqazgan', band: 'negative', text: "Yutqazgan" },
  pending: { icon: <StatusIcon family="pending" size={20} />, label: 'Jarayonda', band: 'warning', text: "Koʻrib chiqilmoqda" },
  neutral: { icon: <StatusIcon family="neutral" size={20} />, label: 'Neytral', band: 'neutral', text: "Neytral yakunlangan" },
}

// ---- v18: side-by-side comparison (inside Statistika) --------------------------

/** One compact company dashboard: identity + KPIs + interactive pizza + bars. */
function CompanyStatsCol({ d, rating }: { d: CompanyStats; rating?: string | null }) {
  const s = d.summary
  const wr = calcWinRate(s.win, s.lose)
  const [mode, setMode] = useState<'court' | 'turkum'>('court')
  const items = useMemo(
    () => (mode === 'court' ? courtItems(d.cases) : turkumItems(d.cases)),
    [d.cases, mode],
  )
  const [selIdx, setSelIdx] = useState(-1)

  return (
    <div className="cmp-co">
      <div className="co-h">
        <span className="av">{d.company.name ? initials(d.company.name) : grp(d.company.tin).slice(0, 2)}</span>
        <div className="nm">
          <b>{d.company.name || d.company.tin}</b>
          <div className="faint mono" style={{ fontSize: 10.5 }}>STIR {grp(d.company.tin)}</div>
        </div>
      </div>
      <div className="co-kpis">
        <div className="co-kpi"><div className="k">Jami ishlar</div><div className="v">{s.total}</div></div>
        <div className="co-kpi"><div className="k">Yutuq</div><div className="v">{winRateText(s.win, s.lose)}</div></div>
        <div className="co-kpi"><div className="k">Jarayonda</div><div className="v">{s.pending}</div></div>
        <div className="co-kpi">
          <div className="k">Reyting</div>
          <div className="v" style={{ fontFamily: 'var(--font-sans)' }}>
            {rating ? <span className="badge b-neu">{rating}</span> : <span className="faint">-</span>}
          </div>
        </div>
      </div>
      <div className="cmp-pie-h">
        <span className="co-sub" style={{ margin: 0 }}>Ishlar taqsimoti</span>
        <span style={{ flex: 1 }} />
        <select
          className="pie-filter"
          value={mode}
          aria-label="Filtr"
          onChange={(e) => {
            setMode(e.target.value as 'court' | 'turkum')
            setSelIdx(-1)
          }}
        >
          <option value="court">Sud turi</option>
          <option value="turkum">Turkum</option>
        </select>
      </div>
      {items.length ? (
        <OutcomeBoard
          items={items}
          selected={selIdx}
          onSelect={(_, i) => setSelIdx((prev) => (prev === i ? -1 : i))}
          kind={mode === 'court' ? 'Sud turi' : 'Turkum'}
          tilesLabel={mode === 'court' ? 'Sud turi boʻyicha' : 'Turkum boʻyicha'}
        />
      ) : (
        <div className="empty" style={{ padding: 26 }}><h3>Maʼlumot yoʻq</h3></div>
      )}
    </div>
  )
}

/** In-page comparison panel — two REAL companies, fetched stats-first. */
function ComparePanel({ base, onClose }: { base: CompanyStats; onClose: () => void }) {
  const others = allRecords().filter((r) => r.stir !== base.company.tin)
  const [stir, setStir] = useState('')
  const [loading, setLoading] = useState(false)
  const [other, setOther] = useState<CompanyStats | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const baseRating = allRecords().find((r) => r.stir === base.company.tin)?.meta?.rating

  const load = (s: string) => {
    setStir(s)
    setOther(null)
    setErr(null)
    if (!s) return
    setLoading(true)
    void (async () => {
      try {
        // §6 stats-first: one summary wave for the second TIN — its per-TIN
        // token bucket is independent, so nothing is starved; details stay
        // deferred and the result memoizes for 10 min server-side.
        const res = await getStats(s)
        if (res.ok) setOther(res.data)
        else setErr(res.error)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Xatolik')
      } finally {
        setLoading(false)
      }
    })()
  }

  return (
    <div className="p-card rise-c cmp-panel">
      <div className="card-h">
        <div className="ico"><Users /></div>
        <h2>Yonma-yon solishtirish</h2>
        <div className="sp" />
        <select className="pie-filter" value={stir} aria-label="Ikkinchi kompaniya" onChange={(e) => load(e.target.value)}>
          <option value="">Kompaniyani tanlang…</option>
          {others.map((o) => (
            <option key={o.stir} value={o.stir}>{o.name || `STIR ${grp(o.stir)}`}</option>
          ))}
        </select>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={onClose}>Yopish</button>
      </div>

      {!stir ? (
        <div className="empty" style={{ padding: 26 }}>
          <div className="ico"><Users /></div>
          <h3>Ikkinchi kompaniyani tanlang</h3>
          <p>Ikkala kompaniya bir vaqtda parallel yuklanadi va statistikasi yonma-yon chiqadi.</p>
        </div>
      ) : loading ? (
        <div className="cmp-lanes">
          {[base.company.name || grp(base.company.tin), others.find((o) => o.stir === stir)?.name || grp(stir)].map((nm, i) => (
            <div className="cmp-lane" key={i}>
              <div className="lane-h">
                <span className="dot" style={{ background: i === 0 ? 'var(--accent)' : 'var(--neu-base)' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nm}</span>
                <span style={{ flex: 1 }} />
                <span className="spinner" style={{ width: 12, height: 12 }} />
              </div>
              <div className="stream-bar" style={{ margin: '0 0 7px' }}>
                <div className="stream-fill" style={{ width: i === 0 ? '100%' : '38%' }} />
              </div>
              <div className="faint mono" style={{ fontSize: 11 }}>
                holat: {i === 0 ? 'tayyor (keshda)' : 'olinmoqda'}
              </div>
            </div>
          ))}
        </div>
      ) : err ? (
        <div className="alert err">
          <Gavel />
          <div className="at">
            <b>Solishtirib boʻlmadi</b>
            <p>{err}</p>
          </div>
        </div>
      ) : other ? (
        <>
          <div className="cmp-grid">
            <CompanyStatsCol d={base} rating={baseRating} />
            <CompanyStatsCol d={other} rating={allRecords().find((r) => r.stir === other.company.tin)?.meta?.rating} />
          </div>
          <div className="faint" style={{ fontSize: 11.5, marginTop: 14, display: 'flex', alignItems: 'flex-start', gap: 7, lineHeight: 1.5 }}>
            <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} style={{ flex: 'none', marginTop: 1 }}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8h.01M11 12h1v4h1" />
            </svg>
            <span>
              Har bir kompaniya alohida STIR — token-bucket alohida, shuning uchun ikkalasi parallel yuklanadi. Statistika birinchi,
              tafsilotlar keyin (deferred), 10 daqiqa keshlanadi.
            </span>
          </div>
        </>
      ) : null}
    </div>
  )
}

// ---- Statistika body -----------------------------------------------------------

function OverviewBody({ data, stir, onOpenCompare }: { data: CompanyStats; stir: string; onOpenCompare: () => void }) {
  const setSection = useAppStore((s) => s.setSection)
  const setCaseCourtFilter = useAppStore((s) => s.setCaseCourtFilter)
  const s = data.summary
  const winRate = calcWinRate(s.win, s.lose)
  const trend = monthlyTrend(data.cases)
  const hotIdx = trend.reduce((best, t, i) => (t.count > trend[best].count ? i : best), 0)

  // v18 pizza state: mode (Sud turi ↔ Turkum) + selected wedge
  const [pieMode, setPieMode] = useState<'court' | 'turkum'>('court')
  const pieItems = useMemo(
    () => (pieMode === 'court' ? courtItems(data.cases) : turkumItems(data.cases)),
    [data.cases, pieMode],
  )
  // -1 = nothing selected: the pie shows every slice crisp until one is picked
  const [pieSel, setPieSel] = useState(-1)
  const pieSelClamped = pieSel >= 0 && pieSel < pieItems.length ? pieItems[pieSel] : null

  // Bills cache (written by the Bills section stream) — KPI 4
  const billsV = useBillsVersion()
  const bt = billsTotals(stir)

  // Upcoming hearings (shared cache with the Hearings section)
  const hearings = useResource<UpcomingHearingsData>((signal) => getUpcomingHearings(stir, signal), {
    cacheKey: `upcoming:${stir}`,
  })
  const hView = hearings.state as ResourceState<UpcomingHearingsData>
  // the cached list outlives its dates: count and show only hearings that have not passed
  const hearingsAhead =
    hView.status === 'success' || hView.status === 'partial'
      ? stillAhead((hView.data.hearings ?? []) as unknown as Record<string, unknown>[], (h) => h.isoDate as string | undefined)
      : null
  const upcomingCount = hearingsAhead ? hearingsAhead.length : null
  const nextHearing = hearingsAhead?.[0]

  // Recent bills (3 newest non-cancelled receipts from the cache)
  const recentBills = useMemo(() => {
    const items = getCachedBills(stir) ?? []
    return items
      .filter((b) => ((b.detail?.invoiceStatus ?? b.invoiceStatus) as string | null) !== 'CANCELLED')
      .sort((a, b) => (b.issued ?? 0) - (a.issued ?? 0))
      .slice(0, 3)
  }, [stir, billsV])

  // Recent decisions (3 latest decided cases)
  const recentDecided = useMemo(() => {
    const decided = data.cases.filter((c) => c.classification === 'win' || c.classification === 'lose' || c.classification === 'neutral')
    const pool = decided.length > 0 ? decided : data.cases
    return [...pool].sort((a, b) => b.regDate.localeCompare(a.regDate)).slice(0, 3)
  }, [data.cases])

  const openCase = (caseNumber: string, courtType?: string) => {
    setSection('cases')
    setTimeout(() => window.dispatchEvent(new CustomEvent('sud:open-case', { detail: { caseNumber, courtType: courtType || 'economic' } })), 120)
  }

  /** «Ishlarni koʻrish» / mini cards → Sud ishlari pre-filtered. */
  const goCasesFiltered = (court?: string, query?: string) => {
    if (court) setCaseCourtFilter(court as 'economic' | 'civil' | 'administrative')
    if (query) window.dispatchEvent(new CustomEvent('sud:cases-query', { detail: { query } }))
    setSection('cases')
  }

  const nh = dateParts(nextHearing?.isoDate as string | undefined)


  return (
    <div className="stat-flow">
      <div className="kpis">
        <Kpi label="Jami sud ishlari" icon={<SolidIcon name="gavel" />} foot={<>{s.win} yutgan · {s.lose} yutqazgan · {s.total - s.win - s.lose} boshqa</>}>
          <span>{s.total}</span>
        </Kpi>
        <Kpi
          label="Yutuq darajasi" icon={<SolidIcon name="trophy" />}
          foot={winRate === null ? 'Hal qilingan ish yoʻq' : <>{s.win} yutgan / {s.win + s.lose} ta hal qilingan ishdan</>}
        >
          <span>{winRateText(s.win, s.lose)}</span>
        </Kpi>
        <Kpi
          label="Kutilayotgan majlis" icon={<SolidIcon name="calendar-blank" />}
          foot={upcomingCount !== null ? <>{upcomingCount} ta majlis belgilangan</> : 'Majlislar boʻlimida yuklanadi'}
        >
          <span>{upcomingCount ?? '-'}</span>
        </Kpi>
        <Kpi
          label="Umumiy qarzdorlik" icon={<SolidIcon name="wallet" />}
          foot={bt.loaded ? (bt.overdue > 0 ? 'BPI orqali undiruv' : 'Qarzdorlik yoʻq') : "Toʻlovlar boʻlimida yuklanadi"}
        >
          <span style={{ fontSize: 18, color: bt.overdue > 0 ? 'var(--neg-text)' : undefined }}>
            {bt.loaded ? fmtSumShort(bt.overdue) : '-'}
          </span>
        </Kpi>
      </div>

      {/* pizza + detail — the v18 heart of Statistika */}
      <div className="p-card rise-c">
        <div className="card-h">
          <h2>Sud ishlari taqsimoti</h2>
          <div className="sp" />
          <select
            className="pie-filter"
            value={pieMode}
            aria-label="Filtr"
            onChange={(e) => {
              setPieMode(e.target.value as 'court' | 'turkum')
              setPieSel(-1)
            }}
          >
            <option value="court">Sud turi boʻyicha</option>
            <option value="turkum">Turkum boʻyicha</option>
          </select>
        </div>
        {pieItems.length ? (
          <OutcomeBoard
            items={pieItems}
            selected={pieSel}
            onSelect={(_, i) => setPieSel((prev) => (prev === i ? -1 : i))}
            kind={pieMode === 'court' ? 'Sud turi' : 'Turkum'}
            tilesLabel={pieMode === 'court' ? 'Sud turi boʻyicha' : 'Turkum boʻyicha'}
            action={
              <button
                className="btn btn-outline btn-sm"
                onClick={() =>
                  pieSelClamped
                    ? goCasesFiltered(pieMode === 'court' ? pieSelClamped.id : undefined, pieMode === 'turkum' ? pieSelClamped.full : undefined)
                    : goCasesFiltered()
                }
              >
                Ishlarni koʻrish
              </button>
            }
          />
        ) : (
          <EmptyBlock icon={<BarChart3 />} title="Maʼlumot yoʻq" hint="Bu STIR boʻyicha tasniflangan ish topilmadi." />
        )}
      </div>

      <div className="p-card rise-c">
        <div className="card-h">
          <div className="ico"><Activity /></div>
          <h2>Oylik faollik</h2>
          <div className="sp" />
          <span className="badge b-neu">{new Date().getFullYear()}</span>
        </div>
        <BarChart
          data={trend.map((t) => t.count)}
          labels={trend.map((t) => t.label)}
          hotIdx={hotIdx}
          unit=" ish"
          onBarClick={(_, v, l) => toast(`${l} · ${v} ish`)}
        />
        <div className="faint" style={{ fontSize: 11.5, marginTop: 6, textAlign: 'center' }}>
          Ustunni bosing · oʻsha oydagi ishlar
        </div>
      </div>

      <div className="dash" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="p-card rise-c">
          <div className="card-h">
            <div className="ico"><Scale /></div>
            <h2>Solishtirish</h2>
          </div>
          <p className="faint" style={{ fontSize: 13, margin: '0 0 14px', lineHeight: 1.5 }}>
            Ikkinchi kompaniyani tanlang: ikkalasining natijalari yonma-yon, bir xil shkalada chiqadi.
          </p>
          <button className="btn btn-outline btn-sm" style={{ width: '100%' }} onClick={onOpenCompare}>
            <Users />
            <span>Boshqa kompaniya bilan solishtirish</span>
          </button>
        </div>
        <div className="p-card rise-c">
          <div className="card-h">
            <div className="ico"><CalendarDays /></div>
            <h2>Keyingi majlis</h2>
          </div>
          {nh && nextHearing ? (
            <div className="datecard now" data-goto="hearings" onClick={() => setSection('hearings')}>
              <DateTile iso={nextHearing.isoDate as string} near />
              <div className="dc-body">
                <b>{(nextHearing.courtName as string) || (nextHearing.courtTypeLabel as string) || 'Sud'}</b>
                <span>
                  {dateParts(nextHearing.isoDate as string)?.weekday}
                  {` · Ish ${(nextHearing.caseNumber as string) || '-'}`}
                  {nextHearing.judge ? ` · sudya ${nextHearing.judge as string}` : ''}
                </span>
              </div>
              <HearingWhen iso={nextHearing.isoDate as string} time={nextHearing.hearingTime as string} />
            </div>
          ) : (
            <EmptyBlock icon={<CalendarDays />} title="Majlis yoʻq" />
          )}
        </div>
      </div>

      <div className="section-head" style={{ margin: '22px 0 14px' }}>
        <h2>So&apos;nggi faoliyat</h2>
        <span className="faint" style={{ fontSize: 12 }}>· toʻlovlar va qarorlar</span>
      </div>
      <div className="dash" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="p-card rise-c">
          <div className="card-h">
            <div className="ico"><Receipt /></div>
            <h2>Soʻnggi toʻlovlar</h2>
            <div className="sp" />
            <button className="btn btn-ghost btn-xs" onClick={() => setSection('bills')}>
              Barchasi ›
            </button>
          </div>
          <div className="list">
            {recentBills.length === 0 && (
              <div className="faint" style={{ fontSize: 12.5, padding: '8px 4px' }}>
                Toʻlovlar hali yuklanmagan. Toʻlovlar boʻlimini oching.
              </div>
            )}
            {recentBills.map((b, i) => {
              const d = b.detail
              const status = d?.invoiceStatus ?? b.invoiceStatus
              const fam = billStatusFamilySafe(status)
              return (
                <div className="lrow" key={`${b.number}-${i}`} data-bill={b.number} onClick={() => openReceipt(b, stir)}>
                  <div className="lead"><Receipt /></div>
                  <div className="main-c">
                    <b className="mono">{b.number}</b>
                    <div className="sub">
                      {d?.payCategory ? categoryLabel(d.payCategory).label : 'Toʻlov'} · {d?.court || courtTypeLabel(d?.courtType) || '-'}
                    </div>
                  </div>
                  <span className={`badge ${familyBadgeClass(fam)}`}>{billStatusLabel(status)}</span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="p-card rise-c">
          <div className="card-h">
            <div className="ico"><Gavel /></div>
            <h2>Soʻnggi qarorlar</h2>
            <div className="sp" />
            <button className="btn btn-ghost btn-xs" onClick={() => setSection('cases')}>
              Barchasi ›
            </button>
          </div>
          <div className="list">
            {recentDecided.length === 0 && <div className="faint" style={{ fontSize: 12.5, padding: '8px 4px' }}>Maʼlumot yoʻq</div>}
            {recentDecided.map((c) => {
              const meta = DECISION_META[c.classification] ?? DECISION_META.neutral
              return (
                <div className="lrow" key={c.caseNumber} data-case={c.caseNumber} onClick={() => openCase(c.caseNumber, c.courtType)}>
                  <div className={`lead ${c.classification === 'win' ? 'ink' : ''}`}>{meta.icon}</div>
                  <div className="main-c">
                    <b className="mono">{c.caseNumber}</b>
                    <div className="sub">{c.result?.trim() || meta.text}</div>
                  </div>
                  <span className={`badge ${familyBadgeClass(meta.band)}`}>{meta.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function OverviewView({
  stir,
  force = false,
  onOpenCompare,
  onData,
}: {
  stir: string
  force?: boolean
  onOpenCompare: () => void
  onData?: (d: CompanyStats) => void
}) {
  const patchCompany = useAppStore((s) => s.patchCompany)
  const setCasesCount = useTabCounts((s) => s.set)
  // v208: force=true (Yangilash) skips the server-side stats/court caches too.
  const { state, elapsed, meta, refetch } = useResource<CompanyStats>(
    (signal, f) => getStats(stir, { signal, force: force || f }),
    { cacheKey: `stats:${stir}`, persist: false, isEmpty: (d) => d.cases.length === 0 && Object.keys(d.company || {}).length === 0 },
  )

  // the header shows how old the dossier is
  useEffect(() => {
    const ok = state.status === 'success' || state.status === 'partial'
    reportAge(stir, 'stats', ok ? meta?.fetchedAt : undefined, meta?.stale)
  }, [state.status, meta, stir])

  // Hydrate identity + cached meta once stats land
  useEffect(() => {
    if (state.status === 'success' || state.status === 'partial') {
      const d = state.data
      // the company's name, status and chamber rating go to the registry from every answer (the home card shows
      // «STIR …» and a stale rating until they do); the case counts only from a COMPLETE one: a court site that failed
      // counts too few cases
      const facts = companyFactsPatch(d, meta?.fetchedAt)
      patchRecord(stir, { name: facts.name, meta: facts.meta })
      // the header (context bar) shows the same name and rating as soon as the stats land, whichever tab is open
      if (facts.name) patchCompany({ name: facts.name })
      // the header shows what the REGISTRY holds after the write, not this answer's rating: a day-old snapshot's one
      // must not roll back a fresher reading
      const held = getRecord(stir)?.meta
      if (held?.rating) patchCompany({ rating: { category: held.rating, score: held.score ?? null } })
      if (state.status === 'success' && d.errors.length === 0) {
        const wr = calcWinRate(d.summary.win, d.summary.lose)
        patchMeta(stir, { cases: d.summary.total, ...orderCasesPatch(d.cases), winRate: wr ?? undefined })
      }
      setCasesCount({ cases: d.summary.total })
      onData?.(d)
    }
  }, [state.status, stir])

  const view = state as ResourceState<CompanyStats>

  // v18: the ScrapeProgress card replaces the blank skeleton on first load
  if (view.status === 'idle' || view.status === 'loading')
    return <ScrapeProgress {...SCRAPE_CFG.overview} elapsed={elapsed} />
  if (view.status === 'error')
    return (
      <EmptyBlock
        icon={<Gavel />}
        title="Statistika olinmadi"
        hint={view.error}
        action={
          <button className="btn btn-outline btn-sm" onClick={() => void refetch()}>
            Qayta urinish
          </button>
        }
      />
    )
  if (view.status === 'empty')
    return <EmptyBlock icon={<Gavel />} title="Maʼlumot topilmadi" hint="Bu STIR boʻyicha sud ishlari topilmadi yoki manbalar javob bermadi." />

  return (
    <div>
      {view.status === 'partial' && <PartialBanner errors={view.partialErrors} onRetry={() => window.dispatchEvent(new CustomEvent('sud:force-section'))} />}
      <OverviewBody data={view.data} stir={stir} onOpenCompare={onOpenCompare} />
    </div>
  )
}

export function OverviewSection() {
  const company = useAppStore((s) => s.activeCompany)
  const [reloadKey, setReloadKey] = useState(0)
  /** the last reload was a forced one (a section-level retry); a company switch or the header's refresh is not */
  const [forced, setForced] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [baseStats, setBaseStats] = useState<CompanyStats | null>(null)

  useEffect(() => {
    // a section-level retry (partial banner): the server must re-scrape, not replay its snapshot
    const force = () => {
      if (company) clearCached(`upcoming:${company.stir}`)
      setForced(true)
      setReloadKey((k) => k + 1)
    }
    // the header's hard refresh already scraped everything: just read it again
    const refreshed = () => {
      setForced(false)
      setReloadKey((k) => k + 1)
    }
    window.addEventListener('sud:force-section', force)
    window.addEventListener(COMPANY_REFRESHED, refreshed)
    return () => {
      window.removeEventListener('sud:force-section', force)
      window.removeEventListener(COMPANY_REFRESHED, refreshed)
    }
  }, [company])

  if (!company) return null

  return (
    <div className={`stat-view${comparing ? ' comparing' : ''}`}>
      {comparing && baseStats && <ComparePanel base={baseStats} onClose={() => setComparing(false)} />}
      <OverviewView
        key={`${company.stir}-${reloadKey}`}
        stir={company.stir}
        force={forced}
        onOpenCompare={() => setComparing(true)}
        onData={setBaseStats}
      />
    </div>
  )
}
