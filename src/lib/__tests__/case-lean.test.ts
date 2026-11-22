/**
 * The lean one-case lookup for the bulk fill (court-case getCaseLean): the new system first, the old one only for what the new one does not
 * hold, «not found» believed after two asks of the old one, and a failed request never read as «not found». The network is faked.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('server-only', () => ({}))
const WORKERS = ['https://lean-w1.example/', 'https://lean-w2.example/']
const realPool = { ...(await import('@/lib/cf-worker-pool')) }
mock.module('@/lib/cf-worker-pool', () => ({
  getCfWorkerUrls: () => WORKERS,
  createWorkerPool: () => ({ nextProxyUrl: (u: string) => u }),
  OriginHealthPool: class {
    recordSuccess() {}
    recordFailure() {}
  },
}))

const NUM = '2-1004-2603/8020'
const raw = { casenumber: NUM, region: 'R', court: 'Uchtepa sudi', category: 'Kredit', status_name: 'Якунланган  (Ижро варақа билан)', instance: 'Биринчи инстанция', claiment: 'ALFA BANK', defendant: 'X', reg_date: '01.02.2026', hearing_date: '', hearing_time: '', responsible: 'Karimov', result: 'Даъво қаноатлантирилсин', reviews: [] }

let newSystem: () => Response
let oldSystem: () => Response
let calls: string[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const full = String(input)
  const url = full.slice((WORKERS.find((w) => full.startsWith(w)) ?? '').length)
  if (url.includes('jadvalapi.sud.uz')) { calls.push('new'); return newSystem() }
  if (url.includes('jadval.sud.uz')) { calls.push('old'); return oldSystem() }
  return new Response('[]', { status: 404 })
}) as typeof fetch
afterAll(() => {
  mock.module('@/lib/cf-worker-pool', () => realPool)
  globalThis.fetch = realFetch
})

const { getCaseLean } = await import('../court-case')
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } })
const ask = () => getCaseLean('civil', NUM, { recheckMs: 0 })

beforeEach(() => {
  calls = []
  newSystem = () => json([raw])
  oldSystem = () => json([raw])
})

describe('getCaseLean', () => {
  test('a case the new system holds costs ONE request and the old system is not touched', async () => {
    const r = await ask()
    expect(r.kind).toBe('found')
    if (r.kind === 'found') {
      expect(r.via).toBe('new')
      expect(r.data.general?.caseNumber).toBe(NUM)
      expect(r.row?.caseNumber).toBe(NUM)
    }
    expect(calls).toEqual(['new'])
  })

  test('«400 Bad Request» from the new system means «not here»: the old system is asked', async () => {
    newSystem = () => json({ message: 'Bad Request', statusCode: 400 }, 400)
    const r = await ask()
    expect(r.kind).toBe('found')
    if (r.kind === 'found') expect(r.via).toBe('old')
    expect(calls).toEqual(['new', 'old'])
  })

  test('the old system saying «not found» is asked twice before it is believed', async () => {
    newSystem = () => json({ message: 'Bad Request', statusCode: 400 }, 400)
    oldSystem = () => new Response('Иш топилмади', { status: 200 })
    expect(await ask()).toEqual({ kind: 'absent' })
    expect(calls).toEqual(['new', 'old', 'old'])
  })

  test('…and a case the old system finds on the second ask is found', async () => {
    newSystem = () => json({ message: 'Bad Request', statusCode: 400 }, 400)
    let n = 0
    oldSystem = () => (++n === 1 ? new Response('Иш топилмади', { status: 200 }) : json([raw]))
    const r = await ask()
    expect(r.kind).toBe('found')
    expect(calls).toEqual(['new', 'old', 'old'])
  })

  test('a failing request is an ERROR, never «not found»: HTTP 503 / 429 from the new system stop at once', async () => {
    for (const status of [503, 429, 403]) {
      calls = []
      newSystem = () => new Response('x', { status })
      const r = await ask()
      expect(r.kind).toBe('error')
      expect(calls.filter((c) => c === 'old')).toEqual([])
    }
  })

  test('the old system failing after the new one said «not here» is an error too', async () => {
    newSystem = () => json({ message: 'Bad Request', statusCode: 400 }, 400)
    oldSystem = () => new Response('x', { status: 500 })
    expect((await ask()).kind).toBe('error')
  })

  test('an unreadable answer is an error', async () => {
    newSystem = () => new Response('<html>', { status: 200 })
    expect((await ask()).kind).toBe('error')
  })

  test('a malformed number never reaches the network', async () => {
    const r = await getCaseLean('civil', '../../x')
    expect(r.kind).toBe('error')
    expect(calls).toEqual([])
  })
})
