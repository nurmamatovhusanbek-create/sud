/**
 * Values the bilingual documents need in several forms, derived from ONE input: you type a date once and the
 * Russian half reads «9 октября 2026», the Uzbek half «2026-yil 9-oktyabr»; you type a name in Latin and the Russian
 * half gets the Cyrillic one; a term in months/years/BRV is spelled out in both languages in the right case.
 *
 * Isomorphic and pure (the server fill and the live preview both call `withDerived`, so they cannot drift). A derived
 * key can be a template placeholder only (`ts_order_date_ru`), or ALSO a form field (`emp_name_ru`): then what the
 * user typed wins and the derived text is the fallback — the small «correct it» field next to the Latin name.
 */
import { uzLatToRu } from '@/core/translit'

export interface DerivedRule {
  /** the input this is computed from (clicking the value in the preview jumps to this field) */
  from: string
  fn: (v: string) => string
}

// ---- dates ------------------------------------------------------------------------------------------------------------

const RU_MONTH = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
const UZ_MONTH = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr']

/** dd.mm.yyyy, d.m.yyyy, dd/mm/yyyy, dd-mm-yyyy or yyyy-mm-dd; null when it is not a real calendar date. */
export function parseDate(s: string): { d: number; m: number; y: number } | null {
  const t = s.trim()
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t)
  let d: number, mo: number, y: number
  if (m) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  else return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? { d, m: mo, y } : null
}

const pad = (n: number) => String(n).padStart(2, '0')
/** 09.10.2026 */
export const dateDmy = (v: string) => { const p = parseDate(v); return p ? `${pad(p.d)}.${pad(p.m)}.${p.y}` : v.trim() }
/** 9 октября 2026 (the «г.» stays in the template) */
export const dateRu = (v: string) => { const p = parseDate(v); return p ? `${p.d} ${RU_MONTH[p.m - 1]} ${p.y}` : v.trim() }
/** 2026-yil 9-oktyabr (suffixes such as «dan», «dagi» stay in the template) */
export const dateUz = (v: string) => { const p = parseDate(v); return p ? `${p.y}-yil ${p.d}-${UZ_MONTH[p.m - 1]}` : v.trim() }

// ---- number words -----------------------------------------------------------------------------------------------------

const RU_UNIT_NOM = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
const RU_UNIT_GEN = ['', 'одного', 'двух', 'трёх', 'четырёх', 'пяти', 'шести', 'семи', 'восьми', 'девяти']
const RU_TEEN_NOM = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать']
const RU_TEEN_GEN = ['десяти', 'одиннадцати', 'двенадцати', 'тринадцати', 'четырнадцати', 'пятнадцати', 'шестнадцати', 'семнадцати', 'восемнадцати', 'девятнадцати']
const RU_TENS_NOM = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто']
const RU_TENS_GEN = ['', '', 'двадцати', 'тридцати', 'сорока', 'пятидесяти', 'шестидесяти', 'семидесяти', 'восьмидесяти', 'девяноста']
const UZ_UNIT = ['', 'bir', 'ikki', 'uch', 'toʻrt', 'besh', 'olti', 'yetti', 'sakkiz', 'toʻqqiz']
const UZ_TENS = ['', 'oʻn', 'yigirma', 'oʻttiz', 'qirq', 'ellik', 'oltmish', 'yetmish', 'sakson', 'toʻqson']

type Case = 'nom' | 'gen'

/** 1..99 in Russian, nominative or genitive («двадцать четыре» / «двадцати четырёх»); `fem`: «две» / «одной». */
export function ruWords(n: number, c: Case, fem = false): string {
  const u = n % 10
  const t = Math.floor(n / 10)
  const unit = (k: number) => {
    if (c === 'nom') return fem && k === 2 ? 'две' : fem && k === 1 ? 'одна' : RU_UNIT_NOM[k]
    return fem && k === 1 ? 'одной' : RU_UNIT_GEN[k]
  }
  if (n < 10) return unit(n)
  if (t === 1) return (c === 'nom' ? RU_TEEN_NOM : RU_TEEN_GEN)[u]
  return [(c === 'nom' ? RU_TENS_NOM : RU_TENS_GEN)[t], u ? unit(u) : ''].filter(Boolean).join(' ')
}

/** 1..99 in Uzbek («yigirma toʻrt»). */
export function uzWords(n: number): string {
  return [UZ_TENS[Math.floor(n / 10)], UZ_UNIT[n % 10]].filter(Boolean).join(' ')
}

/** a whole number 1..99, or null (anything else is left as typed) */
function count(v: string): number | null {
  const t = v.trim()
  if (!/^\d{1,2}$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= 99 ? n : null
}

const lastOne = (n: number) => n % 10 === 1 && n % 100 !== 11
const lastFew = (n: number) => n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)

/** «24 (двадцати четырёх) месяцев»: the noun agrees with the number in the case the sentence needs. */
export function ruCount(v: string, unit: 'month' | 'year', c: Case): string {
  const n = count(v)
  if (n === null) return v.trim()
  const forms = unit === 'month'
    ? { nom: ['месяц', 'месяца', 'месяцев'], gen: ['месяца', 'месяцев'] }
    : { nom: ['год', 'года', 'лет'], gen: ['года', 'лет'] }
  const noun = c === 'nom' ? forms.nom[lastOne(n) ? 0 : lastFew(n) ? 1 : 2] : forms.gen[lastOne(n) ? 0 : 1]
  return `${n} (${ruWords(n, c)}) ${noun}`
}

