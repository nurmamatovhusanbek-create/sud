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

import { uzCyrToLat } from './translit'

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

// ---- which side is the company? ---------------------------------------------------------------
//
// Why this is not name matching alone:
//  - nameMatches() above is deliberately loose and has a known quirk: normalizeName() expands «MChJ» into
//    three words, so any two MChJs «share ≥ 2 words» and match → every case against another MChJ was a «plaintiff».
//  - The courts answer in Cyrillic («ПРОКАБ» МЧЖ), the registers in Latin (PROCAB MChJ), and the spelling
//    differs beyond script (c/k, q/k, x/h): the same company simply does not match itself (out of 100 cases
//    0 plaintiff, 3 defendant, the rest «unknown»).
// So the sides are decided from the DATA first. Every case in the list was found by the company's TIN, so the
// company is a party of (nearly) every case: its spelling is the one name that appears in almost all of them.
// assignRoles() LEARNS that name from the list (script- and spelling-insensitive), uses the known company names
// only as a tie-break / fallback, and trusts a TIN inside the party text over everything.

const LEGAL_FORM = /^(mchj|aj|ooo|oao|ao|xk|uk|fx|yatt|ok|mas\w*uliyat\w*|cheklangan|jamiyat\w*|ak?t?s\w*(?:dor|ioner)\w*|xususiy|korxona\w*|qoshma|kooperativ\w*)$/

