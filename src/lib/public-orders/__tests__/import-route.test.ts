import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

mock.module('server-only', () => ({}))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-import-'))
process.env.PUBLIC_ORDERS_DIR = dir
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const ID = '86db779e-9ba9-41c3-8d1a-15e9ef0a5dfb'
const PDF = Buffer.from('%PDF-1.4 order')
let POST: (req: Request) => Promise<Response>
beforeAll(async () => {
  POST = (await import('@/app/api/public-orders/import/route')).POST as never
})

const call = (id: string, body: BodyInit | null, headers: Record<string, string> = {}) =>
  POST(new Request(`http://localhost:3000/api/public-orders/import?id=${id}`, { method: 'POST', body, headers: { host: 'localhost:3000', ...headers } }))

describe('POST /api/public-orders/import', () => {
  test('stores a real PDF under the order id, and the loader then serves it from disk', async () => {
    const r = await call(ID, PDF)
    expect(r.status).toBe(200)
    expect((await r.json()).data).toMatchObject({ id: ID, size: PDF.length })
    const { readPdf } = await import('../pdf-store')
    expect(Buffer.from((await readPdf(ID))!).toString()).toBe('%PDF-1.4 order')
  })
  test('refuses an id that is not a uuid (nothing is written under a made-up name)', async () => {
    expect((await call('../../etc/passwd', PDF)).status).toBe(400)
  })
  test('refuses a file that is not a PDF, and an empty body', async () => {
    const html = await call('11111111-1111-1111-1111-111111111111', Buffer.from('<html>403</html>'))
    expect(html.status).toBe(422)
    expect((await html.json()).code).toBe('not_pdf')
    expect((await call('11111111-1111-1111-1111-111111111111', null)).status).toBe(400)
    expect(fs.existsSync(path.join(dir, 'files', '11111111-1111-1111-1111-111111111111.pdf'))).toBe(false)
  })
  test('a page on another site cannot hand files to the app (guard: cross-site)', async () => {
    const r = await call(ID, PDF, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })
    expect(r.status).toBe(403)
  })
  test('the cap is above the global 8 MB: a 12 MB order is accepted', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(12 * 1024 * 1024)])
    const r = await call('22222222-2222-2222-2222-222222222222', big, { 'content-length': String(big.length) })
    expect(r.status).toBe(200)
  })
})
