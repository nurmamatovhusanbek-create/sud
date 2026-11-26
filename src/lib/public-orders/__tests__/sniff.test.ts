import { describe, expect, test } from 'bun:test'
import { NotPdfError, pdfFromUpload, sniffBytes } from '../order-pdf'

const b = (s: string | number[]) => (typeof s === 'string' ? Buffer.from(s, 'latin1') : Buffer.from(s))

describe('what a non-PDF answer is', () => {
  test('a Word document, an old Word file, RTF, an image, an archive: real files of another kind (the order exists)', () => {
    expect(sniffBytes(b('PK\x03\x04\x14\x00\x06\x00[Content_Types].xml word/document.xml'))).toMatchObject({ kind: 'docx', document: true })
    expect(sniffBytes(b([0xd0, 0xcf, 0x11, 0xe0, 1, 2]))).toMatchObject({ kind: 'doc', document: true })
    expect(sniffBytes(b('{\\rtf1\\ansi hello'))).toMatchObject({ kind: 'rtf', document: true })
    expect(sniffBytes(b([0x89, 0x50, 0x4e, 0x47, 1]))).toMatchObject({ kind: 'image', document: true })
    expect(sniffBytes(b('PK\x03\x04 nothing word here'))).toMatchObject({ kind: 'zip', document: true })
  })
  test('an error page, a JSON refusal, an empty answer: not an order', () => {
    expect(sniffBytes(b('<!DOCTYPE html><html><body>Web Page Blocked!</body></html>'))).toMatchObject({ kind: 'html', document: false })
    const j = sniffBytes(b('{"message":"Fayl topilmadi"}'))
    expect(j).toMatchObject({ kind: 'json', document: false })
    expect(j.preview).toContain('Fayl topilmadi')
    expect(sniffBytes(new Uint8Array())).toMatchObject({ kind: 'empty', document: false })
  })
  test('the error names what it was, how big, and for a page what it said', () => {
    const e = (() => { try { pdfFromUpload(b('{"message":"Fayl topilmadi"}')) } catch (x) { return x as NotPdfError } return null })()!
    expect(e).toBeInstanceOf(NotPdfError)
    expect(e.message).toContain('JSON javob')
    expect(e.message).toContain('Fayl topilmadi')
    expect(e.what.document).toBe(false)
    const w = (() => { try { pdfFromUpload(b('PK\x03\x04 word/document.xml')) } catch (x) { return x as NotPdfError } return null })()!
    expect(w.message).toContain('Word hujjati')
    expect(w.what.document).toBe(true)
  })
})
