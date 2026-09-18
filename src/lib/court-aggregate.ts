import 'server-only'
import { searchCourtCases } from '@/lib/court-case'
import { getCompanyByTin } from '@/lib/orginfo'
import { docketEnabled } from '@/lib/db/pool'
import { findCasesByName, docketMatchToCourtCase } from '@/lib/db/docket-repo'
import type { CourtCase, CourtType } from '@/lib/court-case-types'

/**
 * v205 (§6): The aggregate case lookup for a company STIR.
 *
 *   1) live findByTin across economic + civil + administrative (existing engine,
 *      each call already unions jadval.sud.uz + jadvalapi.sud.uz internally),
 *   2) name discovery from the Postgres docket index (best-effort; skipped
 *      entirely when DATABASE_URL is not configured).
 *
 * Results are merged and deduped by caseNumber; TIN results win on conflict
 * (they are richer). Every row carries `source: 'tin' | 'name'` so the UI can
 * badge index-discovered rows ("Nomdan topildi").
 */

export type AggCase = CourtCase & {
  source: 'tin' | 'name'
  courtType: CourtType
  matchScore?: number
}

export interface CompanyCasesResult {
  cases: AggCase[]
  /** Court types whose live TIN search failed entirely (honesty: "0 cases"
   *  from a type may mean "unreachable", not "none"). Drives the partial banner. */
  partial: CourtType[]
}

export async function getCompanyCases(stir: string): Promise<CompanyCasesResult> {
  const types: CourtType[] = ['economic', 'civil', 'administrative']

  // 1) live TIN searches (each already unions both hosts internally)
  const tinResults = await Promise.allSettled(
    types.map((t) => searchCourtCases(t, 'tin', stir)),
  )
  const byNumber = new Map<string, AggCase>()
  const partial: CourtType[] = []
  tinResults.forEach((r, i) => {
    if (r.status !== 'fulfilled') {
      partial.push(types[i])
      return
    }
    for (const c of r.value) {
      if (!c.caseNumber) continue
      if (!byNumber.has(c.caseNumber)) {
        byNumber.set(c.caseNumber, { ...c, source: 'tin', courtType: types[i] })
      }
    }
  })

  // 2) name discovery from the index (best-effort; skipped if DB not configured)
  if (docketEnabled()) {
    try {
      const info = await getCompanyByTin(stir)
      const names = [info?.officialName, info?.shortName].filter(Boolean) as string[]
      const seenNames = new Set<string>()
      for (const name of names) {
        if (seenNames.has(name)) continue
        seenNames.add(name)
        const matches = await findCasesByName(name, stir)
        for (const m of matches) {
          if (byNumber.has(m.caseNumber)) continue // TIN result already richer
          byNumber.set(m.caseNumber, docketMatchToCourtCase(m))
        }
      }
    } catch {
      /* index optional — never fail the whole lookup */
    }
  }

  return { cases: [...byNumber.values()], partial }
}
