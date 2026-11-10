import { parseDate } from './derive'

/**
 * Checks on what was typed into a document form, before it goes into a file. Pure and isomorphic (the editor shows them
 * live and again before the download).
 *
 * Two levels: `error` = cannot be right (an impossible date or time, a period that ends before it starts, a bad
 * e-mail); `warn` = unusual for this field (a passport or phone that does not look like one, a Cyrillic name in a field
 * that is written in Latin). Nothing here BLOCKS a download: the person knows their case (a foreign passport has its
 * own shape); the check only makes sure they saw the problem. Empty values are not «invalid»: they are reported
 * separately (`emptyFields`).
 */

export type IssueLevel = 'error' | 'warn'
export interface Issue {
  key: string
  level: IssueLevel
  msg: string
}

const digits = (s: string): string => s.replace(/\D/g, '')
const CYR = /[Ѐ-ӿ]/
const LAT = /[A-Za-z]/

/** the checks per field key; each returns a message or null */
type Rule = { level: IssueLevel; test: (v: string) => string | null }

const dateOk = (v: string): string | null => (parseDate(v) ? null : 'Sana toʻgʻri emas (kk.oo.yyyy)')
const yearOk = (v: string): string | null => {
  const p = parseDate(v)
  return p && (p.y < 1900 || p.y > 2100) ? 'Yil juda uzoq' : null
}
const phone = (v: string): string | null => {
  const d = digits(v)
  return d.length === 9 || (d.length === 12 && d.startsWith('998')) ? null : 'Telefon +998 XX XXX XX XX koʻrinishida boʻlishi kerak'
}
const uzPassport = (v: string): string | null => (/^[A-Za-z]{2}\s?\d{7}$/.test(v.trim()) ? null : 'Pasport: 2 ta harf va 7 ta raqam (AA 1234567)')
const caseNo = (v: string): string | null => (/^\d-\d{3,4}-\d{3,4}\/\d{1,6}$/.test(v.trim()) ? null : 'Ish raqami: 4-1001-2609/00000 koʻrinishida')
const whole = (v: string): string | null => (/^\d+([.,]\d+)?$/.test(v.trim()) ? null : 'Faqat raqam kiriting')
const noCyrillic = (v: string): string | null => (CYR.test(v) ? 'Bu maydon lotin harflarida yoziladi' : null)
const noLatin = (v: string): string | null => (LAT.test(v) ? 'Bu maydon kirill harflarida yoziladi' : null)

const RULES: Record<string, Rule[]> = {
  // dates
  ...Object.fromEntries(
    ['dob', 'stay_from', 'stay_to', 'travel_from', 'travel_to', 'entry_date', 'order_date', 'ts_order_date', 'ts_regime_date', 'nda_date', 'lc_date', 'dismiss_date', 'act_date', 'doc_date']
      .map((k) => [k, [{ level: 'error', test: dateOk }, { level: 'warn', test: yearOk }] as Rule[]]),
  ),
  hearing_time: [{ level: 'error', test: (v) => { const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim()); return m && +m[1] < 24 && +m[2] < 60 ? null : 'Vaqt SS:DD koʻrinishida (masalan 10:30)' } }],
  sc_email: [{ level: 'error', test: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? null : 'E-mail manzil notoʻgʻri') }],
  // ids and numbers
  sc_tin: [{ level: 'warn', test: (v) => (digits(v).length === 9 ? null : 'STIR 9 ta raqamdan iborat') }],
  emp_pinfl: [{ level: 'warn', test: (v) => (digits(v).length === 14 ? null : 'JShShIR 14 ta raqamdan iborat') }],
  resp_passport: [{ level: 'warn', test: uzPassport }],
  emp_passport: [{ level: 'warn', test: uzPassport }],
  passport: [{ level: 'warn', test: (v) => (/^[A-Za-z0-9][A-Za-z0-9 -]{3,}$/.test(v.trim()) ? null : 'Pasport raqami juda qisqa yoki notoʻgʻri') }],
  phone: [{ level: 'warn', test: phone }],
  host_phone: [{ level: 'warn', test: phone }],
  resp_phone: [{ level: 'warn', test: phone }],
  resp_mobile: [{ level: 'warn', test: phone }],
  emp_phone: [{ level: 'warn', test: phone }],
  case_number: [{ level: 'warn', test: caseNo }],
  order_number: [{ level: 'warn', test: caseNo }],
  amount: [{ level: 'warn', test: (v) => (/^[\d\s.,]+$/.test(v.trim()) ? null : 'Summa faqat raqam boʻlishi kerak') }],
  conf_years: [{ level: 'warn', test: whole }],
  lookback_months: [{ level: 'warn', test: whole }],
  restrict_months: [{ level: 'warn', test: whole }],
  fine_brv: [{ level: 'warn', test: whole }],
  fine_cap_brv: [{ level: 'warn', test: whole }],
  visa_days: [{ level: 'warn', test: whole }],
  // script: Latin-named fields and Cyrillic-named fields
  emp_name: [{ level: 'warn', test: noCyrillic }],
  acc_name: [{ level: 'warn', test: noCyrillic }],
  emp_name_ru: [{ level: 'warn', test: noLatin }],
  acc_name_ru: [{ level: 'warn', test: noLatin }],
}

/** the field keys that have a check (for tests: every one must be a real form field) */
export const VALIDATED_KEYS: string[] = Object.keys(RULES)

export function validateField(key: string, value: string): Issue | null {
  const v = value.trim()
  if (!v) return null
  for (const r of RULES[key] ?? []) {
    const msg = r.test(v)
    if (msg) return { key, level: r.level, msg }
  }
  return null
}

/** periods: the second date must not come before the first (the key that is wrong is the SECOND one) */
const PERIODS: [string, string][] = [['stay_from', 'stay_to'], ['travel_from', 'travel_to'], ['lc_date', 'dismiss_date']]
const dayNo = (v: string): number | null => {
  const p = parseDate(v)
  return p ? Date.UTC(p.y, p.m - 1, p.d) : null
}

export interface DocCheck {
  /** values that are filled but wrong or unusual, errors first */
  issues: Issue[]
  /** fields of the document with nothing in them */
  empty: string[]
}

/** `values` should be the values WITH derived fallbacks applied, so a field that fills itself is not «empty» */
export function checkDoc(fields: string[], values: Record<string, string>): DocCheck {
  const issues: Issue[] = []
  for (const k of fields) {
    const i = validateField(k, values[k] ?? '')
    if (i) issues.push(i)
  }
  for (const [a, b] of PERIODS) {
    if (!fields.includes(a) || !fields.includes(b) || issues.some((i) => i.key === b && i.level === 'error')) continue
    const da = dayNo(values[a] ?? '')
    const db = dayNo(values[b] ?? '')
    if (da !== null && db !== null && db < da) issues.push({ key: b, level: 'error', msg: 'Tugash sanasi boshlanish sanasidan oldin' })
  }
  issues.sort((x, y) => (x.level === y.level ? 0 : x.level === 'error' ? -1 : 1))
  return { issues, empty: fields.filter((k) => !(values[k] ?? '').trim()) }
}
