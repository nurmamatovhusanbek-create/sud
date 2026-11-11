'use client'

/**
 * Bosh sahifa in the green look: a bento dashboard instead of «search, one line of totals, a table». One lime hero
 * card (what is overdue), three totals, the win rate of everything, the next fortnight of hearings as bars, the search
 * as a calm centred card, the companies table, the rating donut and the agenda. Every number is read from the registry
 * the launcher already holds (nothing is fetched here); the shapes come from core/green-home (tested).
 */

import type { ReactNode } from 'react'
import { ArrowUpRight, CalendarDays, Gavel, Users } from 'lucide-react'
import { formatSumCompact } from '@/core/billing-format'
import { donutArcs, hearingsPerDay, ratingShares, weightedWinRate, winLabel, type RatingKey } from '@/core/green-home'
import { futureUpcoming, type CompanyRecord } from '@/lib/registry'
import { useAppStore } from '@/lib/store/app-store'

export interface GreenHomeTotals {
  cases: number
  active: number
  unknown: number
  nearHearings: number
  nearestLabel: string | null
  overdueTotal: number
  overdueCompanies: number
}

const grpNum = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

const RATING_NAME: Record<RatingKey, string> = { A: 'Aʼlo', B: 'Yaxshi', C: 'Oʻrtacha', D: 'Past', '—': 'Oʻqilmagan' }
const R = 54
const C = 2 * Math.PI * R