/** The part of a party name that tells companies apart: lowercase Latin, no quotes, no legal-form words. */
export function distinctiveName(s: string): string {
  return uzCyrToLat(s || '')
    .toLowerCase()
    .replace(/["«»“”„'’‘`ʻʼ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !LEGAL_FORM.test(w))
    .join(' ')
}

/** One word reduced to a spelling-proof skeleton (no vowels, no doubled letters, look-alike consonants folded): «procab» = «prokab» = «прокап». */
function skeleton(w: string): string {
  // c/q→k, x→h, w→v; voiced = voiceless (b/p, d/t, g/k, v/f, z/s): final devoicing is written both ways («прокаб» / «прокап»)
  const f = w.replace(/[cq]/g, 'k').replace(/x/g, 'h').replace(/w/g, 'v').replace(/b/g, 'p').replace(/d/g, 't').replace(/g/g, 'k').replace(/v/g, 'f').replace(/z/g, 's')
  const k = f.replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1')
  return k || f
}

/** The words of a party name as skeletons (legal-form words dropped). */
export function partyTokens(s: string): string[] {
  const d = distinctiveName(s)
  return d ? d.split(' ').map(skeleton) : []
}

/** Is a shared-words match specific enough to mean the same company? («a», «os» would match anything) */
const specific = (t: string[]): boolean => t.length > 1 || (t.length === 1 && t[0].length >= 3)

/** Same company: all words of the shorter name are among the words of the longer. */
function sameTokens(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false
  const [sh, lg] = a.length <= b.length ? [a, b] : [b, a]
  return specific(sh) && sh.every((w) => lg.includes(w))
}

/** Same company, by name only (script- and spelling-insensitive). */
export function samePartyName(a: string, b: string): boolean {
  return sameTokens(partyTokens(a), partyTokens(b))
}

/** a party field may list several parties */
const PARTS = /[;\n]+|,(?=\s*["«“”A-ZА-ЯЎҚҒҲa-zа-яўқғҳ0-9])/

export interface PartyPair {
  plaintiff?: string | null
  defendant?: string | null
}

export type RoleMethod = 'tin' | 'learned' | 'name' | 'none'

export interface RoleResult {
  /** per input case; `null` = cannot tell (never guessed) */
  roles: (PartyRole | null)[]
  /** how the company's name was found: learned from the list, from the known names, or nothing matched */
  method: RoleMethod
  /** the company's spelling(s) used (skeleton words), for tests and debugging */
  keys: string[][]
}

const clean = (v: string | null | undefined): string => {
  const s = (v ?? '').trim()
  return s === '-' || s === '—' ? '' : s
}

/**
 * Which side the company is on in EACH case of a list. `company.names` are the names we know it by (any
 * script); `company.tin` its 9-digit id. Order of trust: a TIN in the party text → the name that appears in
 * most of the cases (learned) → the known names → unknown.
 */
export function assignRoles(cases: readonly PartyPair[], company: { names?: readonly (string | undefined)[]; tin?: string }): RoleResult {
  // a 9-digit TIN, as a whole number inside the party text (a shorter «tin» would match any digit)
  const tinRe = /^\d{9}$/.test((company.tin || '').trim()) ? new RegExp(`(?<!\\d)${(company.tin || '').trim()}(?!\\d)`) : null
  const rows = cases.map((c) => {
    const p = clean(c.plaintiff)
    const d = clean(c.defendant)
    return { p, d, pParts: p.split(PARTS).map(partyTokens).filter((t) => t.length), dParts: d.split(PARTS).map(partyTokens).filter((t) => t.length), pAll: partyTokens(p), dAll: partyTokens(d) }
  })
  const N = rows.length

  // candidate names = every party part, scored by how many cases contain it (once per case, on either side)
  const present = (r: (typeof rows)[number], key: string[]): 'p' | 'd' | 'both' | null => {
    const inP = r.pParts.some((t) => sameTokens(t, key)) || sameTokens(r.pAll, key)
    const inD = r.dParts.some((t) => sameTokens(t, key)) || sameTokens(r.dAll, key)
    return inP && inD ? 'both' : inP ? 'p' : inD ? 'd' : null
  }
  const cand = new Map<string, { key: string[]; cover: number; exact: number }>()
  for (const r of rows) {
    const seen = new Set<string>()
    for (const t of [...r.pParts, ...r.dParts]) {
      if (!specific(t)) continue
      const id = t.join(' ')
      if (seen.has(id)) continue
      seen.add(id)
      const c = cand.get(id) ?? { key: t, cover: 0, exact: 0 }
      c.exact++
      cand.set(id, c)
    }
  }
  const hints = (company.names ?? []).map((n) => partyTokens(n ?? '')).filter(specific)
  const hinted = (key: string[]) => hints.some((h) => sameTokens(h, key))
  // the company is in most cases, so its spelling(s) are among the most frequent exact names: only those (plus the
  // ones that look like a known name) are scored against the whole list, which keeps this O(cases × 50)
  const scored = [...cand.values()].sort((a, b) => b.exact - a.exact).slice(0, 40)
  for (const c of cand.values()) if (!scored.includes(c) && hinted(c.key) && scored.length < 50) scored.push(c)
  for (const c of scored) for (const r of rows) if (present(r, c.key)) c.cover++

  let keys: string[][] = []
  let method: RoleMethod = 'none'
  const ranked = scored.sort((a, b) => b.cover - a.cover)
  const top = ranked[0]
  // learned: one name in most of the cases (≥ 60 % and ≥ 2); on a tie between unrelated names the known names decide
  if (top && top.cover >= Math.max(2, Math.ceil(N * 0.6))) {
    const tied = ranked.filter((c) => c.cover === top.cover)
    const shortest = tied.reduce((m, c) => (c.key.length < m.key.length ? c : m), tied[0])
    // spellings of ONE name («PROCAB», «PROCAB GROUP») are the same company; unrelated names on a tie: the known names decide
    const pick = tied.every((c) => sameTokens(c.key, shortest.key)) ? tied : tied.filter((c) => hinted(c.key))
    if (pick.length >= 1 && (pick.length === 1 || pick.every((c) => sameTokens(c.key, pick[0].key)))) {
      keys = pick.map((c) => c.key)
      // other spellings of the same company seen in fewer cases («PROCAB GROUP» next to «PROCAB»)
      for (const c of ranked) if (c.cover < top.cover && keys.some((k) => sameTokens(k, c.key)) && !keys.includes(c.key)) keys.push(c.key)
      method = 'learned'
    }
  }
  if (!keys.length && hints.length && N) {
    keys = hints
    method = 'name'
  }

  const roles = rows.map((r): PartyRole | null => {
    if (tinRe) {
      const inP = tinRe.test(r.p)
      const inD = tinRe.test(r.d)
      if (inP !== inD) return inP ? 'plaintiff' : 'defendant'
    }
    let inP = false
    let inD = false
    for (const k of keys) {
      const w = present(r, k)
      if (w === 'p' || w === 'both') inP = true
      if (w === 'd' || w === 'both') inD = true
    }
    return inP && !inD ? 'plaintiff' : inD && !inP ? 'defendant' : null // both sides (the company against itself) or neither: not guessed
  })
  if (method === 'none' && roles.some((x) => x)) method = 'tin'
  return { roles, method, keys }
}

/** one case on its own (the learning needs a list, so this only has the known names and the TIN) */
export function partyRole(company: { names: readonly (string | undefined)[]; tin?: string }, plaintiff: string, defendant: string): PartyRole | null {
  return assignRoles([{ plaintiff, defendant }], company).roles[0]
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
