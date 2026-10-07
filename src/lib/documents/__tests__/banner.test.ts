/**
 * The letterhead banner touches both page edges and is never stretched, in every template that carries one,
 * whatever picture the owner uploads (wide, tall, square).
 */
import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import JSZip from 'jszip'
import { generateDocx } from '../fill.server'
import { generatePretenzia } from '@/lib/pretenzia/fill.server'
import { fitBannerXml, pngSize, decodePng } from '../banner'

const DIR = path.join(process.cwd(), 'src', 'lib', 'documents', 'templates')
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.docx'))
const load = (buf: Buffer | Uint8Array) => JSZip.loadAsync(buf)

/** a solid-colour PNG of w×h pixels (enough of a PNG for the header + a decoder) */
function png(w: number, h: number): string {
  const crc = (b: Buffer) => {
    let c = ~0
    for (const x of b) {
      c ^= x
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, sum])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x80)
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}

const num = (s: string, re: RegExp) => Number(re.exec(s)?.[1])

describe('banner construction (every shipped template that has one)', () => {
  for (const file of FILES) {
    test(`${file}`, async () => {
      const zip = await load(fs.readFileSync(path.join(DIR, file)))
      if (!zip.file('word/media/image1.png')) return // court_copy / postpone / deadline: no banner
      const doc = await zip.file('word/document.xml')!.async('string')
      const hdr = await zip.file('word/header1.xml')!.async('string')
      const pgW = num(doc, /<w:pgSz\b[^>]*w:w="(\d+)"/)
      const left = num(doc, /<w:pgMar\b[^>]*w:left="(\d+)"/)
      const right = num(doc, /<w:pgMar\b[^>]*w:right="(\d+)"/)

      // inline, exactly one picture, no anchor / wrap / offset left over
      expect(hdr.match(/<w:drawing>/g)).toHaveLength(1)
      expect(hdr).toContain('<wp:inline')
      expect(hdr).not.toMatch(/<wp:anchor|wrapNone|wrapTight|wrapThrough|<wp:positionH/)
      expect(doc).not.toMatch(/<w:drawing|<wp:anchor/)
      // as wide as the page; the paragraph reaches out over both margins
      expect(num(hdr, /<wp:extent\b[^>]*\bcx="(\d+)"/)).toBe(pgW * 635)
      expect(num(hdr, /<w:ind\b[^>]*w:left="(-\d+)"/)).toBe(-left)
      expect(num(hdr, /<w:ind\b[^>]*w:right="(-\d+)"/)).toBe(-right)
      expect(num(doc, /<w:pgMar\b[^>]*w:header="(\d+)"/)).toBe(0)
      // first-page header only
      expect(doc).toContain('<w:titlePg/>')
      expect(doc).toMatch(/<w:headerReference w:type="first" r:id="[^"]+"\/>/)
      expect(doc).not.toMatch(/<w:headerReference w:type="default"/)
      // the picture's box has the proportions of the visible part of the embedded PNG (no stretching)
      const crop = (n: string) => num(hdr, new RegExp(`<a:srcRect\\b[^>]*\\b${n}="(-?\\d+)"`)) || 0
      const visW = 1 - (crop('l') + crop('r')) / 100000
      const visH = 1 - (crop('t') + crop('b')) / 100000
      const img = pngSize(new Uint8Array(await zip.file('word/media/image1.png')!.async('uint8array')))!
      const cx = num(hdr, /<wp:extent\b[^>]*\bcx="(\d+)"/)
      const cy = num(hdr, /<wp:extent\b[^>]*\bcy="(\d+)"/)
      expect(Math.abs(cy / cx - (img.h * visH) / (img.w * visW))).toBeLessThan(0.002)
      expect(num(hdr, /<a:ext\b[^>]*\bcy="(\d+)"/)).toBe(cy)
      // the relationships point at real parts
      const rels = await zip.file('word/_rels/document.xml.rels')!.async('string')
      expect(rels).toMatch(/Id="(rIdBanner|rId\d+)"[^>]*relationships\/header"[^>]*Target="header1\.xml"|Target="header1\.xml"/)
      expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('/word/header1.xml')
    })
  }
})

describe('swapping in a letterhead', () => {
  const values = { full_name: 'Test Person' }
  const cases: [string, number, number][] = [['wide', 1600, 420], ['tall', 1000, 900], ['square', 600, 600], ['strip', 1600, 200]]

  for (const [name, w, h] of cases) {
    test(`${name} ${w}×${h}: full page width, the picture's own height`, async () => {
      for (const id of ['visa1_invitation', 'visa2_kafolat', 'visa3_talabnoma', 'iio1_kafolat', 'iio2_royxat']) {
        const out = await generateDocx(id, values, { letterhead: png(w, h), blankIfNone: true })
        const zip = await load(out.buffer)
        const hdr = await zip.file('word/header1.xml')!.async('string')
        const cx = num(hdr, /<wp:extent\b[^>]*\bcx="(\d+)"/)
        const cy = num(hdr, /<wp:extent\b[^>]*\bcy="(\d+)"/)
        expect(cx, id).toBeGreaterThan(7_500_000) // the whole A4 width
        expect(Math.abs(cy / cx - h / w), id).toBeLessThan(0.002)
        expect(num(hdr, /<a:ext\b[^>]*\bcy="(\d+)"/), id).toBe(cy)
        const media = await zip.file('word/media/image1.png')!.async('uint8array')
        expect(pngSize(media), id).toEqual({ w, h })
      }
    })
  }

  test('no letterhead + blank: the banner keeps its template size (the space stays), no branding', async () => {
    const tpl = await load(fs.readFileSync(path.join(DIR, 'visa2_kafolat.docx')))
    const before = await tpl.file('word/header1.xml')!.async('string')
    const out = await load((await generateDocx('visa2_kafolat', values, { blankIfNone: true })).buffer)
    expect(await out.file('word/header1.xml')!.async('string')).toBe(before)
    expect(pngSize(await out.file('word/media/image1.png')!.async('uint8array'))).toEqual({ w: 1, h: 1 })
  })

  test('no letterhead, no blank (court petitions): the embedded banner is left alone', async () => {
    const tpl = await load(fs.readFileSync(path.join(DIR, 'court_cancel.docx')))
    const out = await load((await generateDocx('court_cancel', values)).buffer)
    expect(await out.file('word/media/image1.png')!.async('uint8array')).toEqual(await tpl.file('word/media/image1.png')!.async('uint8array'))
    expect(await out.file('word/header1.xml')!.async('string')).toBe(await tpl.file('word/header1.xml')!.async('string'))
  })

  test('a file that is not a PNG is ignored', async () => {
    const tpl = await load(fs.readFileSync(path.join(DIR, 'visa2_kafolat.docx')))
    const out = await load((await generateDocx('visa2_kafolat', values, { letterhead: Buffer.from('not a png at all, just text').toString('base64') })).buffer)
    expect(await out.file('word/header1.xml')!.async('string')).toBe(await tpl.file('word/header1.xml')!.async('string'))
  })

  test('the talabnoma / pretenziya letters fit the same way', async () => {
    const k = { creditorName: 'A', debtorName: 'B', debtorAddress: 'C', courtName: 'D', director: 'E', executor: 'F', executorPhone: '1', claimDate: new Date('2026-10-07') }
    const c = { no: '1', date: new Date('2026-01-01'), mainDebtTiyin: 100_000_00, paymentTiyin: 0, delayStart: new Date('2026-02-01') }
    for (const lang of ['ru', 'uz'] as const) {
      const out = await generatePretenzia([c], { ...k, lang }, { letterhead: png(1600, 420) })
      const hdr = await (await load(out.buffer)).file('word/header1.xml')!.async('string')
      expect(Math.abs(num(hdr, /<wp:extent\b[^>]*\bcy="(\d+)"/) / num(hdr, /<wp:extent\b[^>]*\bcx="(\d+)"/) - 420 / 1600)).toBeLessThan(0.002)
    }
  })
})

describe('helpers', () => {
  test('pngSize reads the header; decodePng accepts data-URLs and rejects the rest', () => {
    expect(pngSize(decodePng('data:image/png;base64,' + png(30, 20))!)).toEqual({ w: 30, h: 20 })
    expect(decodePng(undefined)).toBeNull()
    expect(decodePng('!!!')).toBeNull()
    expect(decodePng(Buffer.from('GIF89a'.padEnd(40, 'x')).toString('base64'))).toBeNull()
  })

  test('fitBannerXml leaves xml without a banner alone and drops a crop', () => {
    expect(fitBannerXml('<w:hdr/>', { w: 1, h: 1 })).toBe('<w:hdr/>')
    const x = '<wp:extent cx="1000" cy="10"/><a:srcRect l="10"/><a:ext cx="1000" cy="10"/>'
    expect(fitBannerXml(x, { w: 4, h: 1 })).toBe('<wp:extent cx="1000" cy="250"/><a:ext cx="1000" cy="250"/>')
  })
})
