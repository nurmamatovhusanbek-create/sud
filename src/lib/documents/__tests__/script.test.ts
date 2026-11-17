/**
 * The alphabet step on real Word XML. The rule is «do not tweak»: only the four letters change, only inside <w:t> text,
 * only in documents that are Uzbek; every tag, attribute, placeholder, Russian half and English document stays as it is.
 */
import { describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { toNewLatin, toOldLatin } from '@/core/uz-alphabet'
import { DOCS, FIELDS } from '../registry'
import { withDerived } from '../derive'
import { applyScriptToZip, convertValues, convertWordXml, plainText, resolveScript, valuesForScript, valuesFor } from '../script'

// fill.server pulls in custom.server, which imports 'server-only' (provided by Next at build time, not installed here)
mock.module('server-only', () => ({}))
const { generateDocx } = await import('../fill.server')
const { generateBulkZip } = await import('../bulk.server')

const run = (t: string, attrs = '') => `<w:r><w:rPr><w:b/></w:rPr><w:t${attrs}>${t}</w:t></w:r>`
const para = (...runs: string[]) => `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${runs.join('')}</w:p>`
const doc = (...paras: string[]) => `<?xml version="1.0"?><w:document><w:body>${paras.join('')}</w:body></w:document>`
/** the XML with the text of every run emptied: tags and attributes only */
const skeleton = (xml: string) => xml.replace(/(<w:t(?:\s[^>]*)?>)[^<]*(<\/w:t>)/g, '$1$2')
const texts = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1])
/** each paragraph's text (runs joined); a line break, tab, picture or field also ends a «paragraph», as it does for the converter */
const BREAKS = /<w:(?:br|cr|tab|ptab|sym|drawing|pict|object|noBreakHyphen|softHyphen|fldChar)\b[^>]*>/g
const paragraphs = (xml: string) => xml.replace(BREAKS, '</w:p>').split('</w:p>').map((p) => texts(p).join('')).filter(Boolean)

describe('convertWordXml: one run', () => {
  test('converts the words, leaves every tag and attribute alone', () => {
    const xml = doc(para(run('Toshkent shahar, Oʻzbekiston', ' xml:space="preserve"')))
    const out = convertWordXml(xml, 'new')
    expect(texts(out)).toEqual(['Toşkent şahar, Özbekiston'])
    expect(skeleton(out)).toBe(skeleton(xml))
  })
  test('text that needs no change comes back as the very same string', () => {
    const xml = doc(para(run('Salom dunyo 2026-yil')), para(run('Начальник отдела')))
    expect(convertWordXml(xml, 'new')).toBe(xml)
    expect(convertWordXml(xml, 'old')).toBe(xml)
  })
  test('an unchanged run next to a changed one is byte-identical', () => {
    const a = run('Salom', ' xml:space="preserve"')
    const b = run('shahar')
    const out = convertWordXml(doc(para(a, b)), 'new')
    expect(out).toContain(a)
    expect(out).toContain('>şahar<')
  })
})

