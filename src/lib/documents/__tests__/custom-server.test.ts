import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'

mock.module('server-only', () => ({}))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-tpl-'))
process.env.DOC_TEMPLATES_DIR = dir
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

let cs: typeof import('../custom.server')
let fill: typeof import('../fill.server')
let reg: typeof import('../custom')
beforeAll(async () => {
  cs = await import('../custom.server')
  fill = await import('../fill.server')
  reg = await import('../custom')
})

async function docx(paragraphs: string[][], extra: Record<string, string> = {}, types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'): Promise<Buffer> {
  const z = new JSZip()
  z.file('[Content_Types].xml', types)
  z.file('word/document.xml', `<w:document><w:body>${paragraphs.map((runs) => `<w:p>${runs.map((t) => `<w:r><w:t>${t}</w:t></w:r>`).join('')}</w:p>`).join('')}</w:body></w:document>`)
  for (const [k, v] of Object.entries(extra)) z.file(k, v)
  return z.generateAsync({ type: 'nodebuffer' })
}

describe('custom templates (server)', () => {
  test('save → list → generate fills the markers (even ones Word split) → delete', async () => {
    const saved = await cs.saveCustom(await docx([['Shartnoma № {{contract', '_no}}'], ['Mijoz: {{ Company }}']]), 'Mening shartnomam')
    expect(saved.meta.fields.map((f) => f.key)).toEqual(['contract_no', 'company'])
    expect(saved.meta.id).toMatch(/^custom_mening-shartnomam_[0-9a-f]{4}$/)
    expect(fs.statSync(path.join(dir, `${saved.meta.id}.docx`)).mode & 0o777).toBe(0o600)

    expect((await cs.listCustom()).map((m) => m.id)).toEqual([saved.meta.id])

    const out = await fill.generateDocx(saved.meta.id, { contract_no: 'K-77', company: 'Alfa MCHJ' })
    const zip = await JSZip.loadAsync(out.buffer)
    const t = (await zip.file('word/document.xml')!.async('string')).replace(/<[^>]+>/g, '')
    expect(t).toBe('Shartnoma № K-77Mijoz: Alfa MCHJ')
    expect(Buffer.from(await fill.readTemplate(saved.meta.id)).length).toBeGreaterThan(50)

    await cs.deleteCustom(saved.meta.id)
    expect(await cs.listCustom()).toEqual([])
    expect(reg.isCustomId(saved.meta.id)).toBe(true)
    await expect(fill.readTemplate(saved.meta.id)).rejects.toThrow()
  })
  test('no markers → refused with a hint', async () => {
    await expect(cs.saveCustom(await docx([['Oddiy matn']]), 'X')).rejects.toThrow('{{maydon}}')
  })
  test('not a docx / not a word document / a macro file are refused', async () => {
    await expect(cs.saveCustom(Buffer.from('hello'), 'X')).rejects.toThrow('docx')
    const z = new JSZip()
    z.file('a.txt', 'x')
    await expect(cs.saveCustom(await z.generateAsync({ type: 'nodebuffer' }), 'X')).rejects.toThrow('Word')
    await expect(cs.saveCustom(await docx([['{{a}}']], { 'word/vbaProject.bin': 'x' }), 'X')).rejects.toThrow('Makro')
    await expect(cs.saveCustom(await docx([['{{a}}']], {}, '<Types><Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>'), 'X')).rejects.toThrow('Makro')
  })
  test('empty and oversized uploads are refused', async () => {
    await expect(cs.saveCustom(Buffer.alloc(0), 'X')).rejects.toThrow('boʻsh')
    await expect(cs.saveCustom(Buffer.alloc(5 * 1024 * 1024 + 1), 'X')).rejects.toThrow('katta')
  })
  test('too many fields are refused', async () => {
    const many = Array.from({ length: 81 }, (_, i) => `{{k${i}}}`).join(' ')
    await expect(cs.saveCustom(await docx([[many]]), 'X')).rejects.toThrow('koʻp')
  })
  test('only a generated id is ever a file name (path tricks are refused)', async () => {
    await expect(cs.deleteCustom('../../etc/passwd')).rejects.toThrow()
    await expect(cs.readCustomTemplate('custom_../../x_abcd')).rejects.toThrow()
    await expect(cs.deleteCustom('court_copy')).rejects.toThrow()
  })
  test('a damaged meta file is skipped, not fatal', async () => {
    fs.writeFileSync(path.join(dir, 'custom_broken_abcd.json'), '{nope')
    expect(Array.isArray(await cs.listCustom())).toBe(true)
  })
})
