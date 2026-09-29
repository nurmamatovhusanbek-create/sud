/**
 * The scheduler races a duplicate request through a second worker when the first
 * is slower than `hedgeMs`. That is fine for read-only lookups, but billing's
 * search CONSUMES a single-use captcha token: the duplicate burns it, and its
 * fast "Failed captcha check" can beat the original that was about to succeed.
 * (Every failing search in the field took 1.1–1.7 s, i.e. just over the 900 ms
 * hedge, while the captcha calls that succeeded all took under it.)
 *
 * `worker` pins a call to one worker with no hedging and no failover.
 * The origin is simulated: first use of a token is slow but succeeds; any second
 * use of the same token is rejected immediately.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'

mock.module('server-only', () => ({}))
mock.module('@/lib/cf-worker-pool', () => ({
  getCfWorkerUrls: () => ['https://w1.example/', 'https://w2.example/'],
  OriginHealthPool: class {
    recordSuccess() {}
    recordFailure() {}
  },
}))

const { fetchViaWorkers, pickWorker } = await import('../worker-fetch')

const realFetch = globalThis.fetch
let calls: string[] = []
const used = new Set<string>()

/** slow (1.3 s) first use of a token, instant rejection of any reuse */
function installSingleUseOrigin() {
  calls = []
  used.clear()
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const token = new URL(url.replace(/^https:\/\/w\d\.example\//, '')).searchParams.get('captchaToken') ?? ''
    if (used.has(token)) {
      return new Response(JSON.stringify({ requestStatus: { code: 422, message: 'Failed captcha check' } }), { status: 400 })
    }
    used.add(token)
    await new Promise((r) => setTimeout(r, 1300))
    return new Response(JSON.stringify({ content: [{ number: '1' }], totalElements: 1 }), { status: 200 })
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = realFetch
})

const TARGET = 'https://billing.sud.uz/api/invoice/captcha/search?inn=1&captchaToken=T1'
const HEDGED = { originKey: 'billing.sud.uz', hedgeMs: 900, maxAttempts: 2, timeoutMs: 8000 }

describe('hedging a token-consuming request', () => {
  test('UNPINNED: a slow call is duplicated and the duplicate burns the token (the hazard)', async () => {
    installSingleUseOrigin()
    const res = await fetchViaWorkers(TARGET, HEDGED)
    expect(calls.length).toBe(2) // original + hedged duplicate
    expect(res.status).toBe(400) // the fast rejection won the race
  }, 15_000)

  test('PINNED: sent exactly once, on the requested worker, and it succeeds', async () => {
    installSingleUseOrigin()
    const res = await fetchViaWorkers(TARGET, { ...HEDGED, worker: 'https://w2.example/' })
    expect(calls.length).toBe(1)
    expect(calls[0].startsWith('https://w2.example/')).toBe(true)
    expect(res.status).toBe(200)
  }, 15_000)

  test('an unknown pinned worker is ignored (normal scheduling) instead of failing', async () => {
    installSingleUseOrigin()
    const res = await fetchViaWorkers(TARGET, { ...HEDGED, worker: 'https://gone.example/' })
    expect(res.status === 200 || res.status === 400).toBe(true)
    expect(calls.some((c) => c.startsWith('https://gone.example/'))).toBe(false)
  }, 15_000)
})

describe('pickWorker', () => {
  test('returns a worker from the pool', () => {
    expect(['https://w1.example/', 'https://w2.example/']).toContain(pickWorker()!)
  })

  test('a retried session leaves from a worker it has not used yet', () => {
    const first = pickWorker()!
    const second = pickWorker([first])!
    expect(second).not.toBe(first)
  })

  test('once every worker was tried it still returns one (never undefined)', () => {
    expect(pickWorker(['https://w1.example/', 'https://w2.example/'])).toBeDefined()
  })
})
