'use client'

/**
 * Overview section — the prototypeʼs Umumiy: headline KPIs (win-rate ink),
 * monthly activity bars with hover tooltip, segmented outcome ring + legend,
 * win-rate-by-court rows, next-hearing date card, recent activity lists and
 * the company comparison drawer. Live data from getStats + upcoming hearings;
 * meta (cases/winRate) is cached back into the registry for the home cards.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Activity, BarChart3, CalendarDays, CircleX, Clock, Gavel, Minus, Receipt, Scale, Timer, Trophy, Users, Wallet } from 'lucide-react'
import { Kpi, Ring, BarChart, SkKpis, EmptyBlock, bandOf, grp, initials, familyBadgeClass } from '@/components/proto/primitives'
import { PartialBanner } from '@/components/ui-custom/states'
import { useResource } from '@/hooks/use-resource'
import { getStats, getUpcomingHearings } from '@/lib/api-client'
import { clearCached } from '@/lib/cache'
import type { CompanyStats } from '@/lib/api-types'
import type { UpcomingHearingsData } from '@/lib/api-types'
import { useAppStore } from '@/lib/store/app-store'
import { useTabCounts } from '@/lib/tab-counts'
import { patchMeta, allRecords } from '@/lib/registry'
import { billsTotals, getCachedBills, subscribeBills, billsCacheVersion } from '@/lib/bills-cache'
import { billStatusFamilySafe } from './bills-helpers'
import { categoryLabel, courtTypeLabel, statusLabel as billStatusLabel, formatSum } from '@/core/billing-format'
import type { EnrichedBill } from '@/lib/api-types'
import { openProtoDrawer } from '@/components/proto/drawer'
import { openReceipt } from '@/components/sections/bills'
import type { ResourceState } from '@/hooks/use-resource'
import { toast } from 'sonner'

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']

/** Bills-cache version (primitive snapshot — safe for useSyncExternalStore). */
function useBillsVersion(): number {
  return useSyncExternalStore(subscribeBills, billsCacheVersion, () => 0)
}

/** Integer soʻm formatting for the KPI cards (prototype shows "142 400 000"). */
const fmtSumShort = (tiyins: number): string => formatSum(tiyins).split(',')[0]

/** Decision-row metadata — the prototypeʼs CASE_META (icon/label/band/text). */
const DECISION_META: Record<string, { icon: React.ReactNode; label: string; band: string; text: string }> = {
  win: { icon: <Trophy />, label: 'Yutgan', band: 'positive', text: "Daʼvo toʻliq qanoatlantirildi" },
  lose: { icon: <CircleX />, label: 'Yutqazgan', band: 'negative', text: "Daʼvo qanoatlantirilmadi" },
  pending: { icon: <Clock />, label: 'Jarayonda', band: 'warning', text: "Koʻrib chiqilmoqda" },
  neutral: { icon: <Minus />, label: 'Neytral', band: 'neutral', text: "Neytral yakunlangan" },
}

function computeTrend(cases: CompanyStats['cases']): { label: string; count: number }[] {
  const now = new Date()
  const buckets: { label: string; count: number; key: string }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    buckets.push({ label: MONTHS[d.getMonth()], count: 0, key: `${d.getFullYear()}-${d.getMonth()}` })
  }
  for (const c of cases) {
    const m = c.regDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
    if (!m) continue
    const key = `${m[3]}-${Number(m[2]) - 1}`
    const b = buckets.find((x) => x.key === key)
    if (b) b.count++
  }
  return buckets
}

function WrRows({ cases }: { cases: CompanyStats['cases'] }) {
  const byCourt = useMemo(() => {
    const map = new Map<string, { win: number; total: number }>()
    for (const c of cases) {
      const e = map.get(c.courtType) || { win: 0, total: 0 }
      e.total++
      if (c.classification === 'win') e.win++
      map.set(c.courtType, e)
    }
    return [...map.entries()].map(([k, v]) => ({
      key: k,
      label: k === 'economic' ? 'Iqtisodiy' : k === 'civil' ? 'Fuqarolik' : k === 'administrative' ? "Maʼmuriy" : k,
      rate: v.total ? Math.round((v.win / v.total) * 100) : 0,
    }))
  }, [cases])
  if (!byCourt.length) return <div className="faint" style={{ fontSize: 12.5 }}>Maʼlumot yoʻq</div>
  return (
    <div>
      {byCourt.map((c) => (
        <div className="wr-row" key={c.key}>
          <span className="wr-lbl">{c.label}</span>
          <div className="wr-track">
            <div
              className="wr-fill"
              style={{ width: `${c.rate}%`, background: c.rate >= 60 ? 'var(--pos-base)' : c.rate >= 40 ? 'var(--warn-base)' : 'var(--neg-base)' }}
            />
          </div>
          <span className="wr-val">{c.rate}%</span>
        </div>
      ))}
    </div>
  )
}

