/**
 * How a company has fared in court against ONE counterparty, from cases already read (the cached statistics): the
 * single most useful fact before a hearing against a party you have met before. Identity is `samePartyName` (the same
 * matcher that decides which side the company is on), so a spelling or script difference never splits one party in two
 * and a shared legal form (every MChJ) never joins two.
 */

import { samePartyName } from './classify'

export interface CounterpartyCase {
  caseNumber: string
  counterparty: string
  classification: 'win' | 'lose' | 'neutral' | 'pending'
  /** dd.mm.yyyy as the court sends it */
  regDate?: string
}

export interface CounterpartyRecord {
  total: number
  win: number
  lose: number
  neutral: number
  pending: number
  /** the case numbers, newest registration first is the caller's job; here in input order */
  cases: string[]
}

export function counterpartyRecord(cases: readonly CounterpartyCase[], counterparty: string, exceptCase?: string): CounterpartyRecord {
  const rec: CounterpartyRecord = { total: 0, win: 0, lose: 0, neutral: 0, pending: 0, cases: [] }
  if (!counterparty.trim()) return rec
  for (const c of cases) {
    if (exceptCase && c.caseNumber === exceptCase) continue
    if (!samePartyName(counterparty, c.counterparty)) continue
    rec.total++
    rec[c.classification]++
    rec.cases.push(c.caseNumber)
  }
  return rec
}