describe('convertWordXml: a word split across runs (how Word really stores them)', () => {
  test('«Oʻ» | «zbekiston»', () => {
    const out = convertWordXml(doc(para(run('Oʻ'), run('zbekiston'))), 'new')
    expect(texts(out)).toEqual(['Ö', 'zbekiston'])
  })
  test('the apostrophe in a run of its own: «O» | «’» | «zbekiston»', () => {
    const out = convertWordXml(doc(para(run('O'), run('’'), run('zbekiston'))), 'new')
    expect(texts(out)).toEqual(['Ö', '', 'zbekiston'])
    expect(paragraphs(out)).toEqual(['Özbekiston'])
  })
  test('«Bo» | «ʻ» | «lim», «boshlig» | «‘»', () => {
    expect(paragraphs(convertWordXml(doc(para(run('Bo'), run('ʻ'), run('lim'), run(' '), run('boshlig'), run('‘'))), 'new'))).toEqual(['Bölim boşliğ'.replace('boşliğ', 'boshlig‘'.replace('g‘', 'ğ').replace('sh', 'ş'))])
  })
  test('the digraph itself split: «S» | «h» | «ahar», «C» | «hoy»', () => {
    const out = convertWordXml(doc(para(run('S'), run('h'), run('ahar '), run('C'), run('hoy'))), 'new')
    expect(paragraphs(out)).toEqual(['Şahar Çoy'])
    expect(texts(out)).toEqual(['Ş', '', 'ahar ', 'Ç', 'oy'])
  })
  test('the other direction, with the tutuq inserted between two separate letters', () => {
    expect(paragraphs(convertWordXml(doc(para(run('Ö'), run('zbek '), run('Ş'), run('ahar'))), 'old'))).toEqual(['Oʻzbek Shahar'])
    expect(paragraphs(convertWordXml(doc(para(run('Öshoq'))), 'old'))).toEqual(['Oʻsʼhoq'])
  })
  test('formatting of the run that held the first character is what the new letter gets', () => {
    const xml = doc(para('<w:r><w:rPr><w:i/></w:rPr><w:t>Oʻ</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>zbek</w:t></w:r>'))
    const out = convertWordXml(xml, 'new')
    expect(out).toContain('<w:rPr><w:i/></w:rPr><w:t>Ö</w:t>')
    expect(out).toContain('<w:rPr><w:b/></w:rPr><w:t>zbek</w:t>')
    expect(skeleton(out)).toBe(skeleton(xml))
  })
})

describe('convertWordXml: what text is never read across', () => {
  test('a paragraph end', () => {
    const xml = doc(para(run('S')), para(run('hahar')))
    expect(convertWordXml(xml, 'new')).toBe(xml)
  })
  test('a line break, a tab, a picture, a field', () => {
    for (const mid of ['<w:r><w:br/></w:r>', '<w:r><w:tab/></w:r>', '<w:r><w:drawing><wp:inline/></w:drawing></w:r>', '<w:r><w:fldChar w:fldCharType="begin"/></w:r>']) {
      const xml = doc(para(run('S'), mid, run('hahar')))
      expect(convertWordXml(xml, 'new')).toBe(xml)
    }
  })
  test('<w:pPr>, <w:tbl>, <w:tc>, <w:tr> are not text and not paragraph boundaries by accident', () => {
    const xml = doc('<w:tbl><w:tr><w:tc>' + para(run('shahar')) + '</w:tc></w:tr></w:tbl>')
    expect(texts(convertWordXml(xml, 'new'))).toEqual(['şahar'])
  })
  test('field codes (instrText) and an empty <w:t/> are left alone', () => {
    const xml = doc(para('<w:r><w:instrText xml:space="preserve"> PAGE shahar </w:instrText></w:r>', '<w:r><w:t/></w:r>', run('choy')))
    const out = convertWordXml(xml, 'new')
    expect(out).toContain(' PAGE shahar ')
    expect(texts(out)).toEqual(['çoy'])
  })
})

