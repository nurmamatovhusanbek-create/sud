/**
 * One input, several spellings: the bilingual documents (Russian and Uzbek side by side) need every date, term and
 * name in the form each half uses. These are the wordings the real forms have.
 */
import { describe, expect, test } from 'bun:test'
import { uzLatToRu } from '@/core/translit'
import {
  DERIVED_RULES, dateDmy, dateRu, dateUz, initialsFirstRu, initialsFirstUz, parseDate, ruBrv, ruCount, sourceKey, surnameGen, uzCount, withDerived,
} from '../derive'

describe('dates', () => {
  test('one date, three spellings', () => {
    expect(dateDmy('09.10.2026')).toBe('09.10.2026')
    expect(dateRu('09.10.2026')).toBe('9 октября 2026')
    expect(dateUz('09.10.2026')).toBe('2026-yil 9-oktyabr')
  })
  test('d.m.yyyy, slashes and ISO read the same date', () => {
    for (const s of ['9.10.2026', '09/10/2026', '09-10-2026', '2026-10-09']) expect(dateDmy(s)).toBe('09.10.2026')
  })
  test('every month has both names', () => {
    const ru = Array.from({ length: 12 }, (_, i) => dateRu(`01.${String(i + 1).padStart(2, '0')}.2026`).split(' ')[1])
    expect(ru).toEqual(['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'])
    const uz = Array.from({ length: 12 }, (_, i) => dateUz(`01.${String(i + 1).padStart(2, '0')}.2026`).split('-').slice(2).join('-'))
    expect(uz).toEqual(['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'])
  })
  test('text that is not a calendar date is left as typed (never swallowed)', () => {
    expect(parseDate('31.02.2026')).toBeNull()
    for (const f of [dateDmy, dateRu, dateUz]) expect(f(' 31.02.2026 ')).toBe('31.02.2026')
    expect(dateRu('oktyabr')).toBe('oktyabr')
  })
})

describe('terms in words', () => {
  test('the wordings of the agreement', () => {
    expect(ruCount('24', 'month', 'gen')).toBe('24 (двадцати четырёх) месяцев')
    expect(ruCount('12', 'month', 'nom')).toBe('12 (двенадцать) месяцев')
    expect(ruCount('12', 'month', 'gen')).toBe('12 (двенадцати) месяцев')
    expect(ruCount('2', 'year', 'gen')).toBe('2 (двух) лет')
    expect(ruCount('2', 'year', 'nom')).toBe('2 (два) года')
    expect(ruBrv('30')).toBe('30 (тридцати) базовых расчётных величин')
    expect(ruBrv('50')).toBe('50 (пятидесяти) базовых расчётных величин')
    expect(uzCount('24')).toBe('24 (yigirma toʻrt)')
    expect(uzCount('12')).toBe('12 (oʻn ikki)')
    expect(uzCount('2')).toBe('2 (ikki)')
    expect(uzCount('30')).toBe('30 (oʻttiz)')
    expect(uzCount('50')).toBe('50 (ellik)')
  })
  test('the noun agrees with the number', () => {
    expect(ruCount('1', 'month', 'nom')).toBe('1 (один) месяц')
    expect(ruCount('3', 'month', 'nom')).toBe('3 (три) месяца')
    expect(ruCount('11', 'month', 'nom')).toBe('11 (одиннадцать) месяцев')
    expect(ruCount('21', 'month', 'gen')).toBe('21 (двадцати одного) месяца')
    expect(ruCount('22', 'month', 'gen')).toBe('22 (двадцати двух) месяцев')
    expect(ruCount('1', 'year', 'nom')).toBe('1 (один) год')
    expect(ruCount('5', 'year', 'nom')).toBe('5 (пять) лет')
    expect(ruCount('4', 'year', 'gen')).toBe('4 (четырёх) лет')
    expect(ruBrv('1')).toBe('1 (одной) базовой расчётной величины')
    expect(ruBrv('21')).toBe('21 (двадцати одной) базовой расчётной величины')
    expect(ruBrv('2')).toBe('2 (двух) базовых расчётных величин')
    expect(uzCount('99')).toBe('99 (toʻqson toʻqqiz)')
  })
  test('what is not a whole number 1..99 is left as typed', () => {
    for (const s of ['', '0', '100', '2,5', 'ikki']) {
      expect(ruCount(s, 'year', 'gen')).toBe(s.trim())
      expect(uzCount(s)).toBe(s.trim())
      expect(ruBrv(s)).toBe(s.trim())
    }
  })
})

