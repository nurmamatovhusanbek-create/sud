import { futureUpcoming, type CompanyRecord } from './registry'
import type { CompanySortRow } from '@/core/company-sort'

export type CompanyRow = CompanySortRow & { rec: CompanyRecord; hearingIso: string | null; debt: number | null }

/**
 * The sortable facts of a registry record, shared by every look's company list so they all order the same way.
 * Unknown stays unknown (null/undefined), it is never turned into a zero: bills never opened = no debt figure.
 */
export function companyRows(records: CompanyRecord[]): CompanyRow[] {
  return records.map((rec) => {
    const m = rec.meta
    return {
      rec,
      stir: rec.stir,
      name: rec.name,
      score: m?.score,
      cases: m?.cases,
      winRate: m?.winRate,
      hearingIso: futureUpcoming(m)[0]?.iso ?? null,
      debt: m?.billsLoadedAt ? m.overdueTotal ?? 0 : null,
    }
  })
}