// ---- Comparison drawer --------------------------------------------------------

function cmpColumn(d: CompanyStats, rating?: string | null, status?: string) {
  const s = d.summary
  const wr = s.total ? Math.round((s.win / s.total) * 100) : 0
  return (
    <div className="cmp-col">
      <div className="cmp-h">
        <div className="mono-tile" style={{ width: 36, height: 36, fontSize: 12 }}>
          {d.company.name ? initials(d.company.name) : grp(d.company.tin).slice(0, 2)}
        </div>
        <div style={{ minWidth: 0 }}>
          <b style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {d.company.name || d.company.tin}
          </b>
          <span className="faint mono" style={{ fontSize: 11 }}>{grp(d.company.tin)}</span>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
        <Ring pct={wr} size={84} band={bandOf(wr)} />
      </div>
      <div className="kv"><span className="k">Jami ishlar</span><b className="mono">{s.total}</b></div>
      <div className="kv"><span className="k">Yutgan / Yutqazgan</span><b className="mono">{s.win} / {s.lose}</b></div>
      <div className="kv"><span className="k">Jarayonda</span><b className="mono">{s.pending}</b></div>
      <div className="kv">
        <span className="k">Reyting</span>
        {rating ? <span className={`badge ${bandOf(letterBand(rating)) === 'pos' ? 'b-pos' : bandOf(letterBand(rating)) === 'warn' ? 'b-warn' : 'b-neg'}`}>{rating}</span> : <span className="faint">-</span>}
      </div>
      <div className="kv"><span className="k">Holat</span><span>{status || '-'}</span></div>
    </div>
  )
}

function letterBand(r: string): number {
  const l = r.trim().toUpperCase()[0]
  return l === 'A' ? 80 : l === 'B' ? 50 : 20
}

function openCompare(base: CompanyStats) {
  const others = allRecords().filter((r) => r.stir !== base.company.tin)
  const pick = (stir: string, name?: string) => {
    // fetch stats for the other company, then render the grid
    openProtoDrawer(
      'Kompaniyalarni solishtirish',
      <div>
        <div style={{ textAlign: 'center', padding: '30px 0' }}>
          <span className="spinner" />
          <div className="faint" style={{ marginTop: 10, fontSize: 12.5 }}>Statistika yuklanmoqda…</div>
        </div>
      </div>,
      base.company.name,
    )
    void (async () => {
      const res = await getStats(stir)
      if (!res.ok) {
        openProtoDrawer(
          'Kompaniyalarni solishtirish',
          <div className="alert err">
            <Gavel />
            <div className="at">
              <b>Solishtirib boʻlmadi</b>
              <p>{res.error}</p>
            </div>
          </div>,
          base.company.name,
        )
        return
      }
      const meta = allRecords().find((r) => r.stir === stir)?.meta
      openProtoDrawer(
        'Kompaniyalarni solishtirish',
        <div>
          <div className="cmp-grid" style={{ marginTop: 8 }}>
            {cmpColumn(base, allRecords().find((r) => r.stir === base.company.tin)?.meta?.rating)}
            {cmpColumn(res.data, meta?.rating, meta?.status)}
          </div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ width: '100%', marginTop: 12 }}
            onClick={() => openCompare(base)}
          >
            <Users />
            <span>Boshqasini tanlash</span>
          </button>
        </div>,
        name || base.company.name,
      )
    })()
  }

  openProtoDrawer(
    'Kompaniyalarni solishtirish',
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>Ikkinchi kompaniyani tanlang</div>
      <div className="list" id="cmpPick">
        {others.length === 0 && (
          <div className="empty" style={{ padding: 26 }}>
            <div className="ico"><Users /></div>
            <h3>Roʻyxat boʻsh</h3>
            <p>Avval boshqa kompaniyalarni oching. Soʻng ularni solishtirish mumkin.</p>
          </div>
        )}
        {others.map((o) => (
          <div
            key={o.stir}
            className="lrow"
            data-cmp={o.stir}
            onClick={() => pick(o.stir, o.name)}
          >
            <div className="mono-tile" style={{ width: 36, height: 36, fontSize: 12 }}>
              {o.name ? initials(o.name) : grp(o.stir).slice(0, 2)}
            </div>
            <div className="main-c">
              <b>{o.name || `STIR ${grp(o.stir)}`}</b>
              <div className="sub mono">STIR {grp(o.stir)}</div>
            </div>
            <span className="chev">›</span>
          </div>
        ))}
      </div>
    </div>,
    base.company.name,
  )
}

