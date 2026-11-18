import { afterAll, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { extractOrdersFromHar, NotHarError, orderIdFromFileUrl } from '../har-import'

mock.module('server-only', () => ({}))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-har-'))
process.env.PUBLIC_ORDERS_DIR = dir
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const ID = 'f800da21-5c3f-44f5-87d6-fba366ed4209'
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 0x41), Buffer.from('\n%%EOF')])
const envelope = (pdf: Buffer, name = 'order.pdf') =>
  Buffer.concat([
    Buffer.from(`--XYZ\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\nContent-Length: ${pdf.length}\r\n\r\n`),
    pdf,
    Buffer.from('\r\n--XYZ--\r\n'),
  ])
const har = (entries: unknown[]) => Buffer.from(JSON.stringify({ log: { version: '1.2', entries } }))
const entry = (url: string, body: Buffer | string | null, encoding: string | null = 'base64') => ({
  request: { method: 'GET', url, headers: [{ name: 'Cookie', value: 'SECRET-COOKIE' }] },
  response: { status: 200, content: body === null ? { size: 1 } : { text: typeof body === 'string' ? body : body.toString('base64'), ...(encoding ? { encoding } : {}) } },
})
const FILE_URL = `https://adolatapi1.sud.uz/public/onStream/${ID}?recaptcha_token=eyJSECRET.TOKEN`

describe('orderIdFromFileUrl', () => {
  test('reads the id from the path only, for the library file and the pre-2024 files', () => {
    expect(orderIdFromFileUrl(FILE_URL)).toBe(ID)
    expect(orderIdFromFileUrl('https://adolatapi1.sud.uz/publication-proxy/api/file/download/12345/')).toBe('old-economic-12345')
    expect(orderIdFromFileUrl('https://adolatapi1.sud.uz/publication-proxy/api/file/civil/777/')).toBe('old-civil-777')
    expect(orderIdFromFileUrl('https://adolatapi1.sud.uz/publication-proxy/api/file/criminal/9/')).toBe('old-criminal-9')
    expect(orderIdFromFileUrl('https://adolatapi1.sud.uz/publication-proxy/api/file/administrative/55/17')).toBe('old-administrative-55')
    expect(orderIdFromFileUrl('https://adolatapi1.sud.uz/publication-proxy/api/file/administrative/55/4')).toBe('old-administrative-55-4')
  })
  test('anything else is not an order file: other requests, other hosts, lookalikes', () => {
    for (const u of [
      'https://public.sud.uz/assets/i18n/uz.json',
      'https://adolatapi1.sud.uz/publications/list?size=30',
      `https://evil.example/public/onStream/${ID}`,
      `https://adolatapi1.sud.uz/public/onStream/${ID}/../x`,
      'https://adolatapi1.sud.uz/public/onStream/not-a-uuid',
      'not a url',
    ]) expect(orderIdFromFileUrl(u)).toBeNull()
  })
})

describe('extractOrdersFromHar', () => {
  test('takes the PDF out of the site envelope, under the id in the request path', () => {
    const r = extractOrdersFromHar(har([entry('https://public.sud.uz/assets/x.svg', 'x', null), entry(FILE_URL, envelope(PDF, 'qaror.pdf'))]))
    expect(r.files).toHaveLength(1)
    expect(r.files[0].id).toBe(ID)
    expect(r.files[0].filename).toBe('qaror.pdf')
    expect(Buffer.from(r.files[0].bytes).equals(PDF)).toBe(true)
  })
  test('a plain (not enveloped) PDF body works too', () => {
    expect(extractOrdersFromHar(har([entry(FILE_URL, PDF)])).files).toHaveLength(1)
  })
  test('the same order twice keeps the bigger file; an error page is skipped, not fatal', () => {
    const small = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10, 0x42)])
    const r = extractOrdersFromHar(har([entry(FILE_URL, small), entry(FILE_URL, '<html>403</html>', null), entry(FILE_URL, PDF)]))
    expect(r.files).toHaveLength(1)
    expect(r.files[0].bytes.length).toBe(PDF.length)
    expect(r.seen).toBe(3)
  })
  test('a HAR saved without content is reported, not mistaken for an empty one', () => {
    const r = extractOrdersFromHar(har([entry(FILE_URL, null)]))
    expect(r.files).toHaveLength(0)
    expect(r.noContent).toBe(1)
  })
  test('not a HAR at all', () => {
    expect(() => extractOrdersFromHar(Buffer.from('hello'))).toThrow(NotHarError)
    expect(() => extractOrdersFromHar(Buffer.from('{"log":{}}'))).toThrow(NotHarError)
  })
  test('cookies and the captcha token never reach the result', () => {
    const r = extractOrdersFromHar(har([entry(FILE_URL, envelope(PDF))]))
    const dump = JSON.stringify(r.files.map((f) => ({ id: f.id, filename: f.filename })))
    expect(dump).not.toContain('SECRET')
  })
})

