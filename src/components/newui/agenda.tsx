'use client'

/**
 * New look: hearings as an agenda (core/agenda.ts decides the order). A 7-day strip on top answers «how busy is the
 * week» at a glance and filters by a click; below it the hearings are grouped by day and ordered by time. Anything
 * later than the week sits behind one «Keyinroq» line. Used by Bosh sahifa, Kuzatuv and a company's Majlislar.
 */

import { useMemo, useState, useSyncExternalStore } from 'react'
import { CalendarDays, ChevronDown, ChevronRight } from 'lucide-react'
import { WEEKDAYS_SHORT, groupByDay, longDate, relativeDay, weekStrip, type AgendaDay } from '@/core/agenda'

export interface AgendaRow {
  id: string
  iso: string
  time?: string
  /** who or where: the company on multi-company screens, the court inside a company */
  title: string
  /** secondary line, already joined */
  sub?: string
  /** case number */
  code?: string
  onOpen: () => void
}

const noopSubscribe = () => () => {}
const WEEK = 7

function DayGroup({ g, now }: { g: AgendaDay<AgendaRow>; now: Date }) {
  return (
    <section className="ag-grp">
      <header className={`ag-h${g.days <= 1 ? ' soon' : ''}`}>
        <b>{relativeDay(g.days)}</b>
        <span>{longDate(g.iso, now)}</span>
        <i>{g.items.length}</i>
      </header>
      {g.items.map((r) => (
        <button key={r.id} type="button" className="ag-row" onClick={r.onOpen}>
          <span className="ag-t">{r.time || '—'}</span>
          <span className="ag-w">
            <b>{r.title}</b>
            {r.sub ? <span>{r.sub}</span> : null}
          </span>
          {r.code ? <span className="ag-c">{r.code}</span> : null}
          <ChevronRight aria-hidden />
        </button>
      ))}
    </section>
  )
}

export function Agenda({ rows, emptyHint = 'Rejalashtirilgan majlis topilmadi.' }: { rows: AgendaRow[]; emptyHint?: string }) {
  // dates depend on the browser's clock and time zone: draw only in the browser
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const [sel, setSel] = useState<number | null>(null)
  const [showLater, setShowLater] = useState(false)

  const now = useMemo(() => new Date(), [rows]) // the clock is re-read whenever the data changes
  const groups = useMemo(() => groupByDay(rows, now), [rows, now])
  const strip = useMemo(() => weekStrip(groups, now, WEEK), [groups, now])

  if (!hydrated) return <div className="ag" aria-busy />

  const week = groups.filter((g) => g.days < WEEK)
  const later = groups.filter((g) => g.days >= WEEK)
  const laterCount = later.reduce((a, g) => a + g.items.length, 0)
  // a day that lost its hearings (data refreshed) is no longer a filter
  const active = sel !== null && week.some((g) => g.days === sel) ? sel : null
  const shown = active === null ? week : week.filter((g) => g.days === active)
  const laterOpen = showLater || week.length === 0

  return (
    <div className="ag">
      <div className="ag-week" role="group" aria-label="Kelgusi 7 kun">
        {strip.map((d) => (
          <button
            key={d.iso}
            type="button"
            className={`ag-day${d.count ? ' has' : ''}${active === d.days ? ' on' : ''}${d.days === 0 ? ' today' : ''}`}
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
        <div className="ag-empty">
          <CalendarDays aria-hidden />
          <span>{emptyHint}</span>
        </div>
      ) : (
        <>
          {week.length === 0 && <div className="ag-note">7 kun ichida majlis yoʻq.</div>}
          {shown.map((g) => (
            <DayGroup key={g.iso} g={g} now={now} />
          ))}
          {active === null && later.length > 0 && (
            <>
              {week.length > 0 && (
                <button type="button" className="ag-more" aria-expanded={laterOpen} onClick={() => setShowLater((v) => !v)}>
                  <ChevronDown aria-hidden style={laterOpen ? { transform: 'rotate(180deg)' } : undefined} />
                  Keyinroq · {laterCount} ta majlis
                </button>
              )}
              {laterOpen && later.map((g) => <DayGroup key={g.iso} g={g} now={now} />)}
            </>
          )}
        </>
      )}
    </div>
  )
}