// ---- Overview body -------------------------------------------------------------

function OverviewBody({ data, stir }: { data: CompanyStats; stir: string }) {
  const setSection = useAppStore((s) => s.setSection)
  const openCompany = useAppStore((s) => s.openCompany)
  const s = data.summary
  const winRate = s.total ? Math.round((s.win / s.total) * 100) : 0
  const trend = computeTrend(data.cases)
  const hotIdx = trend.reduce((best, t, i) => (t.count > trend[best].count ? i : best), 0)
  const total = s.win + s.lose + s.pending + s.neutral

  // Bills cache (written by the Bills section stream) — prototype KPIs 3–4
  const billsV = useBillsVersion()
  const bt = billsTotals(stir)

  // Upcoming hearings (shared cache with the Hearings section)
  const hearings = useResource<UpcomingHearingsData>((signal) => getUpcomingHearings(stir, signal), {
    cacheKey: `upcoming:${stir}`,
  })
  const hView = hearings.state as ResourceState<UpcomingHearingsData>
  const nextHearing =
    hView.status === 'success' || hView.status === 'partial'
      ? (hView.data.hearings[0] as Record<string, unknown> | undefined)
      : undefined

  // Recent bills (prototype: 3 newest non-cancelled receipts from the cache)
  const recentBills = useMemo(() => {
    const items = getCachedBills(stir) ?? []
    return items
      .filter((b) => ((b.detail?.invoiceStatus ?? b.invoiceStatus) as string | null) !== 'CANCELLED')
      .sort((a, b) => (b.issued ?? 0) - (a.issued ?? 0))
      .slice(0, 3)
  }, [stir, billsV])

  // Recent decisions (prototype: 3 latest decided cases)
  const recentDecided = useMemo(() => {
    const decided = data.cases.filter((c) => c.classification === 'win' || c.classification === 'lose' || c.classification === 'neutral')
    const pool = decided.length > 0 ? decided : data.cases
    return [...pool].sort((a, b) => b.regDate.localeCompare(a.regDate)).slice(0, 3)
  }, [data.cases])

  const openCase = (caseNumber: string, courtType?: string) => {
    setSection('cases')
    setTimeout(() => window.dispatchEvent(new CustomEvent('sud:open-case', { detail: { caseNumber, courtType: courtType || 'economic' } })), 120)
  }

  const isoParts = (iso?: string) => {
    if (!iso) return null
    const [y, m, d] = iso.split('-').map(Number)
    const days = Math.ceil((new Date(y, m - 1, d).getTime() - Date.now()) / 86_400_000)
    return { d: String(d).padStart(2, '0'), m: MONTHS[m - 1] ?? '', days }
  }
  const nh = isoParts(nextHearing?.isoDate as string | undefined)

  return (
    <div>
      <div className="kpis">
        <Kpi label="Gʻalaba darajasi" icon={<Trophy />} ink foot={<>{s.win} yutgan / {s.total} ish</>}>
          <span>{winRate}%</span>
        </Kpi>
        <Kpi label="Jami ishlar" icon={<Gavel />} foot="3 sud turi boʻyicha">
          <span>{s.total}</span>
        </Kpi>
        <Kpi
          label="Toʻlangan boj"
          icon={<Wallet />}
          foot={bt.loaded ? <>{bt.paidCount} kvitansiya</> : "Toʻlovlar boʻlimida yuklanadi"}
        >
          <span style={{ fontSize: 18 }}>{bt.loaded ? fmtSumShort(bt.totalPaid) : '-'}</span>
        </Kpi>
        <Kpi
          label="Muddati oʻtgan"
          icon={<Timer />}
          foot={bt.overdue > 0 ? 'BPI orqali undiruv' : "Qarzdorlik yoʻq"}
        >
          <span style={{ fontSize: 18, color: bt.overdue > 0 ? 'var(--neg-text)' : undefined }}>
            {bt.loaded ? fmtSumShort(bt.overdue) : '-'}
          </span>
        </Kpi>
      </div>

      <div className="dash">
        <div className="p-card rise-c">
          <div className="card-h">
            <div className="ico"><Activity /></div>
            <h3>Oylik faollik</h3>
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
        <div className="p-card rise-c">
          <div className="card-h">
            <div className="ico"><BarChart3 /></div>
            <h3>Natijalar</h3>
          </div>
          <div className="p-row" style={{ gap: 18 }}>
            <Ring pct={total ? Math.round((s.win / total) * 100) : 0} size={96} band="pos" />
            <div className="legend" style={{ flex: 1 }}>
              {[
                { label: 'Yutgan', v: s.win, dot: 'd-pos' },
                { label: 'Yutqazgan', v: s.lose, dot: 'd-neg' },
                { label: 'Jarayonda', v: s.pending, dot: 'd-warn' },
                { label: 'Neytral', v: s.neutral, dot: 'd-neu' },
              ].map((r) => (
                <div className="lg-row" key={r.label}>
                  <span className={`p-dot ${r.dot}`} />
                  <span className="nm">{r.label}</span>
                  <span className="ct">{r.v}</span>
                  <span className="pc">{total ? Math.round((r.v / total) * 100) : 0}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="dash" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="p-card rise-c">
          <div className="card-h">
            <div className="ico"><Scale /></div>
            <h3>Sud turi boʻyicha yutuq</h3>
          </div>
          <WrRows cases={data.cases} />
          <button className="btn btn-outline btn-sm" style={{ width: '100%', marginTop: 14 }} onClick={() => openCompare(data)}>
            <Users />
            <span>Boshqa kompaniya bilan solishtirish</span>
          </button>
        </div>
        <div className="p-card rise-c">
          <div className="card-h">
            <div className="ico"><CalendarDays /></div>
            <h3>Keyingi majlis</h3>
          </div>
          {nh && nextHearing ? (
            <>
              <div
                className="datecard now"
                data-goto="hearings"
                onClick={() => setSection('hearings')}
              >
                <div className="dc-date">
                  <div className="d">{nh.d}</div>
                  <div className="m">{nh.m}</div>
                </div>
                <div className="dc-body">
                  <b>{(nextHearing.courtName as string) || (nextHearing.courtTypeLabel as string) || 'Sud'}</b>
                  <span>Ish {(nextHearing.caseNumber as string) || '-'}</span>
                </div>
                <div className="dc-time">{(nextHearing.hearingTime as string) || ''}</div>
              </div>
              <div className="faint" style={{ fontSize: 12, marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock style={{ width: 13, height: 13 }} />
                {nh.days >= 0 ? `${nh.days} kun qoldi` : 'Oʻtkazib yuborilgan'}
                {nextHearing.judge ? ` · sudya ${nextHearing.judge as string}` : ''}
              </div>
            </>
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
            <h3>Soʻnggi toʻlovlar</h3>
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
            <h3>Soʻnggi qarorlar</h3>
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
                    <div className="sub">{meta.text}</div>
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

function OverviewView({ stir, force = false }: { stir: string; force?: boolean }) {
  const patchCompany = useAppStore((s) => s.patchCompany)
  const setCasesCount = useTabCounts((s) => s.set)
  // v208: force=true (Yangilash) skips the server-side stats/court caches too —
  // before, a forced refresh only re-fetched what the client had already dropped.
  const { state, refetch } = useResource<CompanyStats>(
    (signal) => getStats(stir, { signal, force }),
    { cacheKey: `stats:${stir}`, isEmpty: (d) => d.cases.length === 0 && Object.keys(d.company || {}).length === 0 },
  )

  // Hydrate identity + cached meta once stats land
  useEffect(() => {
    if (state.status === 'success' || state.status === 'partial') {
      const d = state.data
      if (d.company?.name) patchCompany({ name: d.company.name })
      const wr = d.summary.total ? Math.round((d.summary.win / d.summary.total) * 100) : 0
      patchMeta(stir, { cases: d.summary.total, winRate: wr, status: d.company?.status })
      setCasesCount({ cases: d.summary.total })
    }
  }, [state.status, stir])

  const view = state as ResourceState<CompanyStats>

  if (view.status === 'idle' || view.status === 'loading')
    return (
      <div>
        <SkKpis />
        <div className="dash">
          <div className="p-card"><SkKpis n={1} /></div>
          <div className="p-card"><SkKpis n={1} /></div>
        </div>
      </div>
    )
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
      <OverviewBody data={view.data} stir={stir} />
    </div>
  )
}

export function OverviewSection() {
  const company = useAppStore((s) => s.activeCompany)
  const [forceKey, setForceKey] = useState(0)

  useEffect(() => {
    const handler = () => {
      // v208: Yangilash must bypass BOTH caches — drop the client-side
      // localStorage entries, then remount with force=1 so the server also
      // re-scrapes instead of replaying its 60s/10min memoized results.
      if (company) {
        clearCached(`stats:${company.stir}`)
        clearCached(`upcoming:${company.stir}`)
      }
      setForceKey((k) => k + 1)
    }
    window.addEventListener('sud:force-section', handler)
    return () => window.removeEventListener('sud:force-section', handler)
  }, [company])

  if (!company) return null

  return <OverviewView key={`${company.stir}-${forceKey}`} stir={company.stir} force={forceKey > 0} />
}
