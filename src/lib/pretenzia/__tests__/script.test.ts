/** The Uzbek talabnoma can be written in either Latin alphabet or in Cyrillic; the Russian one is never converted. */
import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { toLatinScript, toNewLatin, type UzScript } from '@/core/uz-alphabet'
import { uzCyrToLat } from '@/core/translit'
import { generatePretenzia } from '../fill.server'
import type { ClaimConstants } from '../render'

const constants = (lang: 'ru' | 'uz'): ClaimConstants => ({
  creditorName: '“Artikul Aziya Kabel” MCHJ QK',
  debtorName: '“Shahar-Choy” MCHJ',
  debtorForm: 'MCHJ',
  debtorAddress: 'Toshkent shahar, Chilonzor tumani, Oʻzbekiston ko‘chasi',
  courtName: 'Toshkent shahar iqtisodiy sudi',
  director: 'Turgunov Sherzod Azimjanovich',
  executor: 'Gʻulomov Shuhrat',
  executorPhone: '+998 90 123 45 67',
  claimDate: new Date(2026, 10, 12),
  lang,
})
const contracts = [{ no: 'SH-12/2026', date: new Date(2026, 0, 15), mainDebtTiyin: 1_250_000_000, paymentTiyin: 0, delayStart: new Date(2026, 1, 20) }]

async function text(lang: 'ru' | 'uz', script?: UzScript): Promise<string> {
  const out = await generatePretenzia(contracts, constants(lang), { script })
  const zip = await JSZip.loadAsync(out.buffer)
  const xml = await zip.file('word/document.xml')!.async('string')
  return xml.replace(/<w:br[^>]*>|<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
}

describe('talabnoma (Uzbek): the new alphabet', () => {
  test('the old alphabet (and no choice) is exactly what it always was', async () => {
    expect(await text('uz', 'old')).toBe(await text('uz'))
  })
  test('the new alphabet: the words and the typed values are converted, codes and numbers are not', async () => {
    const neu = await text('uz', 'new')
    const old = await text('uz', 'old')
    expect(neu).toContain('Şahar-Çoy')
    expect(neu).toContain('Toşkent şahar')
    expect(neu).toContain('Özbekiston')
    expect(neu).toContain('Ğulomov Şuhrat')
    expect(neu).toContain('SH-12/2026') // a code with digits stays as typed
    expect(neu).toContain('+998 90 123 45 67')
    expect(neu).not.toMatch(/\{\{/)
    expect(neu).not.toMatch(/[oOgG][ʻ‘’']/)
    // and it is the old text converted, line for line, nothing else
    const o = old.split('\n')
    const n = neu.split('\n')
    expect(n.length).toBe(o.length)
    o.forEach((l, i) => expect(n[i], `line ${i}`).toBe(toNewLatin(l)))
  })
  test('the Russian talabnoma is never converted, whatever was asked', async () => {
    expect(await text('ru', 'new')).toBe(await text('ru', 'old'))
  })
})

describe('talabnoma (Uzbek): Cyrillic', () => {
  test('every word is Cyrillic; only the codes, numbers and the phone keep Latin characters', async () => {
    const t = await text('uz', 'cyr')
    expect(t).toContain('ТАЛАБНОМА')
    expect(t).toContain('“Шаҳар-Чой” МЧЖ')
    expect(t).toContain('Тошкент шаҳар, Чилонзор тумани')
    expect(t).toContain('Ғуломов Шуҳрат')
    expect(t).toContain('Ўзбекистон')
    expect(t).toContain('SH-12/2026') // a contract number is a code: it stays as typed
    expect(t).toContain('+998 90 123 45 67')
    expect(t).not.toMatch(/\{\{/)
    // the only Latin left is the contract number
    const latin = t.replace('SH-12/2026', '').match(/[A-Za-z]+/g) ?? []
    expect(latin).toEqual([])
  })
  test('it is the old-alphabet letter converted, line for line (the numbers, the layout and the lines are the same)', async () => {
    const old = (await text('uz', 'old')).split('\n')
    const cyr = (await text('uz', 'cyr')).split('\n')
    expect(cyr.length).toBe(old.length)
    old.forEach((l, i) => expect(cyr[i], `line ${i}`).toBe(toLatinScript(l, 'cyr')))
  })
  test('it reads back to the Latin letter', async () => {
    // «subyekt» is written without the ъ in Latin, so reading it back from «субъект» gives «subʼyekt»: the one honest difference
    const norm = (x: string) => x.toLowerCase().replace(/[ʻ‘’'`´ʼ]/g, 'ʻ').replace(/ʻy/g, 'y')
    const back = (await text('uz', 'cyr')).split('\n').map((l) => norm(uzCyrToLat(l)))
    const old = (await text('uz', 'old')).split('\n').map(norm)
    expect(back).toEqual(old)
  })
  test('the Russian talabnoma is never converted to Cyrillic Uzbek either', async () => {
    expect(await text('ru', 'cyr')).toBe(await text('ru', 'old'))
  })
})
