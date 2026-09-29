/**
 * billing.sud.uz search — error handling.
 *
 * Reproduces the production failure: the captcha succeeds but the search comes
 * back HTTP 400 with an error body (no bill list). That body used to be returned
 * as if it were a result, and getFullBillData then crashed on
 * `[...search.content]` with "Spread syntax requires ...iterable not be null or
 * undefined" — hiding the real reason from the user.
 *
 * The network layer (fetchViaWorkers) is mocked, so nothing here touches the net.
 */
import { describe, expect, mock, test, beforeEach } from 'bun:test'

type Reply = { status: number; body: unknown }
let searchReply: Reply = { status: 200, body: {} }
let searchCalls = 0

mock.module('../net/worker-fetch', () => ({
  fetchViaWorkers: async (url: string) => {
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (url.includes('/pow/challenge')) return json(200, { challenge: 'abc', difficulty: 1, algorithm: 'sha256', expiresAt: '' })
    if (url.includes('/captcha/analyze')) return json(200, { token: 'tok', score: 1, challengeRequired: false })
    if (url.includes('/captcha/search')) {
      searchCalls++
      return json(searchReply.status, searchReply.body)
    }
    return json(404, {})
  },
}))

const { searchBillsByInn, getFullBillData } = await import('../billing')

const REJECTED: Reply = {
  status: 400,
  body: { requestStatus: { code: 400, message: 'Captcha token is invalid' } },
}

beforeEach(() => {
  searchCalls = 0
})

describe('search rejected with HTTP 400 (error body, no bill list)', () => {
  test('searchBillsByInn throws a clear error carrying the upstream reason', async () => {
    searchReply = REJECTED
    let err: unknown
    try {
      await searchBillsByInn('200248856')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('Captcha token is invalid')
  }, 20_000)

  test('getFullBillData surfaces that error instead of a TypeError from spreading undefined', async () => {
    searchReply = REJECTED
    let err: unknown
    try {
      await getFullBillData('200248856')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(TypeError)
    expect((err as Error).message).not.toContain('Spread syntax')
    expect((err as Error).message).toContain('Captcha token is invalid')
  }, 20_000)

  test('a rejected token is retried with a fresh captcha (3 tries) before giving up', async () => {
    searchReply = REJECTED
    await searchBillsByInn('200248856').catch(() => {})
    expect(searchCalls).toBe(3)
  }, 20_000)
})

describe('legitimate responses are unchanged', () => {
  test('a real empty result (no bills) is returned as empty, not treated as an error', async () => {
    searchReply = { status: 200, body: { content: [], pageNumber: 0, pageSize: 100, totalElements: 0, totalPages: 0, last: true } }
    const r = await searchBillsByInn('200248856')
    expect(r.content).toEqual([])
    expect(r.totalElements).toBe(0)
  }, 20_000)

  test('a real result is returned as soon as it arrives (no extra captchas)', async () => {
    searchReply = {
      status: 200,
      body: { content: [{ number: '2026-1', invoiceStatus: 'PAID', issued: 1 }], pageNumber: 0, pageSize: 100, totalElements: 1, totalPages: 1, last: true },
    }
    const r = await searchBillsByInn('200248856')
    expect(r.totalElements).toBe(1)
    expect(r.content[0].number).toBe('2026-1')
    expect(searchCalls).toBe(1)
  }, 20_000)

  test('a bill-less company: getFullBillData returns zero bills without throwing', async () => {
    searchReply = { status: 200, body: { content: [], pageNumber: 0, pageSize: 100, totalElements: 0, totalPages: 0, last: true } }
    const r = await getFullBillData('200248856')
    expect(r.bills).toEqual([])
    expect(r.totalElements).toBe(0)
  }, 20_000)
})
