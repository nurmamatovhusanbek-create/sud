/**
 * The shipped .docx templates and the registry must agree, and a template must carry nothing of the document it was
 * made from. (Templates are built by scripts/doc-templates from real company forms; the real documents are never in
 * the repo, so these checks are what keeps personal data out of it.)
 */
import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { DOCS, FIELDS, categoryDefaults, docById, tabById } from '../registry'
import { generateDocx } from '../fill.server'

const DIR = path.join(process.cwd(), 'src', 'lib', 'documents', 'templates')
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.docx'))

const load = (file: string) => JSZip.loadAsync(fs.readFileSync(path.join(DIR, file)))
const wordText = (xml: string) => [...xml.matchAll(/<w:t\b[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('')
const placeholders = (xml: string) => new Set([...xml.matchAll(/\{\{([a-z_]+)\}\}/g)].map((m) => m[1]))

describe('templates ⇄ registry', () => {
  for (const doc of DOCS) {
    test(`${doc.id}: the template uses exactly the fields the registry lists`, async () => {
      const zip = await load(doc.file)
      const used = placeholders(await zip.file('word/document.xml')!.async('string'))
      expect([...used].sort()).toEqual([...new Set(doc.fields)].sort())
    })
    test(`${doc.id}: every field is defined`, () => {
      for (const k of doc.fields) expect(FIELDS[k], `${doc.id} → ${k}`).toBeDefined()
    })
  }

  test('every document file exists', () => {
    for (const doc of DOCS) expect(FILES).toContain(doc.file)
  })
})

describe('a template carries nothing of the original document', () => {
  for (const file of FILES) {
    test(`${file}: no preview image, no author names`, async () => {
      const zip = await load(file)
      // Word keeps a PREVIEW IMAGE of the first page (the original's names and passport numbers, readable)
      expect(Object.keys(zip.files).filter((n) => /thumbnail/i.test(n))).toEqual([])
      const rels = await zip.file('_rels/.rels')!.async('string')
      expect(rels).not.toMatch(/thumbnail/i)
      const core = zip.file('docProps/core.xml') ? await zip.file('docProps/core.xml')!.async('string') : ''
      expect([...core.matchAll(/<(?:dc:creator|cp:lastModifiedBy)>([^<]+)</g)].map((m) => m[1])).toEqual([])
    })

    test(`${file}: no passport number or phone number in the text`, async () => {
      const zip = await load(file)
      let text = ''
      for (const n of Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))) {
        text += wordText(await zip.file(n)!.async('string')) + '\n'
      }
      expect(text.match(/\b[A-Z]{1,2}\s?\d{7}\b/g) ?? []).toEqual([]) // two letters + seven digits, as on a real passport
      expect(text.match(/\+998[\s(]*\d[\d\s()-]{6,}/g) ?? []).toEqual([])
    })
  }
})

describe('IIO documents', () => {
  const iio = tabById('iio')!

  test('the guarantee letter\'s «Ish joyi, lavozimi» cell defaults to «ishlash uchun»; no visa reads «–»', () => {
    const d = categoryDefaults(iio)
    expect(d.position).toBe('ishlash uchun')
    expect(d.visa_type).toBe('–')
    expect(d.visa_no).toBe('–')
    expect(d.visa_issuer).toBe('–')
    expect(d.children).toBe('yo‘q')
    // the visa category keeps «Lavozim» a plain job title
    expect(categoryDefaults(tabById('visa')!).position).toBe('')
  })

  test('the registration request has the fields the real form has (entry, address, housing, responsible person)', () => {
    const doc = docById('iio2_royxat')!
    for (const k of ['district_office', 'out_no', 'doc_date', 'entry_date', 'stay_address', 'host_name', 'host_phone', 'resp_name', 'resp_passport', 'resp_phone', 'resp_mobile']) {
      expect(doc.fields).toContain(k)
    }
    expect(doc.fields).not.toContain('visa_from')
    expect(doc.fields).not.toContain('visa_to')
  })

  test('the shared panel carries the outgoing number and date for both documents', () => {
    const keys = iio.groups!.flatMap((g) => g.keys)
    expect(keys).toEqual(expect.arrayContaining(['company', 'director', 'out_no', 'doc_date', 'district_office', 'full_name', 'position']))
  })

  test('filling the registration request writes every value and leaves no placeholder', async () => {
    const values: Record<string, string> = {
      company: 'Test MCHJ', director: 'Test D.', out_no: '12', doc_date: '2026 yil «07» oktyabr', district_office: 'TEST IIO FMB MvaPB',
      full_name: 'Test Person', sex: 'Erkak', dob: '01.02.2000', birthplace: 'Testville', citizenship: 'Testland', passport: 'ZZ 0000000', children: 'yo‘q',
      visa_type: '–', visa_no: '–', visa_issuer: '–', visa_days: '30', entry_date: '03.10.2026', stay_address: 'Test MFY, 1-uy',
      host_name: 'Host Name', host_phone: '+998 00 000 00 01', resp_name: 'Resp Name', resp_passport: 'ZZ 0000001', resp_phone: '+998 00 000 00 02', resp_mobile: '+998 00 000 00 03',
    }
    const out = await generateDocx('iio2_royxat', values, { blankIfNone: true })
    const text = wordText(await (await JSZip.loadAsync(out.buffer)).file('word/document.xml')!.async('string'))
    for (const v of Object.values(values)) expect(text, v).toContain(v)
    expect(text).not.toContain('{{')
    expect(text).toContain('TEST IIO FMB MvaPB BOSHLIG‘IGA') // the district and «BOSHLIG‘IGA» read as one heading
  })

  test('an untouched form prints dashes for the visa lines, not blanks', async () => {
    const d = categoryDefaults(iio)
    const out = await generateDocx('iio2_royxat', { ...d, full_name: 'X' }, { blankIfNone: true })
    const text = wordText(await (await JSZip.loadAsync(out.buffer)).file('word/document.xml')!.async('string'))
    expect(text).toContain('Viza turi va №: –, –')
    expect(text).toContain('uning muddati: –')
  })

  test('the guarantee letter fills the sentence and the table row', async () => {
    const out = await generateDocx(
      'iio1_kafolat',
      { company: 'Test MCHJ', director: 'Test D.', doc_date: '07.10.2026', district_office: 'TEST IIO FMB MvaPB', full_name: 'Test Person', sex: 'Erkak', dob: '01.02.2000', birthplace: 'Testville', citizenship: 'Testland', passport: 'ZZ 0000000', position: 'ishlash uchun' },
      { blankIfNone: true },
    )
    const text = wordText(await (await JSZip.loadAsync(out.buffer)).file('word/document.xml')!.async('string'))
    expect(text).toContain('taklif etilayotgan Testland fuqarosini')
    expect(text).toContain('Test MCHJ ishlash uchun')
    expect(text).not.toContain('{{')
  })
})
