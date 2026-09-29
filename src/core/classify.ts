/**
 * PURE classification / matching / dedup logic — P1 of the rebuild blueprint.
 *
 * Ported VERBATIM (function bodies) from src/lib/stats.ts so the scraper lib
 * and the core share one implementation. No I/O may ever live in this file.
 *
 * Business rules — the outcome is judged from the COMPANY'S side of the claim:
 *   - Da'vo qanoatlantirilgan (to'liq / qisman)  → plaintiff: WIN,  defendant: LOSE
 *   - Da'vo rad etilgan                          → plaintiff: LOSE, defendant: WIN
 *   - Da'vo qaytarilgan                          → NEUTRAL for both (nothing was decided)
 *   - Ko'rmasdan qoldirilgan / ish yuritishdan
 *     tugatilgan                                 → plaintiff: LOSE, defendant: NEUTRAL
 *   - empty / unknown                            → PENDING
 * "To'liq rad etilsin" is a rejection, not a satisfaction: only the word
 * «qanoatlantir…» (and not «qanoatlantirilmasin») counts as the claim being granted.
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
    .replace(/[\u2018\u2019\u02bb\u02bc]/g, "'")
    .trim()

  if (!r || r === '—' || r === '-') return 'pending'

  const has = (...words: string[]) => words.some((w) => r.includes(w))
  const full = has('тўлиқ', "to'liq", 'toliq')
  const partial = has('қисман', 'qisman')
  // "qanoatlantirilmasin/-magan" and "qanoatlantirishdan rad etilsin" say the claim was NOT granted
  const notGranted = has('қаноатлантирилма', 'qanoatlantirilma', 'қаноатлантиришдан', 'qanoatlantirishdan')
  // "Rad etilgan" / "Rad qilingan" — match the key word "rad".
  const rejected = notGranted || has('рад', 'rad ') || r.endsWith('rad')
  // "to'liq"/"qisman" alone only mean «granted» when nothing rejects the claim ("to'liq rad etilsin")
  const granted =
    !notGranted && (has('қаноатлантир', 'qanoatlantir') || ((full || partial) && !rejected))
  const returned = has('қайтарилган', 'qaytarilgan', 'қайтарилсин', 'qaytarilsin')
  const leftWithoutReview = has('кўрмасдан', "ko'rmasdan", 'kormasdan')
  // Terminated without ruling.
  const terminated = has('тугатилган', 'tugatilgan')

  if (granted) return role === 'plaintiff' ? 'win' : 'lose'
  if (returned) return 'neutral' // returned claims are just returned — no winner
  if (rejected) return role === 'plaintiff' ? 'lose' : 'win'
  if (leftWithoutReview || terminated) return role === 'plaintiff' ? 'lose' : 'neutral'
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
