/**
 * Stats workflow — aggregates all court cases (economic + civil + administrative)
 * for a given company TIN, classifies each as WIN / LOSE / NEUTRAL / PENDING
 * based on the company's role (plaintiff vs defendant) and the case outcome.
 *
 * Data flow (all fetches routed through CF workers — NEVER direct):
 *   1. orginfo.uz      → company name (getCompanyByTin, already worker-routed)
 *   2. jadvalapi.sud.uz → ECONOMIC findByTin (merged with jadval.sud.uz findByTin via searchCourtCases)
 *   3. jadvalapi.sud.uz → CIVIL findByTin (NEW endpoint, added in court-case.ts)
 *   4. jadvalapi.sud.uz → CONFLICT findByTin (administrative)
 *
 * The 3 court-type searches fire IN PARALLEL via searchCourtCases. Each call
 * internally routes through the CF Worker pool (round-robin) to avoid IP blocks.
 *
 * If one court type fails (e.g. jadvalapi returns 521), the function still
 * returns the cases from the court types that succeeded, with an error note
 * attached for the failed one — the request never fails wholesale.
 */

import { searchCourtCasesDetailed, type CourtCase } from './court-case'
import { getCompanyByTin } from './orginfo'
import { getCompanyRating } from './chamber'

// ---- Types (returned to API + consumed by client) --------------------

export type StatsCourtType = 'economic' | 'civil' | 'administrative'
export type Classification = 'win' | 'lose' | 'neutral' | 'pending'
export type PartyRole = 'plaintiff' | 'defendant'

