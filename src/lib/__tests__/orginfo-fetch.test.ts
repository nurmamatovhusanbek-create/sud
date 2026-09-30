import { afterEach, describe, expect, test } from 'bun:test'
import { getCompanyByTin } from '../orginfo'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const stub = (impl: (url: string) => Promise<Response>) => {
  globalThis.fetch = ((url: string | URL | Request) => impl(String(url))) as typeof fetch
}
const big = (body: string) => body + ' '.repeat(600) // real pages are large; a tiny body is a stub

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
})