describe('names', () => {
  test('Latin → Russian Cyrillic, the way Russian paperwork writes Uzbek names', () => {
    expect(uzLatToRu('Turgunov Sherzod Azimjanovich')).toBe('Тургунов Шерзод Азимжанович')
    expect(uzLatToRu('Karimov Bobur Rustamovich')).toBe('Каримов Бобур Рустамович')
    expect(uzLatToRu('Oʻtkir Gʻofurov Shavkat oʻgʻli')).toBe('Уткир Гофуров Шавкат угли')
    expect(uzLatToRu('Erkin Eshmatov Xusan Qodirovich')).toBe('Эркин Эшматов Хусан Кодирович')
    expect(uzLatToRu('Yusupova Yulduz Chorievna')).toBe('Юсупова Юлдуз Чориевна')
    expect(uzLatToRu('KARIMOV SHAVKAT')).toBe('КАРИМОВ ШАВКАТ')
    expect(uzLatToRu('o\'g\'li')).toBe('угли')
  })
  test('initials first, in both alphabets', () => {
    expect(initialsFirstUz('Turgunov Sherzod Azimjanovich')).toBe('Sh.A. Turgunov')
    expect(initialsFirstRu('Turgunov Sherzod Azimjanovich')).toBe('Ш.А. Тургунов')
    expect(initialsFirstUz('Karimov Oʻtkir Gʻaniyevich')).toBe('Oʻ.Gʻ. Karimov')
    expect(initialsFirstUz('Karimov')).toBe('Karimov')
    expect(surnameGen('Ш.А. Тургунов')).toBe('Ш.А. Тургунова')
    expect(surnameGen('Ш.А. Каримова')).toBe('Ш.А. Каримова')
  })
})

describe('withDerived', () => {
  test('adds the spellings of what was typed, never touches the input', () => {
    const v = withDerived({ ts_order_date: '9.10.2026', nda_date: '' })
    expect(v.ts_order_date).toBe('9.10.2026')
    expect(v.ts_order_date_dmy).toBe('09.10.2026')
    expect(v.ts_order_date_ru).toBe('9 октября 2026')
    expect(v.ts_order_date_uz).toBe('2026-yil 9-oktyabr')
    expect(v.nda_date_ru).toBeUndefined() // nothing typed → nothing derived (the preview shows the label)
  })
  test('a derived key that is also a form field: what the user typed wins, the rest follows the input', () => {
    expect(withDerived({ emp_name: 'Karimov Bobur' }).emp_name_ru).toBe('Каримов Бобур')
    expect(withDerived({ emp_name: 'Karimov Bobur', emp_name_ru: 'Каримов Бабур' }).emp_name_ru).toBe('Каримов Бабур')
    expect(withDerived({ emp_name: 'Karimov Bobur', emp_name_ru: '  ' }).emp_name_ru).toBe('Каримов Бобур')
  })
  test('the company name keeps its quote style per place', () => {
    expect(withDerived({ sc_company_ru: 'СП ООО «Artikul Aziya Kabel»' }).sc_company_ru_q).toBe('СП ООО “Artikul Aziya Kabel”')
  })
  test('sourceKey: derived keys point at their input, plain keys at themselves', () => {
    expect(sourceKey('ts_order_date_ru')).toBe('ts_order_date')
    expect(sourceKey('fine_ru')).toBe('fine_brv')
    expect(sourceKey('emp_passport')).toBe('emp_passport')
  })
  test('no rule reads from a derived key (one hop only, so the order of the rules cannot matter)', () => {
    for (const r of Object.values(DERIVED_RULES)) expect(DERIVED_RULES[r.from]).toBeUndefined()
  })
})
