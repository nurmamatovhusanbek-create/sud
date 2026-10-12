/**
 * The other company of a demand letter comes from the Excel: its name and legal form are read from the header of
 * the «Акт сверки» (whatever the forms are) and written on the letter; the sample debtor is never used next to a
 * company the sheet named.
 */
import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { formLabel, splitParty } from '@/core/legal-forms'
import { findParties, parseSverka } from '../parse'
import { resolveParties } from '../constants'
import { generatePretenzia } from '../fill.server'

// ---- a minimal «Акт сверки» -------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function sverka(headerLines: string[], mine = 'Фирма А'): Promise<Uint8Array> {
  const strings: string[] = []
  const sid = (s: string) => { const i = strings.indexOf(s); if (i >= 0) return i; strings.push(s); return strings.length - 1 }
  const cell = (ref: string, v: string | number) => (typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${sid(v)}</v></c>`)
  const rows: [number, [string, string | number][]][] = [
    [1, [['B', 'Акт сверки']]],
    ...headerLines.map((l, i) => [3 + i, [['B', l]]] as [number, [string, string | number][]]),
    [6, [['B', `По данным ${mine}, сум`]]],
    [8, [['B', 'Дата'], ['C', 'Документ'], ['E', 'Дебет'], ['G', 'Кредит']]],
    [10, [['B', '№ K-1 от 05.06.2026']]],
    [11, [['B', 'Сальдо начальное']]],
    [12, [['C', 'Обороты по договору']]],
    [13, [['B', 'Сальдо конечное'], ['E', 1000000]]],
  ]
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map(([r, cs]) => `<row r="${r}">${cs.map(([c, v]) => cell(`${c}${r}`, v)).join('')}</row>`)
    .join('')}</sheetData></worksheet>`
  const z = new JSZip()
  z.file('xl/worksheets/sheet1.xml', sheet)
  z.file('xl/sharedStrings.xml', `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`)
  return z.generateAsync({ type: 'uint8array' })
}

describe('legal forms', () => {
  test('the form and the name are told apart, in either order, whatever the quotes', () => {
    expect(splitParty('""Artikul Aziya Kabel" Mas\'uliyati Cheklangan Jamiyat "')).toEqual({ name: 'Artikul Aziya Kabel', code: 'OOO' })
    expect(splitParty('"Hududiy  Elektr Tarmoqlari" Aksiyadorlik Jamiyati')).toEqual({ name: 'Hududiy Elektr Tarmoqlari', code: 'AO' })
    expect(splitParty('Aksiyadorlik jamiyati «Beta Servis»')).toEqual({ name: 'Beta Servis', code: 'AO' })
    expect(splitParty('ООО "Гамма Трейд"')).toEqual({ name: 'Гамма Трейд', code: 'OOO' })
    expect(splitParty('"Delta" Mas’uliyati Cheklangan Jamiyat Qo‘shma Korxona')).toEqual({ name: 'Delta', code: 'SP_OOO' })
    expect(splitParty('"Epsilon" Xususiy korxona')).toEqual({ name: 'Epsilon', code: 'CHP' })
    expect(splitParty('"Zeta" Yakka tartibdagi tadbirkor')).toEqual({ name: 'Zeta', code: 'IP' })
    expect(splitParty('"Eta" Davlat unitar korxonasi')).toEqual({ name: 'Eta', code: 'GUP' })
  })
  test('a name with no form keeps the name and says no form (nothing is invented)', () => {
    expect(splitParty('"Theta Group"')).toEqual({ name: 'Theta Group', code: '' })
  })
  test('how the letter writes each form', () => {
    expect(formLabel('AO', 'ru')).toBe('АО')
    expect(formLabel('AO', 'uz')).toBe('AJ')
    expect(formLabel('OOO', 'ru')).toBe('ООО')
    expect(formLabel('OOO', 'uz')).toBe('MChJ')
    expect(formLabel('', 'ru')).toBe('')
    expect(formLabel('nonsense', 'uz')).toBe('')
  })
})

describe('reading the two parties from the sheet', () => {
  const header = [
    'взаимных расчетов за период: 01.08.2026 - 14.09.2026\nмежду ""Alfa Kabel" Mas\'uliyati Cheklangan Jamiyat " \nи "Beta Servis" Aksiyadorlik Jamiyati',
  ]
  test('the Excel says AO: name and form are found', async () => {
    const r = await parseSverka(await sverka(header))
    expect([r.creditorName, r.creditorForm, r.debtorName, r.debtorForm]).toEqual(['Alfa Kabel', 'OOO', 'Beta Servis', 'AO'])
    expect(r.contracts).toHaveLength(1)
  })
  test('the other company is an OOO too (the old parser only knew «Aksiyadorlik»)', async () => {
    const r = await parseSverka(await sverka(['между "Alfa Kabel" Mas\'uliyati Cheklangan Jamiyat\nи "Gamma Trade" Mas\'uliyati Cheklangan Jamiyat']))
    expect([r.debtorName, r.debtorForm]).toEqual(['Gamma Trade', 'OOO'])
  })
  test('a joint venture, a private firm, an entrepreneur', async () => {
    for (const [form, code] of [['Mas\'uliyati Cheklangan Jamiyat Qo\'shma Korxona', 'SP_OOO'], ['Xususiy korxona', 'CHP'], ['Yakka tartibdagi tadbirkor', 'IP']] as const) {
      const r = await parseSverka(await sverka([`между "Alfa Kabel" Mas'uliyati Cheklangan Jamiyat\nи "Delta" ${form}`]))
      expect([r.debtorName, r.debtorForm]).toEqual(['Delta', code])
    }
  })
  test('Russian wording and no line break', async () => {
    const r = await parseSverka(await sverka(['между ООО "Альфа" и АО "Бета Сервис"']))
    expect([r.creditorName, r.creditorForm, r.debtorName, r.debtorForm]).toEqual(['Альфа', 'OOO', 'Бета Сервис', 'AO'])
  })
  test('without the «между» sentence the two «По данным … сум» cells name them', () => {
    const p = findParties(['По данным "Alfa" Mas\'uliyati Cheklangan Jamiyat, сум', 'По данным "Beta" Aksiyadorlik Jamiyati, сум'])
    expect([p?.creditor.name, p?.debtor.name, p?.debtor.code]).toEqual(['Alfa', 'Beta', 'AO'])
  })
  test('nothing recognisable → no parties (the form then asks, it does not guess)', async () => {
    const r = await parseSverka(await sverka(['взаимных расчетов за период: 01.08.2026 - 14.09.2026']))
    expect(r.debtorName).toBeUndefined()
    expect(r.contracts).toHaveLength(1)
  })
})

