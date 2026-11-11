'use client'

/**
 * «Yashil» lists — drawn fresh, not as the table of the other looks.
 *   GreenCompanies  companies as soft row cards under a row of sort pills
 *   GreenCases      a company's court cases as row cards led by an outcome orb
 *   GreenAgenda     hearings as a week of date pills over a day-by-day timeline
 * Props mirror components/newui so a view picks the look with one switch (components/screens).
 */

import { useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowDown, ArrowUp, CalendarDays, Check, ChevronRight, Clock, Minus, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { WEEKDAYS_SHORT, calendarDaysUntil, groupByDay, longDate, relativeDay, weekStrip, type AgendaDay } from '@/core/agenda'
import { formatSumCompact, groupDigits } from '@/core/billing-format'
import { avatarHue, nextSort, sortCompanies, type CompanySortKey, type SortDir } from '@/core/company-sort'
import { classifyOutcome } from '@/core/classify'
import { daysUntil } from '@/core/dates'
import { caseClassificationFamily, companyStatusFamily, ratingBandFamily } from '@/core/status'
import { familyBadgeClass, familyDotClass, grp, initials } from '@/components/proto/primitives'
import { companyRows } from '@/lib/company-rows'
import type { CompanyRecord } from '@/lib/registry'
import { cn } from '@/lib/utils'
import type { AgendaRow } from '@/components/newui/agenda'
import type { CaseTableRow } from '@/components/newui/case-table'

const MONTHS = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek']
const real = (v?: string) => (v && v !== '—' && v !== '-' ? v.trim() : '')

/* ----------------------------------------------------------------------------------------------- companies */

const SORTS: { key: CompanySortKey; label: string }[] = [
  { key: 'hearing', label: 'Majlis' },
  { key: 'name', label: 'Nomi' },
  { key: 'rating', label: 'Reyting' },
  { key: 'cases', label: 'Ishlar' },
  { key: 'winRate', label: 'Yutuq' },
  { key: 'debt', label: 'Qarz' },
]

/** A small ring with the win rate in it. */
function Ring({ pct }: { pct: number }) {
  const r = 13
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(100, pct))
  return (
    <span className="gx-ring" title={`Yutuq ${Math.round(v)}%`}>
      <svg viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r={r} className="t" />
        <circle cx="16" cy="16" r={r} className="v" strokeDasharray={`${(c * v) / 100} ${c}`} transform="rotate(-90 16 16)" />
      </svg>
      <b>{Math.round(v)}</b>
    </span>
  )
}

