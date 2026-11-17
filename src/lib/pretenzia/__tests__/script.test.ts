/** The Uzbek talabnoma can be written in either Latin alphabet; the Russian one is never converted. */
import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { toNewLatin } from '@/core/uz-alphabet'
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

async function text(lang: 'ru' | 'uz', script?: 'old' | 'new'): Promise<string> {
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
