/**
 * PURE classification / matching / dedup logic — P1 of the rebuild blueprint.
 *
 * Ported VERBATIM (function bodies) from src/lib/stats.ts so the scraper lib
 * and the core share one implementation. No I/O may ever live in this file.
 *
 * Business rules (STATS-TAB-SPEC "Interpretation A"):
 *   - To'liq / Qisman qanoatlantirilgan                    → WIN (either role)
 *   - Rad etilgan / Qaytarilgan / Ko'rmasdan qoldirilgan /
 *     Ish yuritishdan tugatilgan                            → plaintiff: LOSE,
 *                                                              defendant: NEUTRAL
 *   - empty / unknown                                       → PENDING
 */

export type StatsCourtType = 'economic' | 'civil' | 'administrative'
export type Classification = 'win' | 'lose' | 'neutral' | 'pending'
export type PartyRole = 'plaintiff' | 'defendant'

/** Normalize a company/party name for matching (quotes, case, MChJ/AJ/OOO/OAO expansions, both scripts). */
export function normalizeName(s: string): string {
  return (s || '')
    .replace(/["«»“”„"'’‘`]/g, '')
    .toLowerCase()
    // Latin Uzbek expansions
    .replace(/\bmchj\b/g, "mas'uliyati cheklangan jamiyati")
    .replace(/\baj\b/g, 'aktsiyadorlik jamiyati')
    .replace(/\booo\b/g, "mas'uliyati cheklangan jamiyati")
    .replace(/\boao\b/g, 'aktsiyadorlik jamiyati')
    // Cyrillic Uzbek expansions (match what jadvalapi / jadval APIs return)
    .replace(/\bmchj\b/g, 'масъулияти чекланган жамияти')
    .replace(/\baj\b/g, 'акционерлик жамияти')
    .replace(/\booo\b/g, 'масъулияти чекланган жамияти')
    .replace(/\boao\b/g, 'акционерлик жамияти')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Fuzzy name match: substring either way, or ≥2 significant shared words. */
export function nameMatches(companyNorm: string, partyNorm: string): boolean {
  if (!companyNorm || !partyNorm) return false
  if (partyNorm.includes(companyNorm)) return true
  if (companyNorm.includes(partyNorm)) return true

  const cWords = companyNorm.split(' ').filter((w) => w.length > 2)
  const pWords = partyNorm.split(' ').filter((w) => w.length > 2)
  if (cWords.length === 0 || pWords.length === 0) return false

  let matchCount = 0
  for (const cw of cWords) {
    if (pWords.some((pw) => pw === cw || pw.includes(cw) || cw.includes(pw))) {
      matchCount++
    }
  }
  return matchCount >= Math.min(2, cWords.length)
}

/** Classify an Uzbek (Cyrillic or Latin) case outcome from the company's role. */
export function classifyOutcome(role: PartyRole, result: string): Classification {
  const r = (result || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .trim()

  if (!r || r === '—' || r === '-') return 'pending'

  const full = r.includes('тўлиқ') || r.includes("to'liq") || r.includes('toliq')
  const partial = r.includes('қисман') || r.includes('qisman')
  // "Rad etilgan" / "Rad qilingan" — match the key word "rad" alone.
  const rejected = r.includes('рад') || r.includes('rad ')
  const returned = r.includes('қайтарилган') || r.includes('qaytarilgan')
  const leftWithoutReview =
    r.includes('кўрмасдан') || r.includes("ko'rmasdan") || r.includes('kormasdan')
  // Terminated without ruling — treated as rejection.
  const terminated = r.includes('тугатилган') || r.includes('tugatilgan')

  if (full || partial) return 'win'
  if (rejected || returned || leftWithoutReview || terminated) {
    return role === 'plaintiff' ? 'lose' : 'neutral'
  }
  return 'pending'
}

/**
 * v149 rule: re-map a case's court type from its case-number prefix.
 * jadval.sud.uz findByTin returns ALL case types; prefixes disambiguate:
 *   4- = economic, 2-/3- = civil, 5- = administrative, 1- = criminal.
 */
export function remapCourtTypeByCaseNumber(
  declared: StatsCourtType,
  caseNumber: string,
): StatsCourtType {
  const cn = caseNumber || ''
  if (cn.startsWith('5-')) return 'administrative'
  if (cn.startsWith('2-') || cn.startsWith('3-')) return 'civil'
  if (cn.startsWith('4-')) return 'economic'
  return declared
}

/** Dedupe classified cases by caseNumber (first occurrence wins). */
export function dedupCases<T extends { caseNumber: string }>(cases: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const c of cases) {
    if (c.caseNumber && !seen.has(c.caseNumber)) {
      seen.add(c.caseNumber)
      out.push(c)
    }
  }
  return out
}

export interface CompanyStatsSummary {
  total: number
  win: number
  lose: number
  neutral: number
  pending: number
  asPlaintiff: number
  asDefendant: number
}

/** Fold a list of classified cases into the summary counters. */
export function summarize<T extends { classification: Classification; role: PartyRole }>(
  cases: T[],
): CompanyStatsSummary {
  const summary: CompanyStatsSummary = {
    total: cases.length,
    win: 0,
    lose: 0,
    neutral: 0,
    pending: 0,
    asPlaintiff: 0,
    asDefendant: 0,
  }
  for (const c of cases) {
    summary[c.classification]++
    if (c.role === 'plaintiff') summary.asPlaintiff++
    else summary.asDefendant++
  }
  return summary
}