export function GreenCompanies({
  records, onOpen, onRefresh, onRemove, removeTitle, canRemove, empty,
}: {
  records: CompanyRecord[]
  onOpen: (rec: CompanyRecord) => void
  onRefresh: (stir: string) => Promise<void>
  onRemove: (rec: CompanyRecord) => void
  removeTitle: string
  canRemove?: (rec: CompanyRecord) => boolean
  empty: React.ReactNode
}) {
  const [sort, setSort] = useState<{ key: CompanySortKey; dir: SortDir }>({ key: 'hearing', dir: 'asc' })
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const rows = useMemo(() => sortCompanies(companyRows(records), sort.key, sort.dir), [records, sort])

  const refresh = (stir: string) => {
    if (busy.has(stir)) return
    setBusy((b) => new Set(b).add(stir))
    void onRefresh(stir)
      .catch(() => toast.error('Yangilashda xatolik — manbalar javob bermadi'))
      .finally(() => setBusy((b) => { const n = new Set(b); n.delete(stir); return n }))
  }

  if (records.length === 0) return <>{empty}</>

  return (
    <div className="gx-list">
      <div className="gx-sorts" role="group" aria-label="Saralash">
        <span>Saralash</span>
        {SORTS.map((c) => {
          const on = sort.key === c.key
          return (
            <button key={c.key} type="button" className={cn('gx-sort', on && 'on')} aria-pressed={on} onClick={() => setSort((s) => nextSort(s, c.key))}>
              {c.label}
              {on ? sort.dir === 'asc' ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden /> : null}
            </button>
          )
        })}
      </div>
      <ul className="gx-cos">
        {rows.map(({ rec, score, cases, winRate, hearingIso, debt }, i) => {
          const m = rec.meta
          const days = hearingIso ? calendarDaysUntil(hearingIso) : null
          const [, mo, d] = hearingIso ? hearingIso.split('-').map(Number) : [0, 0, 0]
          const removable = canRemove ? canRemove(rec) : true
          return (
            <li key={rec.stir} style={{ '--i': Math.min(i, 9) } as React.CSSProperties}>
              <div
                className="gx-co"
                role="button"
                tabIndex={0}
                onClick={() => onOpen(rec)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    onOpen(rec)
                  }
                }}
              >
                <span className={`gx-av av-${avatarHue(rec.stir)}`} aria-hidden>
                  {initials(rec.name || '')}
                  <i className={`p-dot ${familyDotClass(companyStatusFamily(m?.status))}`} title={m?.status?.trim() || 'Holati hali oʻqilmagan'} />
                </span>
                <span className="gx-co-id">
                  <b title={rec.name}>{rec.name || `STIR ${grp(rec.stir)}`}</b>
                  <small>{grp(rec.stir)}</small>
                </span>
                <span className="gx-co-rate">
                  {score != null || m?.rating ? (
                    <>
                      <b>{score != null ? score : '—'}</b>
                      {m?.rating ? <span className={`lt ${familyBadgeClass(ratingBandFamily(m.rating) ?? 'neutral')}`}>{m.rating}</span> : null}
                    </>
                  ) : <em>—</em>}
                </span>
                <span className="gx-co-cases" title="Sud ishlari">
                  {cases != null ? <><b>{cases}</b><small>ish</small></> : <em>—</em>}
                </span>
                <span className="gx-co-win">{winRate != null ? <Ring pct={winRate} /> : <em>—</em>}</span>
                <span className="gx-co-hear">
                  {hearingIso && days !== null ? (
                    <span className={cn('gx-date', days <= 7 && 'soon')}>
                      <b>{String(d).padStart(2, '0')} {MONTHS[mo - 1] ?? ''}</b>
                      <small>{days === 0 ? 'bugun' : days === 1 ? 'ertaga' : `${days} kun`}</small>
                    </span>
                  ) : <em>—</em>}
                </span>
                <span className="gx-co-debt">
                  {debt === null ? <em title="Toʻlovlar hali ochilmagan">—</em> : debt > 0 ? <b>{formatSumCompact(debt)}</b> : <em title="Muddati oʻtgan qarz yoʻq">0</em>}
                </span>
                <span className="gx-co-act">
                  <button type="button" title="Yangilash" aria-label="Yangilash" onClick={(e) => { e.stopPropagation(); refresh(rec.stir) }}>
                    {busy.has(rec.stir) ? <span className="spinner" style={{ width: 13, height: 13 }} /> : <RefreshCw />}
                  </button>
                  {removable && (
                    <button type="button" className="danger" title={removeTitle} aria-label={removeTitle} onClick={(e) => { e.stopPropagation(); onRemove(rec) }}>
                      <X />
                    </button>
                  )}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/* ----------------------------------------------------------------------------------------------- cases */

const COURT: Record<string, string> = { economic: 'Iqtisodiy', civil: 'Fuqarolik', administrative: 'Maʼmuriy', criminal: 'Jinoyat' }
const OUTCOME = { win: 'Yutgan', lose: 'Yutqazgan', pending: 'Jarayonda', neutral: 'Neytral' } as const

export function GreenCases({ rows, statusText, onOpen }: { rows: CaseTableRow[]; statusText: (raw: string) => string; onOpen: (row: CaseTableRow) => void }) {
  return (
    <ul className="gx-cases">
      {rows.map((row, i) => {
        const { c, courtType, role } = row
        const other = role === 'plaintiff' ? real(c.defendant) : role === 'defendant' ? real(c.plaintiff) : [real(c.plaintiff), real(c.defendant)].filter(Boolean).join(' / ')
        const cls = role ? classifyOutcome(role, c.result) : null
        const hearing = real(c.hearingDate)
        const left = hearing ? daysUntil(hearing) : null
        const ahead = left !== null && left >= 0
        const amount = real(c.claimAmount)
        const fam = cls ? caseClassificationFamily(cls) : 'neutral'
        return (
          <li key={`${courtType}-${c.caseNumber || i}`} style={{ '--i': Math.min(i, 9) } as React.CSSProperties}>
            <div
              className="gx-case"
              role="button"
              tabIndex={0}
              data-case={c.caseNumber}
              onClick={() => onOpen(row)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  onOpen(row)
                }
              }}
            >
              <span className={cn('gx-orb', `f-${fam}`)} title={cls ? OUTCOME[cls] : 'Natija nomaʼlum'} aria-hidden>
                {cls === 'win' ? <Check /> : cls === 'lose' ? <X /> : cls === 'pending' ? <Clock /> : <Minus />}
              </span>
              <span className="gx-case-who">
                <b title={other}>{other || '—'}</b>
                <small>
                  <span className="mono">{c.caseNumber}</span>
                  {' · '}
                  {COURT[courtType] ?? courtType}
                  {role ? ` · kompaniya ${role === 'plaintiff' ? 'daʼvogar' : 'javobgar'}` : ''}
                </small>
              </span>
              <span className="gx-case-kind" title={real(c.caseType)}>{real(c.caseType)}</span>
              <span className="gx-case-court" title={c.courtName}>
                <b>{real(c.courtName) || '—'}</b>
                {real(c.judge) ? <small>{real(c.judge)}</small> : null}
              </span>
              <span className="gx-case-res">
                {cls === 'pending' ? (
                  <span className="gx-open" title={statusText(c.caseStatus)}>{OUTCOME.pending}</span>
                ) : cls ? (
                  <span className={`badge ${familyBadgeClass(fam)}`} title={real(c.result) || statusText(c.caseStatus)}>{OUTCOME[cls]}</span>
                ) : c.caseStatus ? (
                  <span className={`badge ${familyBadgeClass('neutral')}`}>{statusText(c.caseStatus)}</span>
                ) : <em>—</em>}
              </span>
              <span className="gx-case-amt" title={amount ? `${groupDigits(c.claimAmount)} soʻm` : undefined}>
                {amount ? <><b>{groupDigits(c.claimAmount)}</b><small>soʻm</small></> : <em>—</em>}
              </span>
              <span className="gx-case-date">
                <b>{hearing || real(c.dateFiled) || '—'}</b>
                <small className={ahead && left <= 7 ? 'soon' : ''}>
                  {hearing ? (ahead ? (left === 0 ? 'majlis bugun' : `majlis · ${left} kun`) : 'oxirgi majlis') : real(c.dateFiled) ? 'kiritilgan' : ''}
                </small>
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/* ----------------------------------------------------------------------------------------------- agenda */

const noopSubscribe = () => () => {}
const WEEK = 7

function Day({ g, now }: { g: AgendaDay<AgendaRow>; now: Date }) {
  return (
    <section className="gx-day">
      <header className={cn('gx-day-h', g.days <= 1 && 'soon')}>
        <b>{relativeDay(g.days)}</b>
        <span>{longDate(g.iso, now)}</span>
        <i>{g.items.length}</i>
      </header>
      <ol className="gx-tl">
        {g.items.map((r) => (
          <li key={r.id}>
            <button type="button" className="gx-ev" onClick={r.onOpen}>
              <span className="gx-ev-t">{r.time || '—'}</span>
              <span className="gx-ev-w">
                <b>{r.title}</b>
                {r.sub ? <small>{r.sub}</small> : null}
                {r.code ? <small className="mono">{r.code}</small> : null}
              </span>
              <ChevronRight aria-hidden />
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function GreenAgenda({ rows, emptyHint = 'Rejalashtirilgan majlis topilmadi.' }: { rows: AgendaRow[]; emptyHint?: string }) {
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const [sel, setSel] = useState<number | null>(null)
  const [showLater, setShowLater] = useState(false)
  const now = useMemo(() => new Date(), [rows])
  const groups = useMemo(() => groupByDay(rows, now), [rows, now])
  const strip = useMemo(() => weekStrip(groups, now, WEEK), [groups, now])

  if (!hydrated) return <div className="gx-ag" aria-busy />

  const week = groups.filter((g) => g.days < WEEK)
  const later = groups.filter((g) => g.days >= WEEK)
  const laterCount = later.reduce((a, g) => a + g.items.length, 0)
  const active = sel !== null && week.some((g) => g.days === sel) ? sel : null
  const shown = active === null ? week : week.filter((g) => g.days === active)
  const laterOpen = showLater || week.length === 0

  return (
    <div className="gx-ag">
      <div className="gx-wk" role="group" aria-label="Kelgusi 7 kun">
        {strip.map((d) => (
          <button
            key={d.iso}
            type="button"
            className={cn('gx-wk-d', d.count > 0 && 'has', active === d.days && 'on', d.days === 0 && 'today')}
            disabled={d.count === 0}
            aria-pressed={active === d.days}
            title={d.count ? `${longDate(d.iso, now)}: ${d.count} ta majlis` : `${longDate(d.iso, now)}: majlis yoʻq`}
            onClick={() => setSel(active === d.days ? null : d.days)}
          >
            <span>{d.days === 0 ? 'Bugun' : WEEKDAYS_SHORT[d.weekday]}</span>
            <b>{d.day}</b>
            <i>{d.count || ''}</i>
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <div className="gx-empty"><CalendarDays aria-hidden /><span>{emptyHint}</span></div>
      ) : (
        <>
          {week.length === 0 && <p className="gx-note-t">7 kun ichida majlis yoʻq.</p>}
          {shown.map((g) => <Day key={g.iso} g={g} now={now} />)}
          {active === null && later.length > 0 && (
            <>
              {week.length > 0 && (
                <button type="button" className="gx-later" aria-expanded={laterOpen} onClick={() => setShowLater((v) => !v)}>
                  Keyinroq · {laterCount} ta majlis
                </button>
              )}
              {laterOpen && later.map((g) => <Day key={g.iso} g={g} now={now} />)}
            </>
          )}
        </>
      )}
    </div>
  )
}
