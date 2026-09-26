/**
 * Претензия (Talabnoma) engine — pure, deterministic core.
 *
 * Given a debtor contract's main debt + payments (read from an «Акт сверки»
 * reconciliation xlsx) and a few dates, it computes the demand-letter figures:
 * total supplied, the statutory penalty (0.4%/day, capped at 50% of the debt),
 * the delay-day count, and the Russian «прописью» spelling of both money
 * amounts. No I/O here — the xlsx parsing lives in lib/pretenzia, the .docx
 * fill on the server. Everything is verifiable in isolation (see the golden
 * test, which reproduces real letters to the tiyin).
 *
 * Money is carried as INTEGER TIYIN (1 sum = 100 tiyin) end to end so the
 * arithmetic is exact — never as floating sum.
 */

// ---- money -----------------------------------------------------------------

/** Round a decimal sum (e.g. 5538730518.42) to integer tiyin. */
export function toTiyin(sum: number): number {
  return Math.round(sum * 100)
}

/** Format integer tiyin as «5 538 730 518,42» (thin-grouped, comma decimal). */
export function formatSum(tiyin: number): string {
  const neg = tiyin < 0
  const abs = Math.abs(tiyin)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${neg ? '-' : ''}${grouped},${String(frac).padStart(2, '0')}`
}

// ---- Russian number-to-words («прописью») ----------------------------------

const ONES_M = ['ноль', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
const ONES_F = ['ноль', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
const TEENS = [
  'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать',
  'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать',
]
const TENS = [
  '', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят',
  'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто',
]
const HUNDREDS = [
  '', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот',
  'шестьсот', 'семьсот', 'восемьсот', 'девятьсот',
]

/** Pick one/few/many by Russian pluralization of `n`. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  const mod10 = n % 10
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

/** Words for a 0–999 triplet. `feminine` picks одна/две for the units place. */
function tripletWords(n: number, feminine: boolean): string[] {
  const out: string[] = []
  const h = Math.floor(n / 100)
  const rest = n % 100
  if (h) out.push(HUNDREDS[h])
  if (rest >= 10 && rest <= 19) {
    out.push(TEENS[rest - 10])
  } else {
    const t = Math.floor(rest / 10)
    const u = rest % 10
    if (t) out.push(TENS[t])
    if (u) out.push((feminine ? ONES_F : ONES_M)[u])
  }
  return out
}

// Scale groups, least-significant first. group 0 = bare integer (сум is
// appended by the caller); the declension nouns cover 1000s / 10^6 / 10^9 / 10^12.
const SCALES: { feminine: boolean; forms?: [string, string, string] }[] = [
  { feminine: false }, // units (сум) — masculine один/два, no scale noun here
  { feminine: true, forms: ['тысяча', 'тысячи', 'тысяч'] },
  { feminine: false, forms: ['миллион', 'миллиона', 'миллионов'] },
  { feminine: false, forms: ['миллиард', 'миллиарда', 'миллиардов'] },
  { feminine: false, forms: ['триллион', 'триллиона', 'триллионов'] },
]

/**
 * Spell a non-negative integer in Russian. The last (units) triplet uses
 * masculine forms so it agrees with «сум»; the thousands triplet is feminine
 * («одна тысяча», «две тысячи»).
 */
export function spellInteger(value: number): string {
  let n = Math.floor(Math.abs(value))
  if (n === 0) return 'ноль'
  const triplets: number[] = []
  while (n > 0) {
    triplets.push(n % 1000)
    n = Math.floor(n / 1000)
  }
  const parts: string[] = []
  for (let i = triplets.length - 1; i >= 0; i--) {
    const t = triplets[i]
    if (t === 0) continue
    const scale = SCALES[i] ?? SCALES[SCALES.length - 1]
    parts.push(...tripletWords(t, scale.feminine))
    if (scale.forms) parts.push(plural(t, scale.forms[0], scale.forms[1], scale.forms[2]))
  }
  return parts.join(' ')
}

/**
 * Full «прописью» of a money amount in tiyin, e.g.
 * «пять миллиардов … восемнадцать сум 42 тийин». The tiyin remainder is given
 * as two digits (not spelled), matching the source letters.
 */
export function spellMoney(tiyin: number): string {
  const abs = Math.abs(tiyin)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  return `${spellInteger(whole)} сум ${String(frac).padStart(2, '0')} тийин`
}

// ---- dates -----------------------------------------------------------------

/** Add `n` banking days (skipping Sat/Sun) to `d`. Returns a new Date. */
export function addBankingDays(d: Date, n: number): Date {
  const r = new Date(d.getTime())
  let added = 0
  while (added < n) {
    r.setDate(r.getDate() + 1)
    const wd = r.getDay()
    if (wd !== 0 && wd !== 6) added++
  }
  return r
}

/** Whole days between two dates (UTC-safe, ignores time-of-day). */
function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}

/** Inclusive delay-day count: counts the start day, up to and incl. the claim day. */
export function delayDays(delayStart: Date, claimDate: Date): number {
  return calendarDaysBetween(delayStart, claimDate) + 1
}

/** Russian noun agreeing with a day count: 1 день · 2 дня · 5 дней. */
export function dayWord(days: number): string {
  const mod100 = days % 100
  if (mod100 >= 11 && mod100 <= 14) return 'дней'
  const mod10 = days % 10
  if (mod10 === 1) return 'день'
  if (mod10 >= 2 && mod10 <= 4) return 'дня'
  return 'дней'
}

/** «dd.mm.yyyy». */
export function formatDate(d: Date): string {
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`
}