export interface CaseWithClassification {
  caseNumber: string
  courtType: StatsCourtType
  regDate: string            // DD.MM.YYYY (raw)
  result: string             // raw Uzbek outcome (Cyrillic or Latin)
  classification: Classification
  role: PartyRole
  court: string
  category: string
  counterparty: string       // the OTHER party's name
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

export interface CompanyStatsCompany {
  name: string
  tin: string
  region?: string
  status?: string
  officialName?: string
  shortName?: string
}

export interface CourtTypeError {
  courtType: StatsCourtType
  error: string
}

export interface CompanyStats {
  company: CompanyStatsCompany
  cases: CaseWithClassification[]
  summary: CompanyStatsSummary
  errors: CourtTypeError[]
  /** v204 (P-E): chamber.uz rating, threaded from the already-fetched
   *  getCompanyRating(tin) result (null when chamber failed/no data). */
  rating: { score: number; category: string } | null
}

// ---- Name normalization + matching -----------------------------------

/**
 * Normalize a company/party name for matching:
 *  - strip surrounding quotes (", «, », „, ", ', etc.)
 *  - lowercase
 *  - expand "MChJ" → "mas'uliyati cheklangan jamiyati" (Latin) and
 *    "масъулияти чекланган жамияти" (Cyrillic) so abbreviations and full
 *    Uzbek forms match each other regardless of script. Same for AJ →
 *    "aktsiyadorlik jamiyati" / "акционерлик жамияти". The sud.uz APIs return
 *    Cyrillic, but orginfo.uz + chamber.uz sometimes return Latin — we cover
 *    both so matching works in either direction.
 *  - collapse whitespace
 */
function normalizeName(s: string): string {
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

/**
 * Check whether a normalized party field (plaintiff or defendant) contains
 * a reference to the normalized company name. We try several strategies:
 *   1. Direct substring match (either direction)
 *   2. First 2 significant words of company name appear in party field
 *   3. First 3 significant words of company name appear in party field
 */
function nameMatches(companyNorm: string, partyNorm: string): boolean {
  if (!companyNorm || !partyNorm) return false
  if (partyNorm.includes(companyNorm)) return true
  if (companyNorm.includes(partyNorm)) return true

  const cWords = companyNorm.split(' ').filter(w => w.length > 2)
  const pWords = partyNorm.split(' ').filter(w => w.length > 2)
  if (cWords.length === 0 || pWords.length === 0) return false

  // Match if >=2 of the company's words appear in the party field
  let matchCount = 0
  for (const cw of cWords) {
    if (pWords.some(pw => pw === cw || pw.includes(cw) || cw.includes(pw))) {
      matchCount++
    }
  }
  return matchCount >= Math.min(2, cWords.length)
}

// ---- Classification ---------------------------------------------------

/**
 * Classify a case outcome (Uzbek Cyrillic or Latin) into WIN / LOSE / NEUTRAL
 * / PENDING, based on the company's role.
 *
 * Per user's rule (Interpretation A from STATS-TAB-SPEC.md):
 *   - To'liq qanoatlantirilgan / Qisman qanoatlantirilgan → WIN (both roles)
 *   - Rad etilgan / Qaytarilgan / Ko'rmasdan qoldirilgan
 *       → plaintiff: LOSE
 *       → defendant: NEUTRAL
 *   - empty / unknown / pending → PENDING
 *
 * The matching checks BOTH Cyrillic and Latin forms because the sud.uz APIs
 * return Cyrillic while some downstream sources (chamber.uz, our own UI)
 * produce Latin.
 */
function classifyOutcome(role: PartyRole, result: string): Classification {
  const r = (result || '')
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .trim()

  if (!r || r === '—' || r === '-') return 'pending'

  const full = r.includes('тўлиқ') || r.includes("to'liq") || r.includes('toliq')
  const partial = r.includes('қисман') || r.includes('qisman')
  // "Rad etilgan" and "Rad qilingan" are both rejection outcomes — match on
  // the key word "rad" alone (Cyrillic "рад" / Latin "rad ").
  const rejected = r.includes('рад') || r.includes('rad ')
  const returned = r.includes('қайтарилган') || r.includes('qaytarilgan')
  const leftWithoutReview =
    r.includes('кўрмасдан') || r.includes("ko'rmasdan") || r.includes('kormasdan')
  // "Ish yuritishdan tugatilgan" — case terminated without ruling. Treat the
  // same as a rejection (plaintiff: LOSE, defendant: NEUTRAL).
  const terminated = r.includes('тугатилган') || r.includes('tugatilgan')

  if (full || partial) return 'win'
  if (rejected || returned || leftWithoutReview || terminated) {
    return role === 'plaintiff' ? 'lose' : 'neutral'
  }
  return 'pending'
}

// ---- Court-type label map --------------------------------------------

const COURT_TYPE_MAP: Record<StatsCourtType, StatsCourtType> = {
  economic: 'economic',
  civil: 'civil',
  administrative: 'administrative',
}

// ---- Main workflow ----------------------------------------------------

/**
 * v139: Server-side in-memory cache for getCompanyStats results.
 *
 * Problem: When both the Stats tab and the Watchlist tab load for the same
 * TIN simultaneously, TWO /api/stats calls fire. Each calls searchCourtCases
 * independently — one might get 51 cases, the other 28 (if some CF Workers
 * fail). The user sees whichever completes last, which may be the smaller set.
 *
 * Solution: Cache the result for 60 seconds. The FIRST call fetches and caches;
 * the second call gets the cached result instantly. This also means if the
 * first call got 51 cases and the second would have gotten 28, the second
 * still gets 51 (the better result).
 *
 * The 60s TTL is short enough that a user clicking "refresh" after a minute
 * gets fresh data, but long enough to deduplicate concurrent calls.
 */
interface StatsCacheEntry {
  result: Promise<CompanyStats>
  ts: number
}
const statsCache = new Map<string, StatsCacheEntry>()
const STATS_CACHE_TTL = 60 * 1000 // 60 seconds

/**
 * Build the full stats payload for a company TIN.
 *
 * 1. Lookup company on orginfo.uz (worker-routed) — gives us the canonical
 *    company name used for plaintiff/defendant matching.
 * 2. In parallel, fire TIN searches on all 3 court types via searchCourtCases
 *    (each call is internally worker-routed through the CF pool).
 * 3. Merge + classify every case.
 * 4. Compute summary counts.
 *
 * If orginfo fails, we still proceed using the TIN itself as the company
 * identifier (matching will be looser but the workflow won't fail). If a court
 * type fetch fails, we return partial results with the error noted.
 */
export async function getCompanyStats(
  tin: string,
): Promise<CompanyStats> {
  console.log(`[stats] building stats for TIN ${tin}`)

  // v139: Check server-side cache first — deduplicates concurrent calls
  const cached = statsCache.get(tin)
  if (cached && Date.now() - cached.ts < STATS_CACHE_TTL) {
    console.log(`[stats] ${tin}: returning cached result (age ${Math.round((Date.now() - cached.ts) / 1000)}s)`)
    return cached.result
  }

  // Fire the actual fetch and store the PROMISE (not the result) so that
  // concurrent calls all await the same in-flight fetch.
  const fetchPromise = fetchCompanyStatsInternal(tin)
  statsCache.set(tin, { result: fetchPromise, ts: Date.now() })

  // Clean up old entries (sweep — don't let the map grow unbounded)
  if (statsCache.size > 50) {
    const now = Date.now()
    for (const [k, v] of statsCache) {
      if (now - v.ts > STATS_CACHE_TTL * 5) statsCache.delete(k)
    }
  }

  return fetchPromise
}

/** Internal fetch logic — called once per TIN, cached by getCompanyStats. */
async function fetchCompanyStatsInternal(
  tin: string,
): Promise<CompanyStats> {

  // Fire orginfo + chamber.uz + 3 court-type searches ALL IN PARALLEL.
  // Previously orginfo was awaited first — if it timed out (30s), the entire
  // API response was a 504 even though court cases were found. Now orginfo
  // runs alongside the court searches; if it fails, we fall back to the
  // company name from chamber.uz before resorting to TIN-only matching.
  const courtTypes: StatsCourtType[] = ['economic', 'civil', 'administrative']

  const [orginfoResult, chamberResult, ...courtResults] = await Promise.allSettled([
    getCompanyByTin(tin).catch(e => { throw e }),
    getCompanyRating(tin),
    // v153: searchCourtCasesDetailed (not searchCourtCases) — also reports
    // `incomplete` when a source failed on every proxy/retry, so we can warn
    // instead of silently returning a too-low total. See court-case.ts.
    ...courtTypes.map(ct => searchCourtCasesDetailed(ct, 'tin', tin)),
  ])

  // Process orginfo result (non-blocking — fallback to chamber.uz, then TIN)
  let company: CompanyStatsCompany
  let companyNameNorm = ''
  let chamberName = ''
  if (chamberResult.status === 'fulfilled' && chamberResult.value) {
    chamberName = chamberResult.value.name || chamberResult.value.nameLat || chamberResult.value.nameRu || ''
  }
  if (orginfoResult.status === 'fulfilled' && orginfoResult.value) {
    const info = orginfoResult.value
    const name = info.shortName || info.officialName || chamberName || `STIR ${tin}`
    company = {
      name,
      tin: info.tin || tin,
      region: info.address || '',
      status: info.status || '',
      officialName: info.officialName || '',
      shortName: info.shortName || '',
    }
    companyNameNorm = normalizeName(name)
  } else {
    if (orginfoResult.status === 'rejected') {
      console.warn(`[stats] orginfo lookup failed: ${orginfoResult.reason instanceof Error ? orginfoResult.reason.message : orginfoResult.reason}`)
    }
    // orginfo failed — try chamber.uz for the company name (it returns the
    // registered name along with the rating). Better than TIN-substring match.
    if (chamberName) {
      console.log(`[stats] using chamber.uz name as fallback: ${chamberName}`)
      company = {
        name: chamberName,
        tin,
        region: chamberResult.status === 'fulfilled' && chamberResult.value
          ? chamberResult.value.regionNameUz || ''
          : '',
      }
      companyNameNorm = normalizeName(chamberName)
    } else {
      company = { name: `STIR ${tin}`, tin }
    }
  }

  // Process court case results
  const errors: CourtTypeError[] = []
  const allCases: CaseWithClassification[] = []

  courtResults.forEach((res, i) => {
    const ct = courtTypes[i]
    if (res.status === 'fulfilled') {
      const { cases: rawCases, incomplete } = res.value
      // v153: A source failed on every proxy + retry (couldn't confirm
      // real case count) — surface it instead of staying silent. This is
      // what used to happen invisibly whenever jadval.sud.uz / jadvalapi.sud.uz
      // was unreachable from the user's network: the total just looked low,
      // with no indication the data was incomplete.
      if (incomplete) {
        errors.push({
          courtType: ct,
          error: "Baʼzi manbalarga ulanib boʻlmadi. Natija toʻliq boʻlmasligi mumkin (qayta urinib koʻring)",
        })
      }
      for (const raw of rawCases) {
        // v149: Re-classify court type based on case number prefix.
        // jadval.sud.uz/case/findByTin returns ALL case types (economic + civil + admin),
        // not just economic. Case number prefixes:
        //   4- = economic, 2-/3- = civil, 5- = administrative, 1- = criminal
        let actualCourtType = ct
        const cn = raw.caseNumber || ''
        if (cn.startsWith('5-')) actualCourtType = 'administrative'
        else if (cn.startsWith('2-') || cn.startsWith('3-')) actualCourtType = 'civil'
        else if (cn.startsWith('4-')) actualCourtType = 'economic'

        const cwc = classifyCase(raw, actualCourtType, companyNameNorm, tin)
        if (cwc) allCases.push(cwc)
      }
    } else {
      const msg = res.reason instanceof Error ? res.reason.message : String(res.reason)
      console.warn(`[stats] ${ct} search failed: ${msg}`)
      errors.push({ courtType: ct, error: msg })
    }
  })

  // 3. Deduplicate by case number (a case might appear in both jadval.sud.uz
  //    and jadvalapi.sud.uz for economic — searchCourtCases already dedupes
  //    within itself, but we still guard here)
  const seen = new Set<string>()
  const deduped: CaseWithClassification[] = []
  for (const c of allCases) {
    if (c.caseNumber && !seen.has(c.caseNumber)) {
      seen.add(c.caseNumber)
      deduped.push(c)
    }
  }

  // 4. Summary
  const summary: CompanyStatsSummary = {
    total: deduped.length,
    win: 0,
    lose: 0,
    neutral: 0,
    pending: 0,
    asPlaintiff: 0,
    asDefendant: 0,
  }
  for (const c of deduped) {
    summary[c.classification]++
    if (c.role === 'plaintiff') summary.asPlaintiff++
    else summary.asDefendant++
  }

  console.log(
    `[stats] ${tin}: ${summary.total} cases (${summary.win}W / ${summary.lose}L / ${summary.neutral}N / ${summary.pending}P)` +
    (errors.length ? ` · ${errors.length} court-type errors` : ''),
  )

  // v204 (P-E): surface the chamber rating (score 0-100 + category band) that
  // is already fetched in parallel — previously it was fetched and dropped.
  const rating =
    chamberResult.status === 'fulfilled' && chamberResult.value
      ? {
          score: typeof chamberResult.value.criteriaAll === 'number' ? chamberResult.value.criteriaAll : 0,
          category: chamberResult.value.type || '',
        }
      : null

  return {
    company,
    cases: deduped,
    summary,
    errors,
    rating,
  }
}

/**
 * Turn a raw CourtCase from searchCourtCases into a classified CaseWithClassification.
 *
 * Determines the company's role (plaintiff or defendant) by name-matching the
 * company name (from orginfo) against the case's plaintiff and defendant fields.
 * If orginfo failed and we don't have a company name, fall back to matching the
 * TIN itself as a substring in those fields (sometimes the TIN appears in the
 * party string).
 */
function classifyCase(
  raw: CourtCase,
  courtType: StatsCourtType,
  companyNameNorm: string,
  tin: string,
): CaseWithClassification | null {
  if (!raw || !raw.caseNumber || raw.caseNumber === '—' || raw.caseNumber === '-') return null

  const plaintiffRaw = raw.plaintiff || ''
  const defendantRaw = raw.defendant || ''

  let role: PartyRole
  if (companyNameNorm && nameMatches(companyNameNorm, normalizeName(plaintiffRaw))) {
    role = 'plaintiff'
  } else if (companyNameNorm && nameMatches(companyNameNorm, normalizeName(defendantRaw))) {
    role = 'defendant'
  } else if (plaintiffRaw.includes(tin)) {
    role = 'plaintiff'
  } else if (defendantRaw.includes(tin)) {
    role = 'defendant'
  } else {
    // TIN-guaranteed match — default to plaintiff when we can't determine role
    role = 'plaintiff'
  }

  const classification = classifyOutcome(role, raw.result)
  const counterparty = role === 'plaintiff' ? defendantRaw : plaintiffRaw

  return {
    caseNumber: raw.caseNumber,
    courtType: COURT_TYPE_MAP[courtType],
    regDate: raw.dateFiled || '',
    result: raw.result || '',
    classification,
    role,
    court: raw.courtName || '',
    category: raw.caseType || '',
    counterparty: counterparty || '-',
  }
}
