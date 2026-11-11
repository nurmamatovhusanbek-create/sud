'use client'

/**
 * Kuzatuv in the green look: no second page title (the top bar already names the page). A head of three pills says
 * what is on watch, what is within the week and what is overdue, the tools sit beside it, then the companies and their
 * hearings as two soft cards. The data comes from the watchlist view that renders this; nothing is fetched here.
 */

import type { ReactNode } from 'react'
import { CalendarDays, Eye, RefreshCw, Wallet } from 'lucide-react'

export function GreenWatchlist({ watching, weekHearings, overdueCompanies, tools, companies, agenda, agendaCount, refreshing, onRefresh }: {
  watching: number
  weekHearings: number
  overdueCompanies: number
  tools: ReactNode
  companies: ReactNode
  agenda: ReactNode
  agendaCount: number
  refreshing: boolean
  onRefresh: () => void
}) {
  return (
    <div className="gx-wl">
      <div className="gx-wl-head">
        <div className="gx-pills">
          <span className="gx-pill"><Eye aria-hidden /><b>{watching}</b><small>kuzatuvda</small></span>
          <span className="gx-pill lime"><CalendarDays aria-hidden /><b>{weekHearings}</b><small>majlis 7 kun ichida</small></span>
          <span className={`gx-pill${overdueCompanies > 0 ? ' warn' : ''}`}><Wallet aria-hidden /><b>{overdueCompanies}</b><small>qarzdor kompaniya</small></span>
        </div>
        <div className="gx-wl-tools">{tools}</div>
      </div>
      <div className="gx-wl-grid">
        <section className="gx-panel" aria-label="Kuzatuvdagi kompaniyalar">
          <div className="gx-panel-h"><h2>Kompaniyalar</h2><span className="g-count">{watching}</span></div>
          {companies}
        </section>
        <aside className="gx-panel" aria-label="Majlislar">
          <div className="gx-panel-h">
            <h2>Majlislar</h2>
            <span className="g-count">{agendaCount}</span>
            <span className="sp" />
            <button className="btn btn-ghost btn-xs" onClick={onRefresh} disabled={refreshing || watching === 0} title="Majlislarni sudlardan qayta oʻqish">
              {refreshing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw />}
              Yangilash
            </button>
          </div>
          {agenda}
        </aside>
      </div>
    </div>
  )
}