// ---- the claim computation -------------------------------------------------

export interface PenaltyTerms {
  /** Daily penalty rate as a fraction, e.g. 0.004 for 0.4%/day. */
  ratePerDay: number
  /** Cap as a fraction of the main debt, e.g. 0.5 for «не более 50%». */
  capFraction: number
}

export const DEFAULT_TERMS: PenaltyTerms = { ratePerDay: 0.004, capFraction: 0.5 }

export interface ClaimInput {
  /** Main debt (Сальдо конечное, debit) in tiyin. */
  mainDebtTiyin: number
  /** Total payments/credits against the contract in tiyin (0 if none). */
  paymentTiyin: number
  /** First day of delay (просрочка с). */
  delayStart: Date
  /** Date the claim is issued (drives the day count and the header date). */
  claimDate: Date
  terms?: PenaltyTerms
}

export interface ClaimResult {
  mainDebtTiyin: number
  paymentTiyin: number
  /** mainDebt + payment. */
  suppliedTiyin: number
  days: number
  /** Uncapped penalty = mainDebt × rate × days (tiyin). */
  penaltyRawTiyin: number
  /** capFraction × mainDebt (tiyin). */
  penaltyCapTiyin: number
  /** Applied penalty = min(raw, cap) (tiyin). */
  penaltyTiyin: number
  penaltyCapped: boolean
}

/** Compute all demand-letter figures for one debtor contract. */
export function computeClaim(input: ClaimInput): ClaimResult {
  const terms = input.terms ?? DEFAULT_TERMS
  const mainDebtTiyin = Math.round(input.mainDebtTiyin)
  const paymentTiyin = Math.round(input.paymentTiyin)
  const suppliedTiyin = mainDebtTiyin + paymentTiyin
  const days = delayDays(input.delayStart, input.claimDate)
  const penaltyRawTiyin = Math.round(mainDebtTiyin * terms.ratePerDay * days)
  const penaltyCapTiyin = Math.round(mainDebtTiyin * terms.capFraction)
  const penaltyCapped = penaltyRawTiyin > penaltyCapTiyin
  const penaltyTiyin = penaltyCapped ? penaltyCapTiyin : penaltyRawTiyin
  return {
    mainDebtTiyin,
    paymentTiyin,
    suppliedTiyin,
    days,
    penaltyRawTiyin,
    penaltyCapTiyin,
    penaltyTiyin,
    penaltyCapped,
  }
}

/**
 * The parenthetical payment clause after the supplied-total sentence:
 *   payment > 0 → «(частичная оплата составила X сум)»
 *   payment = 0 → «(оплата не производилась)»
 */
export function paymentClause(paymentTiyin: number): string {
  return paymentTiyin > 0
    ? `(частичная оплата составила ${formatSum(paymentTiyin)} сум)`
    : '(оплата не производилась)'
}