const defaults = { creditorName: 'ARTIKUL AZIYA KABEL', debtorName: 'HUDUDIY ELEKTR TARMOQLARI', debtorAddress: 'Юнусабадский район ул. Осиё 8-дом' }

describe('who the letter is between', () => {
  test('the company the Excel names is used, in capitals, with its own form and no stranger’s address', () => {
    const r = resolveParties({}, { debtorName: 'Beta Servis', debtorForm: 'OOO', creditorName: 'Alfa Kabel' }, defaults)
    expect(r).toMatchObject({ debtorName: 'BETA SERVIS', debtorForm: 'OOO', creditorName: 'ALFA KABEL', debtorAddress: '', addressMissing: true })
  })
  test('the sheet names the SAMPLE company itself: its address is the right one', () => {
    expect(resolveParties({}, { debtorName: 'Hududiy  Elektr Tarmoqlari', debtorForm: 'AO' }, defaults)).toMatchObject({ debtorName: 'HUDUDIY ELEKTR TARMOQLARI', debtorForm: 'AO', debtorAddress: defaults.debtorAddress, addressMissing: false })
  })
  test('what was typed wins over the Excel', () => {
    const r = resolveParties({ debtorName: 'Gamma', debtorAddress: 'Toshkent' }, { debtorName: 'Beta Servis', debtorForm: 'OOO' }, defaults)
    expect(r).toMatchObject({ debtorName: 'Gamma', debtorForm: 'OOO', debtorAddress: 'Toshkent', addressMissing: false })
  })
  test('nothing detected: the sample company, with ITS form and address', () => {
    expect(resolveParties({}, null, defaults)).toMatchObject({ debtorName: 'HUDUDIY ELEKTR TARMOQLARI', debtorForm: 'AO', debtorAddress: defaults.debtorAddress, addressMissing: false })
  })
  test('a typed name with nothing detected: no form is written (the sample’s «АО» is not that company’s)', () => {
    expect(resolveParties({ debtorName: 'Gamma' }, null, defaults)).toMatchObject({ debtorName: 'Gamma', debtorForm: '', debtorAddress: '' })
  })
  test('the sheet named the company but not its form: none is written', () => {
    expect(resolveParties({}, { debtorName: 'Theta' }, defaults).debtorForm).toBe('')
  })
})

describe('the letter itself', () => {
  const contract = { no: 'K-1', date: new Date('2026-06-05'), mainDebtTiyin: 100_000_000, paymentTiyin: 0, delayStart: new Date('2026-06-12') }
  const text = async (buf: Buffer) => [...(await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string')).matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('').replace(/ /g, ' ')
  const k = { creditorName: 'ALFA KABEL', debtorName: 'GAMMA TRADE', debtorForm: 'OOO', debtorAddress: 'Toshkent sh., Test koʻchasi', courtName: 'Sud', director: 'D', executor: 'E', executorPhone: '1', claimDate: new Date('2026-10-07') }

  test('Russian: «ООО «GAMMA TRADE»» in the heading, the first sentence and the court sentence', async () => {
    const t = await text((await generatePretenzia([contract], { ...k, lang: 'ru' })).buffer)
    expect(t.match(/ООО «GAMMA TRADE»/g)?.length).toBe(3)
    expect(t).not.toContain('АО «')
    expect(t).not.toContain('HUDUDIY')
    expect(t).not.toContain('{{')
  })
  test('Uzbek: «GAMMA TRADE» MChJ', async () => {
    const t = await text((await generatePretenzia([contract], { ...k, lang: 'uz' })).buffer)
    expect(t.match(/«GAMMA TRADE» MChJ/g)?.length).toBe(3)
    expect(t).not.toContain(' AJ')
  })
  test('the sample company keeps its AO / AJ', async () => {
    const sample = { ...k, debtorName: 'HUDUDIY ELEKTR TARMOQLARI', debtorForm: 'AO' }
    expect(await text((await generatePretenzia([contract], { ...sample, lang: 'ru' })).buffer)).toContain('АО «HUDUDIY ELEKTR TARMOQLARI»')
    expect(await text((await generatePretenzia([contract], { ...sample, lang: 'uz' })).buffer)).toContain('«HUDUDIY ELEKTR TARMOQLARI» AJ')
  })
})