export function GreenHome({ companies, totals, searchBox, recentChips, companyTable, listTools, agenda, agendaCount }: {
  companies: CompanyRecord[]
  totals: GreenHomeTotals
  searchBox: ReactNode
  recentChips: ReactNode
  companyTable: ReactNode
  listTools: ReactNode
  agenda: ReactNode
  agendaCount: number
}) {
  const setSurface = useAppStore((s) => s.setSurface)
  const win = weightedWinRate(companies.map((c) => ({ cases: c.meta?.cases, winRate: c.meta?.winRate })))
  const days = hearingsPerDay(companies.flatMap((c) => futureUpcoming(c.meta).map((h) => h.iso)), new Date(), 14)
  const peak = Math.max(1, ...days.map((d) => d.count))
  const fortnight = days.reduce((n, d) => n + d.count, 0)
  const shares = ratingShares(companies.map((c) => c.meta?.rating))
  const arcs = donutArcs(shares.map((s) => ({ key: s.key, n: s.n })), C, 5)

  return (
    <div className="g-home">
      <section className="g-card g-hero" aria-label="Muddati oʻtgan qarz">
        <span className="g-hero-t">Muddati oʻtgan qarz</span>
        <div className="g-hero-n">
          <b>{formatSumCompact(totals.overdueTotal)}</b>
          <span>soʻm</span>
        </div>
        <span className="g-hero-s">{totals.overdueCompanies > 0 ? `${totals.overdueCompanies} ta kompaniyada` : 'qarzdorlik yoʻq'}</span>
        <div className="g-hero-a">
          <button type="button" className="g-pill light" onClick={() => setSurface('watchlist')}>Kuzatuv</button>
          <button type="button" className="g-pill dark" onClick={() => document.querySelector<HTMLInputElement>('#g-search input')?.focus()}>
            Qidirish <ArrowUpRight />
          </button>
        </div>
      </section>

      <section className="g-card g-tiles" aria-label="Umumiy koʻrsatkichlar">
        <div className="g-card-h"><h2>Umumiy koʻrsatkichlar</h2></div>
        <div className="g-tilegrid">
          <div className="g-tile">
            <span className="g-ico"><Users /></span>
            <span className="g-tile-l">Kompaniyalar</span>
            <b>{companies.length}</b>
            <i className="g-chip ok">{totals.active} faol</i>
          </div>
          <div className="g-tile">
            <span className="g-ico"><Gavel /></span>
            <span className="g-tile-l">Sud ishlari</span>
            <b>{grpNum(totals.cases)}</b>
            <i className="g-chip">jami</i>
          </div>
          <div className="g-tile">
            <span className="g-ico"><CalendarDays /></span>
            <span className="g-tile-l">Majlislar</span>
            <b>{totals.nearHearings}</b>
            <i className={`g-chip ${totals.nearHearings > 0 ? 'warn' : ''}`}>{totals.nearestLabel ? `eng yaqini ${totals.nearestLabel}` : 'rejalashtirilmagan'}</i>
          </div>
        </div>
      </section>

      <section className="g-card g-score" aria-label="Yutuq darajasi">
        <div className="g-card-h"><h2>Yutuq darajasi</h2></div>
        <span className="g-score-l">Barcha sud ishlari boʻyicha</span>
        <div className="g-score-v">
          <b>{winLabel(win)}</b>
          <span>{win === null ? '—' : `${win}%`}</span>
        </div>
        <div className="g-score-bar" role="img" aria-label={win === null ? 'maʼlumot yoʻq' : `${win}% yutuq`}>
          <i style={{ flexGrow: win ?? 0 }} />
          <i className="rest" style={{ flexGrow: win === null ? 100 : Math.max(0, 100 - win) }} />
        </div>
      </section>

      <section className="g-card g-chart" aria-label="Majlislar, 14 kun">
        <div className="g-card-h"><h2>Majlislar oqimi</h2><span className="g-card-s">yaqin 14 kun</span></div>
        <div className="g-chart-n"><b>{fortnight}</b><span>ta majlis</span></div>
        <div className="g-bars" role="img" aria-label={`Yaqin 14 kunda ${fortnight} ta majlis`}>
          {days.map((d) => (
            <div key={d.iso} className={`g-bar ${d.today ? 'today' : ''} ${d.count === 0 ? 'zero' : ''}`} title={`${d.day}.${d.iso.slice(5, 7)} · ${d.count} ta`}>
              <span className="g-bar-n">{d.count > 0 ? d.count : ''}</span>
              <span className="g-bar-c"><i style={{ height: `${d.count === 0 ? 4 : 14 + (d.count / peak) * 86}%` }} /></span>
              <span className="g-bar-d"><b>{d.day}</b>{d.weekday}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="g-card g-find" id="g-search" aria-label="Qidiruv">
        <span className="g-orb" aria-hidden />
        <h2>Qaysi kompaniyani qidiramiz?</h2>
        <p>STIR (9 xonali), kvitansiya yoki ish raqamini kiriting: toʻlovlar, sud ishlari va majlislar bir joyda.</p>
        {searchBox}
        {recentChips}
      </section>

      <section className="g-card g-table" aria-label="Kompaniyalar">
        <div className="g-card-h">
          <h2>Kompaniyalar</h2>
          <span className="g-count">{companies.length}</span>
          <span className="sp" />
          {listTools}
        </div>
        {companyTable}
      </section>

      <section className="g-card g-donut" aria-label="Reyting taqsimoti">
        <div className="g-card-h"><h2>Reyting taqsimoti</h2><span className="g-card-s">chamber.uz</span></div>
        <div className="g-donut-row">
          <svg viewBox="0 0 140 140" className="g-donut-svg" role="img" aria-label="Reyting boʻyicha kompaniyalar">
            <circle className="g-donut-track" cx="70" cy="70" r={R} />
            {arcs.map((a) => (
              <circle key={a.key} className={`g-arc k-${a.key === '—' ? 'x' : a.key}`} cx="70" cy="70" r={R} strokeDasharray={`${a.dash} ${a.gap}`} strokeDashoffset={a.offset} />
            ))}
            <text x="70" y="68" textAnchor="middle" className="g-donut-n">{companies.length}</text>
            <text x="70" y="86" textAnchor="middle" className="g-donut-l">kompaniya</text>
          </svg>
          <ul className="g-legend">
            {shares.map((s) => (
              <li key={s.key} className={s.n === 0 ? 'none' : ''}>
                <i className={`g-sw k-${s.key === '—' ? 'x' : s.key}`} />
                <span>{s.key === '—' ? 'Oʻqilmagan' : `${s.key} · ${RATING_NAME[s.key]}`}</span>
                <b>{s.n}</b>
                <em className="g-chip">{s.pct}%</em>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="g-card g-agenda" aria-label="Majlislar">
        <div className="g-card-h"><h2>Majlislar</h2><span className="g-count">{agendaCount}</span></div>
        {agenda}
      </section>
    </div>
  )
}