describe('convertWordXml: placeholders and escapes', () => {
  test('{{keys}} are never touched, even when they look like words, and the words around them still convert', () => {
    const out = convertWordXml(doc(para(run('shahar '), run('{{short_name}}'), run(' choy {{ch_sh_date}} Oʻzbek'))), 'new')
    expect(paragraphs(out)).toEqual(['şahar {{short_name}} çoy {{ch_sh_date}} Özbek'])
  })
  test('a placeholder glued to a word does not swallow it', () => {
    expect(paragraphs(convertWordXml(doc(para(run('{{city}}shahri'))), 'new'))).toEqual(['{{city}}şahri'])
  })
  test('XML entities survive: &amp; &lt; &gt; and numeric references', () => {
    const out = convertWordXml(doc(para(run('Sh &amp; Ch &lt;shahar&gt; O&#8216;zbek O&#x2018;zbek'))), 'new')
    expect(texts(out)).toEqual(['Ş &amp; Ç &lt;şahar&gt; Özbek Özbek'])
  })
  test('a changed run is escaped again, so the XML stays well-formed', () => {
    const out = convertWordXml(doc(para(run('a &amp; b shahar < &gt;'.replace('< ', '&lt; ')))), 'new')
    expect(texts(out)).toEqual(['a &amp; b şahar &lt; &gt;'])
  })
  test('attributes on the run and on <w:t> are kept', () => {
    const xml = doc(para(run('shahar', ' xml:space="preserve" w:foo="a&gt;b"')))
    expect(skeleton(convertWordXml(xml, 'new'))).toBe(skeleton(xml))
  })
  test('Russian paragraphs, Latin e-mail and codes inside Uzbek text', () => {
    const t = 'Директор ООО «Шахар» / shahar sh@x.uz SH123 4-1001-2610/40824'
    expect(texts(convertWordXml(doc(para(run(t))), 'new'))).toEqual(['Директор ООО «Шахар» / şahar sh@x.uz SH123 4-1001-2610/40824'])
  })
})

describe('the text parts of a .docx', () => {
  test('headers, footers and footnotes are converted too; other parts are not read', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', doc(para(run('shahar'))))
    zip.file('word/header1.xml', doc(para(run('Oʻzbekiston'))))
    zip.file('word/footer2.xml', doc(para(run('choy'))))
    zip.file('word/footnotes.xml', doc(para(run('shartnoma'))))
    zip.file('word/styles.xml', '<w:styles><w:t>shahar</w:t></w:styles>')
    zip.file('word/media/image1.png', 'shahar')
    const n = await applyScriptToZip(zip, 'new')
    expect(n).toBe(4)
    expect(texts(await zip.file('word/header1.xml')!.async('string'))).toEqual(['Özbekiston'])
    expect(texts(await zip.file('word/footer2.xml')!.async('string'))).toEqual(['çoy'])
    expect(texts(await zip.file('word/footnotes.xml')!.async('string'))).toEqual(['şartnoma'])
    expect(await zip.file('word/styles.xml')!.async('string')).toBe('<w:styles><w:t>shahar</w:t></w:styles>')
    expect(await zip.file('word/media/image1.png')!.async('string')).toBe('shahar')
  })
})

describe('English and other non-Uzbek documents are left exactly as they are', () => {
  const en = doc(para(run('We shall be pleased to welcome the guest, which should arrive from Chicago with the Chief of the school.')))
  const uz = doc(para(run('Toshkent shahar, shartnoma boʻyicha')))
  test('declared English: no conversion, in either direction', () => {
    expect(resolveScript(uz, 'en', 'new')).toBeNull()
    expect(resolveScript(uz, 'en', 'old')).toBeNull()
  })
  test('reads as English even when nothing declares it (the operator’s own templates)', () => {
    expect(resolveScript(en, 'uz', 'new')).toBeNull()
    expect(resolveScript(en, undefined, 'old')).toBeNull()
  })
  test('Uzbek and Russian-Uzbek documents get the alphabet that was asked for', () => {
    expect(resolveScript(uz, 'uz', 'new')).toBe('new')
    expect(resolveScript(uz, 'ru-uz', 'old')).toBe('old')
    expect(resolveScript(uz, undefined, 'new')).toBe('new')
  })
  test('values for an English document are exactly what was typed (+ the derived keys), a Turkish surname included', () => {
    expect(valuesFor({ full_name: 'Özdemir Şahin' }, null)).toEqual(withDerived({ full_name: 'Özdemir Şahin' }))
  })
  test('plainText reads the runs and puts a space between paragraphs', () => {
    expect(plainText(doc(para(run('a'), run('b')), para(run('c')))).split(/\s+/).filter(Boolean)).toEqual(['ab', 'c'])
  })
})

