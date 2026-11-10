import { afterEach, describe, expect, test } from 'bun:test'
import { fillXml } from '../fill.shared'
import { DOCS, FIELDS, docById, tabById } from '../registry'
import { humanize, isCustomId, metaFor, registerCustomDocs, scanTemplate, slugify } from '../custom'

const p = (...runs: string[]) => `<w:p><w:pPr/>${runs.map((t) => `<w:r><w:rPr><w:b/></w:rPr><w:t>${t}</w:t></w:r>`).join('')}</w:p>`
const body = (...ps: string[]) => `<w:document><w:body>${ps.join('')}</w:body></w:document>`

describe('scanTemplate', () => {
  test('a clean marker is found and left as it is', () => {
    const r = scanTemplate(body(p('Hurmatli {{full_name}}!')))
    expect(r.keys).toEqual(['full_name'])
    expect(r.xml).toContain('{{full_name}}')
  })
  test('a marker Word split across runs is put back into ONE run, so the fill works', () => {
    const xml = body(p('Hurmatli {{ful', 'l_na', 'me}}, salom'))
    const r = scanTemplate(xml)
    expect(r.keys).toEqual(['full_name'])
    const filled = fillXml(r.xml, { full_name: 'Ali' }).replace(/<[^>]+>/g, '')
    expect(filled).toBe('Hurmatli Ali, salom')
  })
  test('the braces themselves can be split: «{» + «{key}» + «}»', () => {
    const r = scanTemplate(body(p('x {', '{company}', '} y')))
    expect(r.keys).toEqual(['company'])
    expect(fillXml(r.xml, { company: 'Alfa' }).replace(/<[^>]+>/g, '')).toBe('x Alfa y')
  })
  test('spaces, capitals and dashes inside the braces are tidied', () => {
    const r = scanTemplate(body(p('{{ Company }} / {{Full-Name}}')))
    expect(r.keys).toEqual(['company', 'full_name'])
    expect(r.xml).toContain('{{company}} / {{full_name}}')
  })
  test('the same key twice is one field; order of first appearance', () => {
    expect(scanTemplate(body(p('{{b}} {{a}}'), p('{{b}}'))).keys).toEqual(['b', 'a'])
  })
  test('a marker that cannot be a key is reported and left as written', () => {
    const r = scanTemplate(body(p('{{full name!}} {{ok}}')))
    expect(r.keys).toEqual(['ok'])
    expect(r.invalid).toEqual(['{{full name!}}'])
    expect(r.xml).toContain('{{full name!}}')
  })
  test('text without markers is untouched, byte for byte', () => {
    const xml = body(p('Oddiy matn'), '<w:p><w:r><w:t xml:space="preserve"> x </w:t></w:r></w:p>')
    expect(scanTemplate(xml).xml).toBe(xml)
  })
  test('a node that now starts or ends with a space keeps it (xml:space)', () => {
    const r = scanTemplate(body(p('a ', '{{x', '}} b')))
    expect(fillXml(r.xml, { x: 'X' }).replace(/<[^>]+>/g, '')).toBe('a X b')
  })
  test('markers in different paragraphs do not glue together', () => {
    const r = scanTemplate(body(p('{{a'), p('b}}')))
    expect(r.keys).toEqual([])
  })
})

describe('registering custom documents', () => {
  afterEach(() => registerCustomDocs([]))

  test('slug, id, humanize', () => {
    expect(slugify('Mehnat shartnomasi (yangi)')).toBe('mehnat-shartnomasi-yangi')
    expect(slugify('Oʻzbekcha ʻʻ')).toBe('ozbekcha')
    expect(isCustomId('custom_x')).toBe(true)
    expect(isCustomId('court_copy')).toBe(false)
    expect(humanize('sender_name')).toBe('Sender name')
  })
  test('a known key keeps its catalog label; an unknown one is labelled after the key', () => {
    const m = metaFor('Ariza', ['company', 'zzz_special_note'], 'custom_ariza')
    expect(m.fields[0].label).toBe(FIELDS.company.label)
    expect(m.fields[1].label).toBe('Zzz special note')
  })
  test('registered docs are found by the registry, in their own category; replaced on re-register, removed when gone', () => {
    registerCustomDocs([metaFor('Ariza', ['company', 'zzz_special_note'], 'custom_ariza')])
    const d = docById('custom_ariza')!
    expect(d.tab).toBe('custom')
    expect(d.fields).toEqual(['company', 'zzz_special_note'])
    expect(tabById('custom')?.separate).toBe(true)
    expect(FIELDS.zzz_special_note.label).toBe('Zzz special note')
    registerCustomDocs([metaFor('Boshqa', ['company'], 'custom_boshqa')])
    expect(docById('custom_ariza')).toBeUndefined()
    expect(docById('custom_boshqa')).toBeTruthy()
    registerCustomDocs([])
    expect(DOCS.some((x) => isCustomId(x.id))).toBe(false)
  })
  test('the built-in documents are never touched', () => {
    const before = DOCS.filter((d) => !isCustomId(d.id)).length
    registerCustomDocs([metaFor('X', ['a'], 'custom_x')])
    registerCustomDocs([])
    expect(DOCS.length).toBe(before)
  })
})
