/**
 * Two reported bugs: the home / watchlist cards never learned a company's NAME (they stayed «STIR …» although the
 * stats had it) and its chamber RATING (it stayed stale or empty after a refresh or a first open).
 *   - the registry now takes name, status and rating from EVERY answer (also a partial one: they come from orginfo /
 *     chamber, not from the courts) and never overwrites a known value with an absent one;
 *   - a chamber call that FAILED is told apart from «chamber has no rating», so a stats / info answer without a
 *     rating because of a failure is not kept for a day.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// ---- the registry in a fake browser --------------------------------------------------------------------------------
class Mem {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, v) }
  removeItem(k: string) { this.m.delete(k) }
}
const g = globalThis as unknown as { window?: unknown; localStorage?: unknown }
const events: string[] = []
beforeEach(() => {
  events.length = 0
  g.localStorage = new Mem()
  g.window = { dispatchEvent: (e: Event) => void events.push(e.type) }
})
afterEach(() => {
  delete g.window
  delete g.localStorage
})

const registry = await import('../registry')
const read = (stir: string) => JSON.parse((g.localStorage as Mem).getItem('sud-registry-v1')!)[stir]

describe('companyFactsPatch', () => {
  test('the name, status and rating of a stats answer', () => {
    const p = registry.companyFactsPatch({ company: { name: 'PROCAB', shortName: 'PROCAB MCHJ', status: 'Faoliyatda' }, rating: { category: 'BBB', score: 61 } })
    expect(p).toEqual({ name: 'PROCAB MCHJ', meta: { status: 'Faoliyatda', rating: 'BBB', score: 61, ratingAt: 0 } })
  })
  test('the «STIR …» placeholder is no name', () => {
    expect(registry.companyFactsPatch({ company: { name: 'STIR 302121267' } })).toEqual({ meta: {} })
    expect(registry.isRealName('STIR 302121267')).toBe(false)
    expect(registry.isRealName('STIR')).toBe(false)
    expect(registry.isRealName('Stirling Group')).toBe(true)
  })
  test('«no category» (chamber answers «-» / 0) is no rating, so it cannot replace a known one', () => {
    expect(registry.companyFactsPatch({ company: { name: 'A B' }, rating: { category: '-', score: 0 } }).meta).toEqual({})
    expect(registry.companyFactsPatch({ company: { name: 'A B' }, rating: null }).meta).toEqual({})
  })
  test('a score that is not a number is left out', () => {
    expect(registry.companyFactsPatch({ rating: { category: 'A', score: 'x' } }).meta).toEqual({ rating: 'A', ratingAt: 0 })
  })
})

describe('patchRecord', () => {
  const seed = () => registry.upsertRegistry('302121267') // a company added by STIR alone: no name yet

  test('a company opened by STIR gets its name and rating when the stats land', () => {
    seed()
    expect(read('302121267').name).toBeUndefined()
    const f = registry.companyFactsPatch({ company: { name: 'PROCAB MCHJ', status: 'Faoliyatda' }, rating: { category: 'A', score: 80 } })
    registry.patchRecord('302121267', { name: f.name, meta: f.meta })
    const r = read('302121267')
    expect(r.name).toBe('PROCAB MCHJ')
    expect(r.meta).toMatchObject({ status: 'Faoliyatda', rating: 'A', score: 80 })
    expect(events).toContain('sud:registry-changed')
  })
  test('a refreshed rating replaces the old one; an answer without one keeps it', () => {
    seed()
    registry.patchRecord('302121267', { meta: { rating: 'B', score: 40 } })
    registry.patchRecord('302121267', { meta: registry.companyFactsPatch({ company: { name: 'X Y' }, rating: { category: 'BBB', score: 62 } }).meta })
    expect(read('302121267').meta).toMatchObject({ rating: 'BBB', score: 62 })
    registry.patchRecord('302121267', { meta: registry.companyFactsPatch({ company: { name: 'X Y' }, rating: null }).meta }) // chamber failed this time
    expect(read('302121267').meta).toMatchObject({ rating: 'BBB', score: 62 })
  })
  test('an OLDER reading cannot roll a fresher rating back (the reported bug: the fast chamber rating was replaced a moment later by the day-old snapshot of the stats)', () => {
    seed()
    const day = 24 * 3600_000
    const now = Date.now()
    // the fast chamber read lands first
    registry.patchRecord('302121267', { meta: registry.companyFactsPatch({ rating: { category: 'BBB', score: 62 } }, now).meta })
    // …then the stats arrive, served from a snapshot taken yesterday, with yesterday's rating
    registry.patchRecord('302121267', { name: 'PROCAB MCHJ', meta: registry.companyFactsPatch({ company: { name: 'PROCAB MCHJ', status: 'Faoliyatda' }, rating: { category: 'D', score: 10 } }, now - day).meta })
    const r = read('302121267')
    expect(r.meta).toMatchObject({ rating: 'BBB', score: 62, ratingAt: now }) // the rating stays
    expect(r).toMatchObject({ name: 'PROCAB MCHJ' }) // …while the rest of that answer (name, status) is still taken
    expect(r.meta.status).toBe('Faoliyatda')
  })
  test('a NEWER or equal reading replaces it (a forced scrape, a later refresh); an unknown time loses to a known one', () => {
    seed()
    const now = Date.now()
    registry.patchRecord('302121267', { meta: registry.companyFactsPatch({ rating: { category: 'B', score: 40 } }, now).meta })
    registry.patchRecord('302121267', { meta: registry.companyFactsPatch({ rating: { category: 'A', score: 80 } }, now + 1000).meta })
    expect(read('302121267').meta).toMatchObject({ rating: 'A', score: 80 })
    registry.patchRecord('302121267', { meta: registry.companyFactsPatch({ rating: { category: 'A', score: 81 } }, now + 1000).meta })
    expect(read('302121267').meta.score).toBe(81)
    registry.patchRecord('302121267', { meta: registry.companyFactsPatch({ rating: { category: 'D', score: 5 } }).meta }) // no time
    expect(read('302121267').meta).toMatchObject({ rating: 'A', score: 81 })
  })
  test('a record that holds no reading yet takes whatever comes (also an answer with no time)', () => {
    seed()
    registry.patchRecord('302121267', { meta: registry.companyFactsPatch({ rating: { category: 'C', score: 20 } }).meta })
    expect(read('302121267').meta).toMatchObject({ rating: 'C', score: 20 })
  })
  test('nothing new, nothing written (no event storm on every re-open)', () => {
    seed()
    registry.patchRecord('302121267', { name: 'PROCAB MCHJ', meta: { rating: 'A' } })
    events.length = 0
    registry.patchRecord('302121267', { name: 'PROCAB MCHJ', meta: { rating: 'A' } })
    expect(events).toEqual([])
  })
  test('a company that is not in the registry is not created by a late answer', () => {
    registry.patchRecord('999999999', { name: 'Nobody', meta: { rating: 'A' } })
    expect((g.localStorage as Mem).getItem('sud-registry-v1')).toBeNull()
  })
})

// ---- chamber: «failed» vs «none» ------------------------------------------------------------------------------------
mock.module('server-only', () => ({}))
// bun's mock.module is process-wide, and the scheduler keeps per-worker failure state: unique worker URLs, and the real
// pool is put back when this file is done
const realPool = { ...(await import('@/lib/cf-worker-pool')) }
const WORKERS = ['https://chamber-w1.example/', 'https://chamber-w2.example/']
mock.module('@/lib/cf-worker-pool', () => ({
  getCfWorkerUrls: () => WORKERS,
  createWorkerPool: () => ({ nextProxyUrl: (u: string) => u }),
  OriginHealthPool: class {
    recordSuccess() {}
    recordFailure() {}
  },
}))
type Reply = { status: number; body?: unknown } | 'throw'
let reply: Reply = { status: 200, body: {} }
const realFetch = globalThis.fetch
globalThis.fetch = (async () => {
  if (reply === 'throw') throw new Error('network down')
  return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { 'Content-Type': 'application/json' } })
}) as unknown as typeof fetch
afterAll(() => {
  globalThis.fetch = realFetch
  mock.module('@/lib/cf-worker-pool', () => realPool)
})

describe('chamber rating: failed vs none', () => {
  const TIN = '302121267'
  const found = { tin: TIN, name: 'PROCAB', criteriaAll: 71, type: 'BBB' }

  test('a rating comes back with failed: false', async () => {
    const { getCompanyRatingDetailed } = await import('../chamber')
    reply = { status: 200, body: found }
    const r = await getCompanyRatingDetailed(TIN)
    expect(r.failed).toBe(false)
    expect(r.rating).toMatchObject({ type: 'BBB', criteriaAll: 71 })
  })
  test('chamber answering «nothing for this company» is NOT a failure', async () => {
    const { getCompanyRatingDetailed } = await import('../chamber')
    reply = { status: 200, body: {} }
    expect(await getCompanyRatingDetailed(TIN)).toEqual({ rating: null, failed: false })
    reply = { status: 404, body: {} }
    expect(await getCompanyRatingDetailed(TIN)).toEqual({ rating: null, failed: false })
  })
  test('an unreachable / erroring source IS a failure (the rating is unknown, not absent)', async () => {
    const { getCompanyRatingDetailed } = await import('../chamber')
    reply = 'throw'
    expect(await getCompanyRatingDetailed(TIN)).toEqual({ rating: null, failed: true })
    reply = { status: 500, body: {} }
    expect((await getCompanyRatingDetailed(TIN)).failed).toBe(true)
  })
  test('getCompanyRating still answers null in both cases (existing callers)', async () => {
    const { getCompanyRating } = await import('../chamber')
    reply = { status: 200, body: {} }
    expect(await getCompanyRating(TIN)).toBeNull()
  })
})

// ---- the quick rating (its own request, not the stats) ----------------------------------------------------------------
describe('quick rating', () => {
  const TIN = '302121267'
  const found = { tin: TIN, name: 'PROCAB', criteriaAll: 71, type: 'BBB' }
  let calls = 0
  const countingFetch = globalThis.fetch
  beforeEach(async () => {
    const { __resetRatingCacheForTests } = await import('../rating-service')
    __resetRatingCacheForTests()
    calls = 0
    globalThis.fetch = (async (...a: Parameters<typeof fetch>) => {
      calls++
      return (countingFetch as typeof fetch)(...a)
    }) as unknown as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = countingFetch
  })

  test('category, score and chamber name; asked once within the cache window', async () => {
    const { getQuickRating } = await import('../rating-service')
    reply = { status: 200, body: found }
    const a = await getQuickRating(TIN)
    expect(a).toEqual({ category: 'BBB', score: 71, name: 'PROCAB', failed: false })
    const before = calls
    expect(await getQuickRating(TIN)).toEqual(a)
    expect(calls).toBe(before) // the second read came from memory
  })
  test('force asks again', async () => {
    const { getQuickRating } = await import('../rating-service')
    reply = { status: 200, body: found }
    await getQuickRating(TIN)
    const before = calls
    reply = { status: 200, body: { ...found, type: 'A', criteriaAll: 80 } }
    expect((await getQuickRating(TIN, { force: true })).category).toBe('A')
    expect(calls).toBeGreaterThan(before)
  })
  test('a failure is reported and NEVER remembered: the next call asks again and can succeed', async () => {
    const { getQuickRating } = await import('../rating-service')
    reply = 'throw'
    expect(await getQuickRating(TIN)).toMatchObject({ category: null, failed: true })
    reply = { status: 200, body: found }
    expect(await getQuickRating(TIN)).toMatchObject({ category: 'BBB', failed: false })
  })
  test('chamber has no rating for the company: category null, not a failure', async () => {
    const { getQuickRating } = await import('../rating-service')
    reply = { status: 200, body: {} }
    expect(await getQuickRating(TIN)).toEqual({ category: null, score: null, name: '', failed: false })
  })
  test('«-» is no category', async () => {
    const { getQuickRating } = await import('../rating-service')
    reply = { status: 200, body: { tin: TIN, name: 'X Y', criteriaAll: 0, type: '-' } }
    expect(await getQuickRating(TIN)).toMatchObject({ category: null, score: null, name: 'X Y' })
  })
})