describe('values', () => {
  test('every value converted, keys untouched, non-text left', () => {
    expect(convertValues({ company: '«Shahar» MChJ', name: 'Oʻtkir Gʻulomov', n: '12', email: 'sh@x.uz' }, 'new')).toEqual({ company: '«Şahar» MÇJ', name: 'Ötkir Ğulomov', n: '12', email: 'sh@x.uz' })
  })
  test('old script and nothing typed in the new alphabet: exactly what the app did before (withDerived)', () => {
    const v = { dir_full: 'Turgunov Sherzod Azimjanovich', emp_name: 'Oʻktamov Shuhrat Gʻulomovich', company: '“Artikul” MCHJ', phone: '+998 90 123 45 67', case_number: '4-1001-2610/40824' }
    expect(valuesForScript(v, 'old')).toEqual(withDerived(v))
  })
  test('typed in the new alphabet, asked for the old one: normalised BEFORE the derivations, so the Cyrillic is right', () => {
    const old = valuesForScript({ emp_name: 'Oʻktamov Shuhrat' }, 'old')
    const neu = valuesForScript({ emp_name: 'Öktamov Şuhrat' }, 'old')
    expect(neu).toEqual({ ...old, emp_name: 'Oʻktamov Shuhrat' })
    expect(neu.emp_name_ru).toBe('Уктамов Шухрат')
  })
  test('asked for the new alphabet: the Latin is new, the Cyrillic derived from it is unchanged', () => {
    const old = valuesForScript({ emp_name: 'Oʻktamov Shuhrat', dir_full: 'Turgunov Sherzod Azimjanovich' }, 'old')
    const neu = valuesForScript({ emp_name: 'Oʻktamov Shuhrat', dir_full: 'Turgunov Sherzod Azimjanovich' }, 'new')
    expect(neu.emp_name).toBe('Öktamov Şuhrat')
    expect(neu.emp_name_ru).toBe(old.emp_name_ru)
    expect(neu.dir_full_ru).toBe(old.dir_full_ru)
    expect(neu.dir_short_uz).toBe(toNewLatin(old.dir_short_uz))
    expect(neu.dir_short_uz).toContain('Ş.A.')
  })
  test('the same result whether typed old or new, for the same name', () => {
    expect(valuesForScript({ emp_name: 'Öktamov Şuhrat' }, 'new')).toEqual(valuesForScript({ emp_name: 'Oʻktamov Shuhrat' }, 'new'))
  })
})

// ---- the shipped templates ---------------------------------------------------------------------------------------------

const DIR = path.join(process.cwd(), 'src', 'lib', 'documents', 'templates')
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.docx')).sort()
const TEXT_PART = /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes)\.xml$/
const placeholderList = (xml: string) => [...xml.matchAll(/\{\{[a-z_0-9]+\}\}/g)].map((m) => m[0])
const cyr = (s: string) => (s.match(/[Ѐ-ӿ]/g) ?? []).join('')
const PLACE = /\{\{[a-z_0-9]+\}\}/g

async function parts(file: string): Promise<{ name: string; xml: string }[]> {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(DIR, file)))
  const out: { name: string; xml: string }[] = []
  for (const name of Object.keys(zip.files).sort()) if (TEXT_PART.test(name)) out.push({ name, xml: await zip.file(name)!.async('string') })
  return out
}

