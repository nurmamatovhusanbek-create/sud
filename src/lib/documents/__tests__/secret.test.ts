/**
 * Tijorat siri: the order and the employee agreement are filled from ONE form. These are the sentences of the real
 * documents (Russian | Uzbek side by side) with the values typed once and every spelling derived.
 */
import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { generateDocx } from '../fill.server'
import { categoryDefaults, docById, docsByTab, tabById } from '../registry'
import { markXml } from '../fill.shared'
import { sourceKey, withDerived } from '../derive'

const text = async (buf: Uint8Array) => {
  const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string')
  return [...xml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('').replace(/\u00a0/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
}

const tab = tabById('secret')!
const form = {
  ...categoryDefaults(tab),
  ts_order_no: '17', ts_order_date: '9.10.2026', ts_regime_date: '08.10.2026',
  nda_no: 'NDA-E1', nda_date: '09.10.2026', dismiss_date: '09.10.2026', lc_no: '12', lc_date: '01.03.2025',
  emp_name: 'Karimov Bobur Rustamovich', emp_passport: 'AA 0000000', emp_issued: 'Toshkent sh. IIB, 01.02.2020', emp_pinfl: '30101900000000',
  emp_address: 'Toshkent sh., Chilonzor t., 1-uy', emp_phone: '+998 00 000 00 00',
  emp_position_uz: 'Sotuv menejeri', emp_position_ru: 'менеджер по продажам', emp_unit_uz: 'Sotuv boʻlimi', emp_unit_ru: 'отдела продаж',
  kc_1_name: 'Test Trading LLC', kc_1_country: 'Китай / Xitoy',
  act_date: '9.10.2026', act_items_uz: 'noutbuk', act_items_ru: 'ноутбук', acc_name: 'Yusupov Aziz',
}

describe('the category', () => {
  test('is combined (one form, two documents) and has no letterhead (the company header is part of the text)', () => {
    expect(tab.groups?.length).toBeGreaterThan(3)
    expect(tab.letterhead).toBeFalsy()
    expect(docsByTab('secret').map((d) => d.id)).toEqual(['ts1_buyruq', 'ts2_kelishuv'])
  })
  test('every group key is a field of at least one of the two documents (nothing in the form feeds nothing)', () => {
    const all = new Set(docsByTab('secret').flatMap((d) => d.fields))
    for (const g of tab.groups!) for (const k of g.keys) expect(all.has(k), k).toBe(true)
  })
  test('each document names the field it cannot be made without', () => {
    expect(docById('ts1_buyruq')!.requireKey).toBe('ts_order_no')
    expect(docById('ts2_kelishuv')!.requireKey).toBe('emp_name')
  })
})

describe('the order', () => {
  test('number, date and the regime date appear in both languages, in the annexes too', async () => {
    const t = await text((await generateDocx('ts1_buyruq', form)).buffer)
    expect(t).not.toContain('{{')
    expect(t).toContain('ПРИКАЗ № 17')
    expect(t).toContain('17-SONLI BUYRUQ')
    expect(t).toContain('г. Ташкент09.10.2026 г.')
    expect(t).toContain('Toshkent sh.09.10.2026-y.')
    expect(t).toContain('режим коммерческой тайны с 08.10.2026 г.')
    expect(t).toContain('2026-yil 8-oktyabrdan boshlab tijorat siri rejimi joriy etilsin')
    expect(t).toContain('к приказу № 17 от 09.10.2026 г.')
    expect(t).toContain('2026-yil 9-oktyabrdagi 17-sonli buyruqqa')
    expect((t.match(/к приказу № 17 от 09\.10\.2026 г\./g) ?? []).length).toBe(3) // all three annexes quote the same order
  })
  test('the company, the director and the responsible person come from the form, in the right alphabet', async () => {
    const t = await text((await generateDocx('ts1_buyruq', form)).buffer)
    expect(t).toContain('СП ООО “Artikul Aziya Kabel”') // the heading quotes differently from the body
    expect(t).toContain('Установить в СП ООО «Artikul Aziya Kabel» (далее')
    expect(t).toContain('“Artikul Aziya Kabel” MChJ QKda (bundan buyon')
    expect(t).toContain('Директор ______________ Ш.А. Тургунов')
    expect(t).toContain('Direktor ______________ Sh.A. Turgunov')
    expect(t).toContain('Назначить юриста ')
    expect(t).toContain('(2 (два) года)')
    expect(t).toContain('(2 (ikki) yil)')
  })
  test('the term follows the input, with the noun in the right form', async () => {
    const t = await text((await generateDocx('ts1_buyruq', { ...form, conf_years: '5' })).buffer)
    expect(t).toContain('(5 (пять) лет)')
    expect(t).toContain('(5 (besh) yil)')
  })
  test('the units of annex 3 land in their rows', async () => {
    const t = await text((await generateDocx('ts1_buyruq', { ...form, ts_unit_1: 'Отдел продаж / Sotuv boʻlimi', ts_unit_6: 'ВЭД / TIF' })).buffer)
    expect(t).toContain('Отдел продаж / Sotuv boʻlimi')
    expect(t).toContain('ВЭД / TIF')
  })
})

describe('the agreement', () => {
  test('the employee, once, in both halves (Cyrillic name derived from the Latin one)', async () => {
    const t = await text((await generateDocx('ts2_kelishuv', form)).buffer)
    expect(t).not.toContain('{{')
    expect(t).toContain('гражданин Республики Узбекистан Каримов Бобур Рустамович, паспорт (ID-карта) AA 0000000, выдан Toshkent sh. IIB, 01.02.2020, ПИНФЛ 30101900000000, проживающий по адресу: Toshkent sh., Chilonzor t., 1-uy')
    expect(t).toContain('va Oʻzbekiston Respublikasi fuqarosi Karimov Bobur Rustamovich, pasport (ID-karta) AA 0000000')
    expect(t).toContain('в должности менеджер по продажам отдела продаж')
    expect(t).toContain('Xodim Jamiyatda Sotuv menejeri lavozimida Sotuv boʻlimi ishlagan 01.03.2025 sanadagi 12-sonli mehnat shartnomasi')
    expect(t).toContain('Каримов Бобур Рустамович / Karimov Bobur Rustamovich')
  })
  test('a corrected Cyrillic name wins over the derived one', async () => {
    const t = await text((await generateDocx('ts2_kelishuv', { ...form, emp_name_ru: 'Каримов Бабур Рустамович' })).buffer)
    expect(t).toContain('Каримов Бабур Рустамович / Karimov Bobur Rustamovich')
    expect(t).not.toContain('Каримов Бобур')
  })
  test('dates: the dismissal date and the order it quotes, in the wording of each half', async () => {
    const t = await text((await generateDocx('ts2_kelishuv', form)).buffer)
    expect(t).toContain('1.2. «Дата увольнения» – день прекращения Трудового договора: 9 октября 2026 г.')
    expect(t).toContain('Mehnat shartnomasi bekor qilingan kun: 2026-yil 9-oktyabr.')
    expect(t).toContain('утверждённом приказом Директора Общества № 17 от 09.10.2026 г.')
    expect(t).toContain('Direktorning 2026-yil 9-oktyabrdagi 17-sonli buyrugʻi')
    expect(t).toContain('СОГЛАШЕНИЕ № NDA-E1')
    expect(t).toContain('NDA-E1-SONLI KELISHUV')
    expect(t).toContain('к Соглашению № NDA-E1 от 09.10.2026 г.')
    expect(t).toContain('2026-yil 9-oktyabrdagi NDA-E1-sonli Kelishuvga')
  })
  test('the terms in words, as the signed text has them', async () => {
    const t = await text((await generateDocx('ts2_kelishuv', form)).buffer)
    expect(t).toContain('в течение 24 (двадцати четырёх) месяцев до Даты увольнения')
    expect(t).toContain('24 (yigirma toʻrt) oy davomida')
    expect(t).toContain('«Период ограничения» – 12 (двенадцать) месяцев с Даты увольнения')
    expect(t).toContain('Ishdan boʻshatish sanasidan boshlab 12 (oʻn ikki) oy.')
    expect(t).toContain('В течение 12 (двенадцати) месяцев с Даты увольнения')
    expect(t).toContain('действует в течение 2 (двух) лет с Даты увольнения')
    expect(t).toContain('штраф в размере 30 (тридцати) базовых расчётных величин')
    expect(t).toContain('не может превышать 50 (пятидесяти) базовых расчётных величин')
    expect(t).toContain('30 (oʻttiz) baravari miqdorida')
    expect(t).toContain('50 (ellik) baravaridan oshmasligi')
  })
  test('changing a term changes it everywhere, with the right grammar', async () => {
    const t = await text((await generateDocx('ts2_kelishuv', { ...form, lookback_months: '18', restrict_months: '6', conf_years: '3', fine_brv: '10', fine_cap_brv: '21' })).buffer)
    expect(t).toContain('в течение 18 (восемнадцати) месяцев')
    expect(t).toContain('18 (oʻn sakkiz) oy')
    expect(t).toContain('– 6 (шесть) месяцев с Даты')
    expect(t).toContain('В течение 6 (шести) месяцев')
    expect(t).toContain('3 (трёх) лет')
    expect(t).toContain('10 (десяти) базовых расчётных величин')
    expect(t).toContain('не может превышать 21 (двадцати одной) базовой расчётной величины')
  })
  test('annexes: key clients, the act, signatures', async () => {
    const t = await text((await generateDocx('ts2_kelishuv', form)).buffer)
    expect(t).toContain('Test Trading LLC')
    expect(t).toContain('Китай / Xitoy')
    expect(t).toContain('г. Ташкент9 октября 2026 г.')
    expect(t).toContain('Toshkent sh.2026-yil 9-oktyabr')
    expect(t).toContain('Работник передал, а Общество приняло: ноутбук.')
    expect(t).toContain('Xodim topshirdi, Jamiyat esa qabul qildi: noutbuk.')
    expect(t).toContain('Юсупов Азиз / Yusupov Aziz')
    expect(t).toContain('Тургунов Шерзод Азимжанович') // the director in full, from the same input as «Ш.А. Тургунов»
    expect(t).toContain('Адрес: г. Ташкент, Янгихаётский район, Южная промзона, Файзли МСГ')
    expect(t).toContain('E-mail: vedartikul@gmail.com')
  })
  test('left blank, nothing is half-filled: no placeholders, no leftover brackets', async () => {
    for (const id of ['ts1_buyruq', 'ts2_kelishuv']) {
      const t = await text((await generateDocx(id, {})).buffer)
      expect(t, id).not.toContain('{{')
      expect(t, id).not.toMatch(/\[[^\]]*\]/)
    }
  })
})

describe('the preview shows the same text, with every spot linked to its input', () => {
  test('a derived spot points at the field it is computed from; an empty one shows that field’s label', async () => {
    const zip = await JSZip.loadAsync((await generateDocx('ts1_buyruq', {})).buffer) // only to prove the template loads
    expect(zip.file('word/document.xml')).toBeTruthy()
    const xml = '<w:t>{{ts_order_date_ru}}|{{conf_ru_gen}}|{{ts_order_no}}</w:t>'
    const out = markXml(xml, withDerived({ ts_order_date: '9.10.2026' }), (k) => `«${k}»`, sourceKey)
    expect(out).toContain('ts_order_date')
    expect(out).toContain('9 октября 2026')
    expect(out).not.toContain('ts_order_date_ru')
    expect(out).toContain('!conf_years') // empty: marked as empty, field = the input, label of the input
    expect(out).toContain('«conf_years»')
    expect(out).toContain('!ts_order_no')
  })
})
