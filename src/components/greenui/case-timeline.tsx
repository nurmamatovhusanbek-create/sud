'use client'

/**
 * Sud ishlari in the green look opens with the cases laid out in TIME: one column per month, one dot per case
 * coloured by its outcome, newest on the right (core/case-timeline decides the layout). It answers «when did this
 * start, is it piling up, how did the closed ones go» before a single row is read; a dot opens that case.
 */

import { useMemo } from 'react'
import { caseTimeline, type TimelineInput, type TimelineOutcome } from '@/core/case-timeline'
import { cn } from '@/lib/utils'

const NAME: Record<string, string> = { win: 'Yutgan', lose: 'Yutqazgan', pending: 'Jarayonda', neutral: 'Neytral' }

export function GreenCaseTimeline({ rows, onOpen }: { rows: TimelineInput[]; onOpen: (id: string) => void }) {
  const t = useMemo(() => caseTimeline(rows), [rows])
  const peak = Math.max(1, ...t.months.map((m) => m.items.length))
  const placed = t.months.reduce((n, m) => n + m.items.length, 0)
  if (placed === 0 && t.earlier === 0) return null
  const count = (o: TimelineOutcome) => rows.filter((r) => r.outcome === o).length

  return (
    <section className="gx-tlv" aria-label="Ishlar vaqt boʻyicha">
      <header className="gx-tlv-h">
        <h3>Vaqt chizigʻi</h3>
        <span className="gx-tlv-key">
          <i className="k-win" />Yutgan {count('win')}
          <i className="k-lose" />Yutqazgan {count('lose')}
          <i className="k-pending" />Jarayonda {count('pending')}
        </span>
        {t.earlier > 0 && <span className="gx-tlv-note">+ {t.earlier} ta eski ish</span>}
      </header>
      <div className="gx-tlv-cols" style={{ ['--peak' as string]: peak }}>
        {t.months.map((m) => (
          <div key={m.key} className="gx-tlv-col">
            <div className="gx-tlv-dots">
              {m.items.map((it) => (
                <button key={it.id} type="button" className={cn('gx-dot', `o-${it.outcome ?? 'none'}`)} title={`${it.id.split('|')[1] ?? ''} · ${it.outcome ? NAME[it.outcome] : 'natija nomaʼlum'}`} aria-label={`Ishni ochish: ${it.id.split('|')[1] ?? ''}`} onClick={() => onOpen(it.id)} />
              ))}
            </div>
            <span className="gx-tlv-m">{m.label}</span>
            <span className="gx-tlv-y">{m.year ?? ''}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