describe('every shipped template', () => {
  test('there are templates to test', () => expect(FILES.length).toBeGreaterThanOrEqual(13))

  for (const file of FILES) {
    describe(file, () => {
      test('old alphabet: not one byte changes (the templates are already written in it)', async () => {
        for (const p of await parts(file)) expect(convertWordXml(p.xml, 'old'), `${file} ${p.name}`).toBe(p.xml)
      })

      test('new alphabet: tags, attributes and placeholders are untouched; only text moves', async () => {
        for (const p of await parts(file)) {
          const out = convertWordXml(p.xml, 'new')
          expect(skeleton(out), `${file} ${p.name} skeleton`).toBe(skeleton(p.xml))
          expect(placeholderList(out), `${file} ${p.name} placeholders`).toEqual(placeholderList(p.xml))
        }
      })

      test('new alphabet: each paragraph is exactly the old paragraph converted (placeholders and Russian untouched)', async () => {
        for (const p of await parts(file)) {
          const before = paragraphs(p.xml)
          const after = paragraphs(convertWordXml(p.xml, 'new'))
          expect(after.length).toBe(before.length)
          before.forEach((b, i) => {
            // the converter's own rule, applied to the whole paragraph with the placeholders set aside
            const keep: string[] = []
            const masked = b.replace(PLACE, (m) => (keep.push(m), '\u0001'))
            let k = 0
            const expected = toNewLatin(masked).replace(/\u0001/g, () => keep[k++])
            expect(after[i], `${file} ${p.name} ¶${i}`).toBe(expected)
            expect(cyr(after[i])).toBe(cyr(b)) // the Russian half is character for character the same
          })
        }
      })

      test('new alphabet: no old spelling is left in the words (only e-mail/links/codes may keep one)', async () => {
        for (const p of await parts(file)) {
          for (const para of paragraphs(convertWordXml(p.xml, 'new'))) {
            for (const tok of para.replace(PLACE, ' ').split(/\s+/)) {
              if (/@|:\/\/|^www\.|\.(?:uz|com|ru|org)\b|[A-Za-z]\d|\d[A-Za-z]/i.test(tok)) continue
              expect(tok, `${file} ${p.name}: «${tok}»`).not.toMatch(/[oOgG][ʻ‘’'`´]|[sScC][hH]/)
            }
          }
        }
      })

      test('round trip: new → old gives the same words back (the reader sees the same text; tags identical)', async () => {
        for (const p of await parts(file)) {
          const back = convertWordXml(convertWordXml(p.xml, 'new'), 'old')
          // two honest differences, neither a tweak of the words: the template spells the modifier in several ways (‘ ’ ʻ)
          // and one «Ş» cannot remember whether it was «Sh» or «SH» («JShShIR» comes back «JSHSHIR»), so compare without case
          const norm = (x: string) => paragraphs(x).join('\n').replace(/[ʻ‘’'`´]/g, 'ʻ').toLowerCase()
          expect(norm(back), `${file} ${p.name}`).toBe(norm(p.xml))
          expect(skeleton(back)).toBe(skeleton(p.xml))
        }
      })
    })
  }
})

// ---- end to end ---------------------------------------------------------------------------------------------------------

/** a value for every field of a document, with the letters that change */
function sample(fields: string[]): Record<string, string> {
  const v: Record<string, string> = {}
  for (const k of fields) {
    const f = FIELDS[k]
    if (f.kind === 'date') v[k] = '2026-11-12'
    else if (/phone|tel/i.test(k)) v[k] = '+998 90 123 45 67'
    else if (/email|mail/i.test(k)) v[k] = 'sh.turgunov@gmail.com'
    else if (/stir|inn|passport|number|no$|_no|code|account|mfo|date|term|months|years|brv|days/i.test(k)) v[k] = f.default && /\d/.test(f.default) ? f.default : '1234567'
    else v[k] = 'Shuhrat Oʻktamov Gʻulomovich, Chilonzor shahar'
  }
  return v
}

describe('end to end: a generated document in both alphabets', () => {
  for (const d of DOCS) {
    test(`${d.id}: the new-alphabet document is the old-alphabet document converted, nothing else`, async () => {
      const values = sample(d.fields)
      const a = await generateDocx(d.id, values, { script: 'old' })
      const b = await generateDocx(d.id, values, { script: 'new' })
      const za = await JSZip.loadAsync(a.buffer)
      const zb = await JSZip.loadAsync(b.buffer)
      expect(Object.keys(zb.files).sort()).toEqual(Object.keys(za.files).sort())
      for (const name of Object.keys(za.files)) {
        if (za.files[name].dir) continue
        const xa = await za.file(name)!.async('string')
        const xb = await zb.file(name)!.async('string')
        if (!TEXT_PART.test(name)) {
          // not text: identical (pictures, styles, settings, rels). The letterhead swap writes the same bytes both times.
          expect(xb === xa, `${d.id}: ${name} must be identical`).toBe(true)
          continue
        }
        expect(skeleton(xb), `${d.id}: ${name} skeleton`).toBe(skeleton(xa))
        if (d.lang === 'en') {
          expect(xb, `${d.id}: an English document is not touched`).toBe(xa)
          continue
        }
        const pa = paragraphs(xa)
        const pb = paragraphs(xb)
        expect(pb.length).toBe(pa.length)
        pa.forEach((t, i) => expect(pb[i], `${d.id} ${name} ¶${i}`).toBe(toNewLatin(t)))
        // nothing is left unfilled in either
        expect(xa).not.toMatch(/\{\{/)
        expect(xb).not.toMatch(/\{\{/)
      }
    })
  }

  test('the old alphabet (the default) is exactly what the generator produced before this feature', async () => {
    const values = sample(DOCS.find((x) => x.id === 'court_postpone')!.fields)
    const dflt = await generateDocx('court_postpone', values)
    const old = await generateDocx('court_postpone', values, { script: 'old' })
    const za = await JSZip.loadAsync(dflt.buffer)
    const zb = await JSZip.loadAsync(old.buffer)
    expect(await zb.file('word/document.xml')!.async('string')).toBe(await za.file('word/document.xml')!.async('string'))
  })

  test('typed in the new alphabet, asked for the old one: the document comes out in the old alphabet', async () => {
    const d = DOCS.find((x) => x.id === 'court_postpone')!
    const typedNew = { ...sample(d.fields), court: 'Toşkent şahar Çilonzor iqtisodiy sudi', judge: 'Özbekov Ğ.' }
    const out = await generateDocx(d.id, typedNew, { script: 'old' })
    const xml = await (await JSZip.loadAsync(out.buffer)).file('word/document.xml')!.async('string')
    const t = paragraphs(xml).join('\n')
    expect(t).toContain('Toshkent shahar Chilonzor iqtisodiy sudi')
    expect(t).toContain('Oʻzbekov Gʻ.')
    expect(t).not.toMatch(/[ĞğÖöŞşÇç]/)
  })

  test('a Russian-Uzbek document: the Russian half is the same in both alphabets', async () => {
    const d = DOCS.find((x) => x.lang === 'ru-uz')!
    const values = sample(d.fields)
    const a = paragraphs(await (await JSZip.loadAsync((await generateDocx(d.id, values, { script: 'old' })).buffer)).file('word/document.xml')!.async('string'))
    const b = paragraphs(await (await JSZip.loadAsync((await generateDocx(d.id, values, { script: 'new' })).buffer)).file('word/document.xml')!.async('string'))
    expect(b.map(cyr)).toEqual(a.map(cyr))
    expect(b.join('\n')).not.toEqual(a.join('\n'))
  })

  test('the spreadsheet ZIP: every row in the chosen alphabet', async () => {
    const rows = [{ court: 'Toshkent shahar sudi', case_number: '4-1001-2610/1' }, { court: 'Chirchiq shahar sudi', case_number: '4-1001-2610/2' }]
    for (const script of ['old', 'new'] as const) {
      const zip = await JSZip.loadAsync((await generateBulkZip('court_postpone', rows, { script })).buffer)
      const names = Object.keys(zip.files).sort()
      expect(names.length).toBe(2)
      const t = await Promise.all(names.map(async (n) => paragraphs(await (await JSZip.loadAsync(await zip.file(n)!.async('nodebuffer'))).file('word/document.xml')!.async('string')).join('\n')))
      if (script === 'new') {
        expect(t[0]).toContain('Toşkent şahar sudi')
        expect(t[1]).toContain('Çirçiq şahar sudi')
        expect(t.join('')).toContain('4-1001-2610/1') // numbers untouched
      } else {
        expect(t[0]).toContain('Toshkent shahar sudi')
        expect(t[1]).toContain('Chirchiq shahar sudi')
      }
    }
  })
})