const LIST_URL = 'https://adolatapi1.sud.uz/publications/list?size=30&page=0&court_type=CIVIL&case_number=2-1003-2113%2F20027&instance=FIRST'
const LIST = JSON.stringify({
  content: [
    { id: 'row-1', case_number: '2-1003-2113/20027', instance: 'FIRST', result: 'FULFILLED', court_names: { uz: 'Toshkent sudi' }, responsible_judge_name: 'Sudya', categories: [{ uz: 'Fuqarolik' }], pdf: { id: 'f800da21-5c3f-44f5-87d6-fba366ed4209', name: 'q.pdf', size: 12345 } },
    { id: 'row-2', case_number: '2-1003-2113/20027', instance: 'APPEAL', pdf: { id: '11111111-2222-3333-4444-555555555555', name: 'a.pdf', size: 1 } },
  ],
})

describe('the browser\'s own search answers in the HAR', () => {
  test('the order records come along, so a saved file lands on its card', () => {
    const r = extractOrdersFromHar(har([entry(LIST_URL, LIST, null), entry(FILE_URL, envelope(PDF))]))
    expect(r.orders.map((o) => o.id).sort()).toEqual(['row-1', 'row-2'])
    const o = r.orders.find((x) => x.id === 'row-1')!
    expect(o).toMatchObject({ caseNumber: '2-1003-2113/20027', courtType: 'CIVIL', instance: 'FIRST', pdfId: ID })
    expect(r.files[0].id).toBe(o.pdfId) // the file's id IS the record's pdfId: that is what attaches them
  })
  test('a search answer that is not ours (other host, no court_type, garbage) adds nothing', () => {
    const r = extractOrdersFromHar(
      har([
        entry('https://evil.example/publications/list?court_type=CIVIL', LIST, null),
        entry('https://adolatapi1.sud.uz/publications/list?size=30', LIST, null),
        entry('https://adolatapi1.sud.uz/publications/list?court_type=CIVIL', '{not json', null),
        entry(FILE_URL, envelope(PDF)),
      ]),
    )
    expect(r.orders).toHaveLength(0)
    expect(r.files).toHaveLength(1)
  })
})

describe('POST /api/public-orders/import-har', () => {
  const call = async (body: BodyInit | null, headers: Record<string, string> = {}) => {
    const { POST } = await import('@/app/api/public-orders/import-har/route')
    return POST(new Request('http://localhost:3000/api/public-orders/import-har', { method: 'POST', body, headers: { host: 'localhost:3000', ...headers } }) as never)
  }
  test('stores the order from a HAR on disk', async () => {
    const r = await call(har([entry(FILE_URL, envelope(PDF))]))
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.data.saved[0].id).toBe(ID)
    expect(fs.existsSync(path.join(dir, 'files', `${ID}.pdf`))).toBe(true)
  })
  test('with the search answer in the HAR the order gets a record, and the answer says it matched', async () => {
    const r = await call(har([entry(LIST_URL, LIST, null), entry(FILE_URL, envelope(PDF))]))
    const j = await r.json()
    expect(j.data.matched).toEqual([ID])
    expect(j.data.orders).toBe(2)
    const { allOrders } = await import('@/lib/public-orders/store')
    expect((await allOrders()).some((o) => o.pdfId === ID && o.caseNumber === '2-1003-2113/20027')).toBe(true)
  })
  test('says what is wrong: not a HAR, no order inside, no content saved', async () => {
    expect((await (await call(Buffer.from('nope'))).json()).code).toBe('not_har')
    expect((await (await call(har([entry('https://public.sud.uz/a.json', 'x', null)]))).json()).code).toBe('no_order_file')
    const noContent = await (await call(har([entry(FILE_URL, null)]))).json()
    expect(noContent.code).toBe('no_order_file')
    expect(noContent.error).toContain('with sensitive data')
  })
  test('a page on another site cannot hand files to the app', async () => {
    expect((await call(har([entry(FILE_URL, PDF)]), { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })).status).toBe(403)
  })
})
