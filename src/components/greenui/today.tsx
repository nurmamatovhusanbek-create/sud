'use client'

/**
 * «Bugun» — the green look's home. Not a dashboard of totals but a queue: what needs the operator today, ranked
 * (core/attention), each item saying which company, why, and the one button that goes there. Beside it the week as an
 * agenda; below, the portfolio in one quiet line and the full company list for when you just want to browse.
 * Everything is read from the registry the launcher already holds; nothing is fetched here.
 */

import { useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ArrowRight, BadgeAlert, CalendarClock, ChevronDown, Gauge, Landmark, Wallet } from 'lucide-react'
import { longDate } from '@/core/agenda'
import { briefLine, type AttentionItem, type AttentionKind } from '@/core/attention'
import { formatSumCompact } from '@/core/billing-format'
import { winLabel } from '@/core/green-home'
import { cn } from '@/lib/utils'

const noopSubscribe = () => () => {}

const ICON: Record<AttentionKind, ReactNode> = {
  hearing: <CalendarClock />,
  debt: <Wallet />,
  status: <Landmark />,
  rating: <Gauge />,
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Item({ it, onOpen }: { it: AttentionItem; onOpen: (it: AttentionItem) => void }) {
  return (
    <li>
      <button type="button" className={cn('gx-todo', `sev-${it.severity}`)} onClick={() => onOpen(it)}>
        <span className="gx-todo-ico" aria-hidden>{ICON[it.kind]}</span>
        <span className="gx-todo-t">
          <b>{it.title}</b>
          <span className="who">{it.name}</span>
          <small>{it.detail}</small>
        </span>
        {it.amount ? <span className="gx-todo-amt">{formatSumCompact(it.amount)}<small>soʻm</small></span> : null}
        <span className="gx-todo-go">{it.action}<ArrowRight aria-hidden /></span>
      </button>
    </li>
  )
}

export function GreenToday({ items, onOpenItem, totals, win, searchBox, recentChips, companyTable, listTools, companyCount, agenda, agendaCount }: {
  items: AttentionItem[]
  onOpenItem: (it: AttentionItem) => void
  totals: { companies: number; cases: number; overdueTotal: number; overdueCompanies: number }
  win: number | null
  searchBox: ReactNode
  recentChips: ReactNode
  companyTable: ReactNode
  listTools: ReactNode
  companyCount: number
  agenda: ReactNode
  agendaCount: number
}) {
  // the date is the browser's: draw it only there
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false)
  const [all, setAll] = useState(false)
  const now = new Date()
  const urgent = items.filter((i) => i.severity === 3)
  const rest = items.filter((i) => i.severity < 3)

  return (
    <div className="gx-today">
      <header className="gx-brief">
        <span className="gx-brief-d">{hydrated ? longDate(iso(now), now) : ' '}</span>
        <h2>{hydrated ? briefLine(items) : ' '}</h2>
        <div className="gx-brief-find" id="g-search">
          {searchBox}
          {recentChips}
        </div>
      </header>

      <div className="gx-today-grid">
        <div className="gx-queue">
          {items.length === 0 ? (
            <div className="gx-clear"><BadgeAlert aria-hidden /><b>Hammasi tinch</b><span>Kuzatuvdagi kompaniyalar boʻyicha shoshilinch narsa yoʻq.</span></div>
          ) : (
            <>
              {urgent.length > 0 && (
                <section aria-label="Shoshilinch">
                  <h3 className="gx-q-h urgent">Shoshilinch <span>{urgent.length}</span></h3>
                  <ul className="gx-todos">{urgent.map((it) => <Item key={it.id} it={it} onOpen={onOpenItem} />)}</ul>
                </section>
              )}
              {rest.length > 0 && (
                <section aria-label="Kuzatib boring">
                  <h3 className="gx-q-h">Kuzatib boring <span>{rest.length}</span></h3>
                  <ul className="gx-todos">{rest.map((it) => <Item key={it.id} it={it} onOpen={onOpenItem} />)}</ul>
                </section>
              )}
            </>
          )}
        </div>

        <aside className="gx-week" aria-label="Hafta">
          <div className="gx-panel-h"><h2>Majlislar</h2><span className="g-count">{agendaCount}</span></div>
          {agenda}
        </aside>
      </div>

      <dl className="gx-folio" aria-label="Umumiy holat">
        <div><dt>Kompaniyalar</dt><dd>{totals.companies}</dd></div>
        <div><dt>Sud ishlari</dt><dd>{String(totals.cases).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}</dd></div>
        <div><dt>Yutuq</dt><dd>{win === null ? '—' : `${win}%`}<small>{winLabel(win)}</small></dd></div>
        <div className={totals.overdueTotal > 0 ? 'neg' : ''}><dt>Muddati oʻtgan kvitansiyalar</dt><dd>{formatSumCompact(totals.overdueTotal)}<small>{totals.overdueCompanies > 0 ? `${totals.overdueCompanies} ta kompaniyada` : 'yoʻq'}</small></dd></div>
      </dl>

      <section className="gx-all" aria-label="Kompaniyalar">
        <button type="button" className="gx-all-h" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          <h2>Barcha kompaniyalar</h2>
          <span className="g-count">{companyCount}</span>
          <ChevronDown aria-hidden style={all ? { transform: 'rotate(180deg)' } : undefined} />
        </button>
        {all && (
          <div className="gx-all-b">
            <div className="gx-all-tools">{listTools}</div>
            {companyTable}
          </div>
        )}
      </section>
    </div>
  )
}