/** «30 (тридцати) базовых расчётных величин» (always genitive, feminine noun) */
export function ruBrv(v: string): string {
  const n = count(v)
  if (n === null) return v.trim()
  return `${n} (${ruWords(n, 'gen', true)}) ${lastOne(n) ? 'базовой расчётной величины' : 'базовых расчётных величин'}`
}

/** «24 (yigirma toʻrt)»: the unit («oy», «yil», «baravari») stays in the template, Uzbek does not decline it */
export function uzCount(v: string): string {
  const n = count(v)
  return n === null ? v.trim() : `${n} (${uzWords(n)})`
}

// ---- names ------------------------------------------------------------------------------------------------------------

/** First letter of a Latin name the way an initial is written: «Sh», «Ch», «Oʻ», «Gʻ» are one letter. */
function latInitial(word: string): string {
  const m = /^(sh|ch|[oOgG][ʻʼ‘’'`´])/i.exec(word)
  const head = m ? m[1] : word.charAt(0)
  return head.charAt(0).toUpperCase() + head.slice(1).toLowerCase()
}

/** «Turgunov Sherzod Azimjanovich» → «Sh.A. Turgunov» */
export function initialsFirstUz(full: string): string {
  const [sur, ...rest] = full.trim().split(/\s+/)
  if (!sur) return ''
  return rest.length ? `${rest.map((w) => `${latInitial(w)}.`).join('')} ${sur}` : sur
}

/** «Turgunov Sherzod Azimjanovich» → «Ш.А. Тургунов» */
export function initialsFirstRu(full: string): string {
  const [sur, ...rest] = uzLatToRu(full.trim()).split(/\s+/)
  if (!sur) return ''
  return rest.length ? `${rest.map((w) => `${w.charAt(0).toUpperCase()}.`).join('')} ${sur}` : sur
}

/** genitive of a Russian surname written the usual way («Тургунов» → «Тургунова»); anything else is left alone */
export function surnameGen(initialsSurname: string): string {
  return /(?:ов|ев|ёв|ин|ын)$/i.test(initialsSurname.trim()) ? `${initialsSurname.trim()}а` : initialsSurname.trim()
}

// ---- the table ---------------------------------------------------------------------------------------------------------

const DERIVED: Record<string, DerivedRule> = {}
const add = (key: string, from: string, fn: (v: string) => string) => { DERIVED[key] = { from, fn } }

// every date input offers its three spellings; a template uses the ones it needs
for (const base of ['ts_order_date', 'ts_regime_date', 'nda_date', 'lc_date', 'dismiss_date', 'act_date']) {
  add(`${base}_dmy`, base, dateDmy)
  add(`${base}_ru`, base, dateRu)
  add(`${base}_uz`, base, dateUz)
}

// terms: the same number, spelled in the case each sentence needs
add('lookback_ru', 'lookback_months', (v) => ruCount(v, 'month', 'gen'))
add('lookback_uz', 'lookback_months', uzCount)
add('restrict_ru_nom', 'restrict_months', (v) => ruCount(v, 'month', 'nom'))
add('restrict_ru_gen', 'restrict_months', (v) => ruCount(v, 'month', 'gen'))
add('restrict_uz', 'restrict_months', uzCount)
add('conf_ru_nom', 'conf_years', (v) => ruCount(v, 'year', 'nom'))
add('conf_ru_gen', 'conf_years', (v) => ruCount(v, 'year', 'gen'))
add('conf_uz', 'conf_years', uzCount)
add('fine_ru', 'fine_brv', ruBrv)
add('fine_uz', 'fine_brv', uzCount)
add('cap_ru', 'fine_cap_brv', ruBrv)
add('cap_uz', 'fine_cap_brv', uzCount)

// names: Cyrillic from the Latin one (also a form field each: type there to override)
add('emp_name_ru', 'emp_name', uzLatToRu)
add('acc_name_ru', 'acc_name', uzLatToRu)
add('dir_short_uz', 'dir_full', initialsFirstUz)
add('dir_short_ru', 'dir_full', initialsFirstRu)
add('dir_short_ru_gen', 'dir_full', (v) => surnameGen(initialsFirstRu(v)))
add('dir_full_ru', 'dir_full', uzLatToRu)
add('sc_company_ru_q', 'sc_company_ru', (v) => v.replace(/«/g, '“').replace(/»/g, '”'))

export const DERIVED_RULES: Readonly<Record<string, DerivedRule>> = DERIVED

/** the form field behind a template key: itself, or the input a derived key is computed from */
export function sourceKey(key: string): string {
  return DERIVED[key]?.from ?? key
}

/** `values` plus every derived key. What the user typed always wins; a blank derived value stays absent. */
export function withDerived(values: Record<string, string>): Record<string, string> {
  const out = { ...values }
  for (const [key, rule] of Object.entries(DERIVED)) {
    if (out[key]?.trim()) continue
    const src = values[rule.from]
    if (!src?.trim()) continue
    const v = rule.fn(src)
    if (v) out[key] = v
  }
  return out
}
