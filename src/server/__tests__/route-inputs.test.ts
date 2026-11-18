/**
 * Route parameters that end up inside an upstream URL or a child-process argument must have the expected shape
 * before they get there. Only the refusals are driven here (no network is touched).
 */
import { describe, expect, mock, test } from 'bun:test'
import { NextRequest } from 'next/server'
mock.module('server-only', () => ({}))
const { GET: courtCases } = await import('@/app/api/court-cases/route')
const { GET: ordersGet } = await import('@/app/api/public-orders/orders/route')
const { GET: fileGet } = await import('@/app/api/public-orders/file/route')
const { GET: statsGet } = await import('@/app/api/stats/route')

const get = (handler: (r: NextRequest) => Promise<Response>, path: string) =>
  handler(new NextRequest(`http://localhost:3000${path}`, { headers: { host: 'localhost:3000' } }))

describe('court-cases?detail= (spliced into the upstream URL path)', () => {
  for (const bad of ['../../etc/passwd', '4-1001-2605/14720/../x', '{1,2}', '[1-9999]', '4-1001-2605/14720?x=1', 'a b', '4-1001-2605/14720%00', '', '1'.repeat(500)]) {
    test(`refuses ${JSON.stringify(bad.slice(0, 30))}`, async () => {
      const res = await get(courtCases, `/api/court-cases?courtType=economic&detail=${encodeURIComponent(bad)}`)
      expect(res.status).toBe(400)
    })
  }
})

describe('other shapes', () => {
  test('stats: STIR must be exactly 9 digits', async () => {
    for (const bad of ['1234567890', '12345678', 'abc', '30267882;ls', '../x']) expect((await get(statsGet, `/api/stats?tin=${encodeURIComponent(bad)}`)).status).toBe(400)
  })
  test('orders: only a case number', async () => {
    expect((await get(ordersGet, '/api/public-orders/orders?caseNumber=../../x')).status).toBe(400)
  })
  test('file: only a uuid reaches the upstream', async () => {
    for (const bad of ['../x', 'zzz', '1234', '00000000-0000-0000-0000-00000000000g']) expect((await get(fileGet, `/api/public-orders/file?id=${encodeURIComponent(bad)}`)).status).toBe(400)
  })
})

describe('worker URLs', () => {
  test('a name that does not resolve is refused before it is saved (the address is checked, not just the name)', async () => {
    const { POST } = await import('@/app/api/settings/workers/route')
    const res = await POST(
      new NextRequest('http://localhost:3000/api/settings/workers', {
        method: 'POST',
        headers: { host: 'localhost:3000', 'x-sud-action': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://definitely-not-a-real-worker-xk29.example.invalid' }),
      }),
    )
    expect(res.status).toBe(400)
    expect(['unresolved_host', 'private_host']).toContain((await res.json()).error)
  })
})

describe('public-orders/fetch: only «start» is left', () => {
  const post = async (body: unknown) => {
    const { POST } = await import('@/app/api/public-orders/fetch/route')
    return POST(new NextRequest('http://localhost:3000/api/public-orders/fetch', { method: 'POST', headers: { host: 'localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  }
  for (const action of ['pause', 'resume', 'cancel', 'retry', 'plan', '']) {
    test(`refuses action ${JSON.stringify(action)}`, async () => {
      const res = await post({ action, cases: [{ caseNumber: '4-1001-2601/1', courtType: 'ECONOMIC' }] })
      expect(res.status).toBe(400)
    })
  }
})

describe('public-orders/import-har: too many order files in one HAR', () => {
  test('a HAR with more than MAX_HAR_FILES order files is refused before anything is written', async () => {
    const { POST, MAX_HAR_FILES } = await import('@/app/api/public-orders/import-har/route')
    const b64 = Buffer.from('%PDF-1.4 x').toString('base64')
    const entries = Array.from({ length: MAX_HAR_FILES + 1 }, (_, i) => ({
      request: { url: `https://adolatapi1.sud.uz/public/onStream/${(0x10000000 + i).toString(16)}-2222-4333-8444-555555555555` },
      response: { content: { text: b64, encoding: 'base64' } },
    }))
    const res = await POST(new NextRequest('http://localhost:3000/api/public-orders/import-har', { method: 'POST', headers: { host: 'localhost:3000', 'content-type': 'application/octet-stream' }, body: JSON.stringify({ log: { entries } }) }))
    expect(res.status).toBe(422)
    expect((await res.json()).code).toBe('too_many')
  })
})
