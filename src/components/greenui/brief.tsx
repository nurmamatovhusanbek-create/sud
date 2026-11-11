'use client'

/**
 * «Xulosa» — the first tab of a company's dossier in the green look: what the app already knows about this company,
 * as signals with reasons (core/verdict), the hearings coming up with a button to prepare for each, and the cases in
 * time when the statistics are cached. It reads the registry and the cache only; the one button that fetches
 * («Yuklash») is a click.
 */

import { useMemo } from 'react'
import { ArrowRight, CalendarClock, CircleHelp, ShieldAlert, ShieldCheck, TriangleAlert } from 'lucide-react'
import { calendarDaysUntil, longDate } from '@/core/agenda'
import { companyVerdict, type Signal } from '@/core/verdict'
import { getCached } from '@/lib/cache'
import type { CompanyStats } from '@/lib/api-types'
import { hardRefreshWithToast, useRefreshing } from '@/lib/hard-refresh'
import { futureUpcoming, getRecord } from '@/lib/registry'
import { useRegistryVersion } from '@/lib/use-registry'
import { useAppStore, type SectionKey } from '@/lib/store/app-store'
import { useHydrated } from '@/components/shell/alerts'
import { cn } from '@/lib/utils'
import { GreenCaseTimeline } from '@/components/greenui/case-timeline'
import { openCaseDetail } from '@/components/sections/cases'
import type { CourtType } from '@/lib/court-case-types'

const LEVEL_ICON = { danger: <ShieldAlert />, caution: <TriangleAlert />, ok: <ShieldCheck />, unknown: <CircleHelp /> }
const LEVEL_NOTE = {
  danger: 'Quyidagi jiddiy belgilarni shartnoma yoki daʼvodan oldin tekshiring.',
  caution: 'Hech narsa toʻxtatmaydi, lekin eʼtibor kerak.',
  ok: 'Oʻqilgan manbalarda jiddiy belgi yoʻq. Oʻqilmaganlari quyida.',
  unknown: 'Xulosa uchun manbalar yetarli emas. Quyidagi tugma ularni yuklaydi.',
}

function SignalCard({ s, onGo }: { s: Signal; onGo: (t: SectionKey) => void }) {
  return (
    <li>
      <button type="button" className={cn('gx-sig', `t-${s.tone}`)} onClick={() => onGo(s.target)}>
        <i aria-hidden />
        <span>
          <b>{s.title}</b>
          <small>{s.detail}</small>
        </span>
        <ArrowRight aria-hidden />
      </button>
    </li>
  )
}

export function BriefSection() {
  const company = useAppStore((s) => s.activeCompany)
  const setSection = useAppStore((s) => s.setSection)
  const openPrep = useAppStore((s) => s.openPrep)
  const rv = useRegistryVersion()
  const hydrated = useHydrated()
  const stir = company?.stir ?? ''
  const refreshing = useRefreshing(stir)

  const rec = hydrated && stir ? getRecord(stir) : null
  const meta = rec?.meta
  const hearings = useMemo(() => futureUpcoming(meta), [meta, rv])
  const verdict = useMemo(
    () =>
      companyVerdict({
        status: meta?.status ?? company?.status,
        rating: meta?.rating ?? company?.rating?.category,
        score: meta?.score ?? company?.rating?.score,
        winRate: meta?.winRate,
        cases: meta?.cases,
        overdueTotal: meta?.billsLoadedAt ? meta.overdueTotal ?? 0 : null,
        hearingsAhead: hearings.length,
        nextHearingDays: hearings[0] ? calendarDaysUntil(hearings[0].iso) : null,
      }),
    [meta, company, hearings],
  )
  const stats = hydrated && stir ? getCached<CompanyStats>(`stats:${stir}`) : null
  const timelineRows = useMemo(
    () => (stats?.cases ?? []).map((c) => ({ id: `${c.courtType}|${c.caseNumber}`, filed: c.regDate, outcome: c.classification })),
    [stats],
  )

  if (!company) return null
  const now = new Date()

  return (
    <div className="gx-brief-pg">
      <section className={cn('gx-verdict', `lv-${verdict.level}`)} aria-label="Xulosa">
        <span className="gx-verdict-ico" aria-hidden>{LEVEL_ICON[verdict.level]}</span>
        <div className="gx-verdict-t">
          <h2>{verdict.headline}</h2>
          <p>{LEVEL_NOTE[verdict.level]}</p>
        </div>
        {verdict.unread > 0 && (
          <button type="button" className="gx-verdict-go" disabled={refreshing} onClick={() => void hardRefreshWithToast(stir)}>
            {refreshing ? <span className="spinner" style={{ width: 13, height: 13 }} /> : null}
            {verdict.unread} ta manbani yuklash
          </button>
        )}
      </section>

      <ul className="gx-sigs">
        {verdict.signals.map((s) => (
          <SignalCard key={s.id} s={s} onGo={setSection} />
        ))}
      </ul>

      {hearings.length > 0 && (
        <section className="gx-panel" aria-label="Majlislar">
          <div className="gx-panel-h"><h2>Majlislar</h2><span className="g-count">{hearings.length}</span></div>
          <ul className="gx-hrs">
            {hearings.slice(0, 6).map((h, i) => {
              const d = calendarDaysUntil(h.iso, now)
              return (
                <li key={`${h.iso}-${h.caseNumber ?? i}`} className="gx-hr">
                  <span className={cn('gx-hr-d', d !== null && d <= 3 && 'soon')}>
                    <b>{d === 0 ? 'Bugun' : d === 1 ? 'Ertaga' : `${d} kun`}</b>
                    <small>{longDate(h.iso, now)}{h.time ? ` · ${h.time}` : ''}</small>
                  </span>
                  <span className="gx-hr-w">
                    <b>{h.court || 'Sud'}</b>
                    <small className="mono">{h.caseNumber ?? '—'}</small>
                  </span>
                  {h.caseNumber ? (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => openPrep({ stir, name: company.name, caseNumber: h.caseNumber!, iso: h.iso, time: h.time, court: h.court, judge: h.judge })}>
                      <CalendarClock />
                      <span>Tayyorlanish</span>
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {timelineRows.length > 0 && (
        <GreenCaseTimeline rows={timelineRows} onOpen={(id) => { const [ct, no] = id.split('|'); openCaseDetail(no, ct as CourtType, company) }} />
      )}

      <p className="gx-disclaimer">Bu belgilar shu dasturda oʻqilgan maʼlumotlarga asoslangan yoʻnaltiruvchi xulosa; huquqiy baho emas.</p>
    </div>
  )
}
