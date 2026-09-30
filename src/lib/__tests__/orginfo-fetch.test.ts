import { afterEach, describe, expect, mock, test } from 'bun:test'

// mock.module is process-wide in bun: this is a superset of the mock billing-search.test.ts installs for the same module
mock.module('@/lib/cf-worker-pool', () => ({
  getCfWorkerUrls: () => ['https://w1.example/'],
  createWorkerPool: () => ({ nextProxyUrl: (u: string) => u }),
  OriginHealthPool: class {
    recordSuccess() {}
    recordFailure() {}
  },
}))

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const stub = (impl: (url: string) => Promise<Response>) => {
  globalThis.fetch = ((url: string | URL | Request) => impl(String(url))) as typeof fetch
}
const big = (body: string) => body + ' '.repeat(600) // real pages are large; a tiny body is a stub

const { getCompanyByTin } = await import('../orginfo')

describe('orginfo fetching — a failed fetch is an error, never «company not found»', () => {
  test('HTTP failure / timeout / stub body all THROW with the reason', async () => {
    stub(async () => new Response('nope', { status: 503 }))
    await expect(getCompanyByTin('111111111')).rejects.toThrow(/orginfo\.uz javob bermadi \(HTTP 503\)/)

    stub(async () => new Response('<html></html>', { status: 200 })) // a block / worker error page
    await expect(getCompanyByTin('111111112')).rejects.toThrow(/boʻsh javob/)

    stub(async () => {
      throw new Error('fetch failed')
    })
    await expect(getCompanyByTin('111111113')).rejects.toThrow(/fetch failed/)
  })

  test('a page that loaded but lists nobody is «not found» (null), not an error', async () => {
    stub(async () => new Response(big('<html><body>Natija topilmadi</body></html>'), { status: 200 }))
    expect(await getCompanyByTin('111111114')).toBeNull()
  })

  test('a good company page still parses (status, address, director)', async () => {
    const page = big(
      `<html><body><a href="/uz/organization/abc123def456/">X</a>` +
        `<div>STIR</div><div>222222222</div><div>Faollik holati</div><div>Faoliyatda</div>` +
        `<div>Rahbar</div><div>Ali Valiyev</div><div>Официальное название организации</div><div>TEST MCHJ</div></body></html>`,
    )
    stub(async () => new Response(page, { status: 200 }))
    const c = await getCompanyByTin('222222222')
    expect(c).toMatchObject({ tin: '222222222', status: 'Faoliyatda', director: 'Ali Valiyev', officialName: 'TEST MCHJ' })
  })

  test('the worker answers HTTP 500 → the retry goes direct and the profile still loads', async () => {
    const page = big(`<html><body><a href="/uz/organization/abc123def456/">X</a><div>STIR</div><div>333333333</div><div>Faollik holati</div><div>Faoliyatda</div></body></html>`)
    let calls = 0
    stub(async () => (++calls === 1 ? new Response('boom', { status: 500 }) : new Response(page, { status: 200 })))
    const c = await getCompanyByTin('333333333')
    expect(c?.status).toBe('Faoliyatda')
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  test('ORGINFO_DIRECT_FALLBACK=0 keeps every attempt on the workers (no direct request at all)', async () => {
    process.env.ORGINFO_DIRECT_FALLBACK = '0'
    try {
      const urls: string[] = []
      stub(async (u) => {
        urls.push(u)
        return new Response('boom', { status: 500 })
      })
      await expect(getCompanyByTin('444444444')).rejects.toThrow(/HTTP 500/)
      expect(urls.length).toBe(2) // both attempts, none of them skipped or rerouted
    } finally {
      delete process.env.ORGINFO_DIRECT_FALLBACK
    }
  })
})
