import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { generateBulkZip } from '../bulk.server'
import { MAX_BULK_ROWS } from '../bulk'

const text = async (z: JSZip, name: string) => (await z.file(name)!.async('string')).replace(/<[^>]+>/g, '')

describe('generateBulkZip', () => {
  test('one numbered .docx per row, each filled with its own row', async () => {
    const out = await generateBulkZip('court_postpone', [
      { court: 'Toshkent iqtisodiy sud', case_number: '4-1001-2609/11111' },
      { court: 'Toshkent iqtisodiy sud', case_number: '4-1001-2609/22222' },
    ])
    const zip = await JSZip.loadAsync(out.buffer)
    const names = Object.keys(zip.files).sort()
    expect(names.length).toBe(2)
    expect(names[0].startsWith('01-')).toBe(true)
    expect(names[1].startsWith('02-')).toBe(true)
    const inner = await JSZip.loadAsync(await zip.file(names[1])!.async('nodebuffer'))
    const t = await text(inner, 'word/document.xml')
    expect(t).toContain('4-1001-2609/22222')
    expect(t).not.toContain('4-1001-2609/11111')
    expect(out.filename).toContain('-2-ta-')
  })
  test('the same person twice does not overwrite (numbered names)', async () => {
    const out = await generateBulkZip('court_postpone', [{ case_number: 'A' }, { case_number: 'A' }])
    expect(Object.keys((await JSZip.loadAsync(out.buffer)).files).length).toBe(2)
  })
  test('no rows, or too many, is refused', async () => {
    await expect(generateBulkZip('court_postpone', [])).rejects.toThrow('Qatorlar')
    await expect(generateBulkZip('court_postpone', Array.from({ length: MAX_BULK_ROWS + 1 }, () => ({})))).rejects.toThrow(String(MAX_BULK_ROWS))
  })
  test('an unknown document is refused', async () => {
    await expect(generateBulkZip('nope', [{}])).rejects.toThrow()
  })
})
