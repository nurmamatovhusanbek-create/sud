import { afterAll, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

mock.module('server-only', () => ({}))
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-hid-'))
process.env.PUBLIC_ORDERS_DIR = dir
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('hidden store', () => {
  test('hide, restore, and the file on disk', async () => {
    const { readHidden, setHidden } = await import('../hidden-store')
    expect((await setHidden('hide', [A, B.toUpperCase(), 'not-an-id', '../../x'])).changed).toBe(2)
    expect([...(await readHidden())].sort()).toEqual([A, B])
    expect((await setHidden('hide', [A])).changed).toBe(0) // idempotent
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'hidden.json'), 'utf8')).ids.sort()).toEqual([A, B])
    expect((await setHidden('restore', [A])).changed).toBe(1)
    expect([...(await readHidden())]).toEqual([B])
  })
  test('a damaged file means nothing is cleared, not a crash', async () => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-hid2-'))
    process.env.PUBLIC_ORDERS_DIR = d2
    fs.writeFileSync(path.join(d2, 'hidden.json'), '{broken')
    const { readHidden } = await import('../hidden-store')
    expect((await readHidden()).size).toBe(0)
    fs.rmSync(d2, { recursive: true, force: true })
    process.env.PUBLIC_ORDERS_DIR = dir
  })
})

describe('POST /api/public-orders/hidden and the library it feeds', () => {
  const call = async (body: unknown, headers: Record<string, string> = {}) => {
    const { POST } = await import('@/app/api/public-orders/hidden/route')
    return POST(new Request('http://localhost:3000/api/public-orders/hidden', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { host: 'localhost:3000', 'content-type': 'application/json', ...headers } }) as never)
  }
  test('validates the action and the ids, and refuses a page on another site', async () => {
    expect((await call({ action: 'nuke', ids: [] })).status).toBe(400)
    expect((await call('not json')).status).toBe(400)
    expect((await call({ action: 'hide', ids: [A] }, { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })).status).toBe(403)
    const ok = await call({ action: 'hide', ids: [A, 'junk'] })
    expect(ok.status).toBe(200)
    expect((await ok.json()).ok).toBe(true)
  })
})
