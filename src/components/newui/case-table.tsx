'use client'

/**
 * New look: a company's court cases as a table. The row it replaces showed the case number, the court and a grey
 * status; who the case is AGAINST, what it is about and how it ended were only in the drawer. Here they are columns:
 * opponent (+ which side the company is on), category, court, outcome in colour, amount, date.
 */

import { caseClassificationFamily } from '@/core/status'
import { classifyOutcome, type PartyRole } from '@/core/classify'
import { daysUntil } from '@/core/dates'
import { groupDigits } from '@/core/billing-format'
import { familyBadgeClass } from '@/components/proto/primitives'
import type { CourtCase, CourtType } from '@/lib/court-case-types'

export interface CaseTableRow {
  c: CourtCase
  courtType: CourtType
  /** the company's side, when it could be told */
  role: PartyRole | null
}

const COURT: Record<string, string> = { economic: 'Iqtisodiy', civil: 'Fuqarolik', administrative: 'Maʼmuriy', criminal: 'Jinoyat' }
const OUTCOME = { win: 'Yutgan', lose: 'Yutqazgan', pending: 'Jarayonda', neutral: 'Neytral' } as const
const real = (v?: string) => (v && v !== '—' && v !== '-' ? v.trim() : '')

export function CaseTable({ rows, statusText, onOpen }: { rows: CaseTableRow[]; statusText: (raw: string) => string; onOpen: (row: CaseTableRow) => void }) {
  return (
    <div className="ct-wrap">
      <table className="ct cases">
        <thead>
          <tr>
            <th>Ish raqami</th>
            <th>Qarshi tomon</th>
            <th className="opt">Toifa</th>
            <th className="opt2">Sud</th>
            <th>Natija</th>
            <th className="num">Daʼvo summasi</th>
            <th>Sana</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const { c, courtType, role } = row
            const other = role === 'plaintiff' ? real(c.defendant) : role === 'defendant' ? real(c.plaintiff) : [real(c.plaintiff), real(c.defendant)].filter(Boolean).join(' / ')
            const cls = role ? classifyOutcome(role, c.result) : null
            const hearing = real(c.hearingDate)
            const left = hearing ? daysUntil(hearing) : null
            const ahead = left !== null && left >= 0
            return (
              <tr
                key={`${courtType}-${c.caseNumber || i}`}
                data-case={c.caseNumber}
                tabIndex={0}
                onClick={() => onOpen(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpen(row)
                  }
                }}
              >
                <td>
                  <span className="ct-id">
                    <b className="mono">{c.caseNumber}</b>
                    <span>{COURT[courtType] ?? courtType}</span>
                  </span>
                </td>
                <td className="ct-party">
                  <span className="ct-id">
                    <b title={other}>{other || '—'}</b>
                    <span>{role === 'plaintiff' ? 'kompaniya daʼvogar' : role === 'defendant' ? 'kompaniya javobgar' : 'tomon aniqlanmadi'}</span>
                  </span>
                </td>
                <td className="opt ct-clip" title={real(c.caseType)}>{real(c.caseType) || <span className="ct-none">—</span>}</td>
                <td className="opt2">
                  <span className="ct-id">
                    <b className="plain" title={c.courtName}>{real(c.courtName) || '—'}</b>
                    <span>{real(c.judge)}</span>
                  </span>
                </td>
                <td>
                  {cls === 'pending' ? (
                    // an open case is the ordinary state, not a signal: plain text, so colour is left for outcomes
                    <span className="ct-open" title={statusText(c.caseStatus)}>{OUTCOME.pending}</span>
                  ) : cls ? (
                    <span className={`badge ${familyBadgeClass(caseClassificationFamily(cls))}`} title={real(c.result) || statusText(c.caseStatus)}>{OUTCOME[cls]}</span>
                  ) : c.caseStatus ? (
                    <span className={`badge ${familyBadgeClass('neutral')}`}>{statusText(c.caseStatus)}</span>
                  ) : (
                    <span className="ct-none">—</span>
                  )}
                </td>
                <td className="num mono" title={real(c.claimAmount) ? `${groupDigits(c.claimAmount)} soʻm` : undefined}>{real(c.claimAmount) ? groupDigits(c.claimAmount) : <span className="ct-none">—</span>}</td>
                <td>
                  <span className="ct-hear">
                    <b>{hearing || real(c.dateFiled) || '—'}</b>
                    <span className={ahead && left <= 7 ? 'soon' : ''}>
                      {hearing ? (ahead ? (left === 0 ? 'majlis bugun' : `majlis · ${left} kun`) : 'oxirgi majlis') : real(c.dateFiled) ? 'kiritilgan' : ''}
                    </span>
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
