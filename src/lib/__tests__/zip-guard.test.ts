import { describe, expect, test } from 'bun:test'
import JSZip from 'jszip'
import { assertZipBounded, ZipTooLargeError } from '../zip-guard'
import { escapeXml } from '../documents/fill.shared'
import { readFirstSheet } from '../xlsx-grid'

/** Make the entries named like `pattern` declare an «uncompressed size» of `claim` (local header + central directory): the lie a zip bomb tells. */
function lieAboutSizes(buf: Uint8Array, claim: number, pattern = /document\.xml$|sheet1\.xml$/): Uint8Array {
  const b = Buffer.from(buf)
  const nameAt = (at: number, len: number) => b.subarray(at, at + len).toString('latin1')
  for (let i = 0; i + 46 < b.length; i++) {
    if (b.readUInt32LE(i) === 0x04034b50 && pattern.test(nameAt(i + 30, b.readUInt16LE(i + 26)))) b.writeUInt32LE(claim, i + 22) // local header
    if (b.readUInt32LE(i) === 0x02014b50 && pattern.test(nameAt(i + 46, b.readUInt16LE(i + 28)))) b.writeUInt32LE(claim, i + 24) // central directory
  }
  return new Uint8Array(b)
}

async function bomb(inflatedMB: number, claim = 200): Promise<Uint8Array> {
  const z = new JSZip()
  z.file('[Content_Types].xml', '<Types/>')
  z.file('word/document.xml', 'A'.repeat(1024 * 1024).repeat(inflatedMB))
  return lieAboutSizes(await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } }), claim)
}

describe('assertZipBounded (a zip that lies about its size)', () => {
  test('a bomb declaring 200 bytes but inflating to 90 MB is stopped at the limit, fast, without inflating it all', async () => {
    const data = await bomb(90)
    expect(data.length).toBeLessThan(200_000) // tiny on the wire
    const zip = await JSZip.loadAsync(data)
    const before = process.memoryUsage().rss
    const t0 = Date.now()
    await expect(assertZipBounded(zip, { maxEntries: 100, maxTotal: 10 * 1024 * 1024 })).rejects.toBeInstanceOf(ZipTooLargeError)
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(process.memoryUsage().rss - before).toBeLessThan(80 * 1024 * 1024) // it did not hold the 90 MB
  })
  test('an honest zip inside the limit passes, however many entries it has', async () => {
    const z = new JSZip()
    for (let i = 0; i < 50; i++) z.file(`f${i}.txt`, 'hello '.repeat(100))
    const zip = await JSZip.loadAsync(await z.generateAsync({ type: 'uint8array' }))
    await assertZipBounded(zip, { maxEntries: 100, maxTotal: 1024 * 1024 })
  })
  test('too many entries is refused before anything is inflated', async () => {
    const z = new JSZip()
    for (let i = 0; i < 30; i++) z.file(`f${i}.txt`, 'x')
    const zip = await JSZip.loadAsync(await z.generateAsync({ type: 'uint8array' }))
    await expect(assertZipBounded(zip, { maxEntries: 10, maxTotal: 1e9 })).rejects.toBeInstanceOf(ZipTooLargeError)
  })
  test('the total counts across entries (many medium files add up)', async () => {
    const z = new JSZip()
    for (let i = 0; i < 6; i++) z.file(`m${i}.bin`, 'B'.repeat(2 * 1024 * 1024))
    const zip = await JSZip.loadAsync(await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))
    await expect(assertZipBounded(zip, { maxEntries: 100, maxTotal: 8 * 1024 * 1024 })).rejects.toBeInstanceOf(ZipTooLargeError)
  })
})

describe('readFirstSheet with a hostile spreadsheet', () => {
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row></sheetData></worksheet>'
  const wbWith = (id: string) => `<workbook><sheets><sheet name="S" sheetId="1" r:id="${id}"/></sheets></workbook>`
  async function xlsx(id: string, rels: string): Promise<Uint8Array> {
    const z = new JSZip()
    z.file('xl/workbook.xml', wbWith(id))
    z.file('xl/_rels/workbook.xml.rels', rels)
    z.file('xl/worksheets/sheet1.xml', sheet)
    return z.generateAsync({ type: 'uint8array' })
  }
  test('a regex-looking r:id is only ever a literal: no hang, no crash', async () => {
    for (const id of ['(a+)+$', '[', '.*', '\\', 'a{1,', '(?<x>']) {
      const t0 = Date.now()
      const g = await readFirstSheet(await xlsx(id, `<Relationships><Relationship Id="${'a'.repeat(40)}!" Target="worksheets/sheet1.xml"/></Relationships>`))
      expect(Date.now() - t0).toBeLessThan(500)
      expect(g).toBeTruthy()
    }
  })
  test('a zip bomb posing as a spreadsheet is refused', async () => {
    const z = new JSZip()
    z.file('xl/workbook.xml', '<workbook/>')
    z.file('xl/worksheets/sheet1.xml', 'A'.repeat(1024 * 1024).repeat(160))
    const lied = lieAboutSizes(await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 } }), 100)
    await expect(readFirstSheet(lied)).rejects.toBeInstanceOf(ZipTooLargeError)
  })
})

describe('XML values: characters XML 1.0 forbids are dropped (they would make Word refuse the document)', () => {
  test('control characters vanish, text and markup escaping are unchanged', () => {
    expect(escapeXml('a\u0000b\u0008c\u001fd￾e')).toBe('abcde')
    expect(escapeXml('tab\there\nline\r')).toBe('tab\there\nline\r') // legal whitespace stays
    expect(escapeXml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;')
  })
})
