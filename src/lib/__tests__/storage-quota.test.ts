import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

// a localStorage with a hard quota, so the registry's «make room, never lose the watchlist» path is exercised for real
class QuotaStorage {
  private m = new Map<string, string>()
  constructor(public limit: number) {}
  get length() { return this.m.size }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  getItem(k: string) { return this.m.get(k) ?? null }
  removeItem(k: string) { this.m.delete(k) }
  used() { return [...this.m].reduce((a, [k, v]) => a + k.length + v.length, 0) }
  setItem(k: string, v: string) {
    const other = [...this.m].filter(([kk]) => kk !== k).reduce((a, [kk, vv]) => a + kk.length + vv.length, 0)
    if (other + k.length + v.length > this.limit) throw new DOMException('quota', 'QuotaExceededError')
    this.m.set(k, v)
  }
}

const g = globalThis as unknown as { window?: unknown; localStorage?: unknown }
let ls: QuotaStorage
const events: string[] = []

beforeEach(() => {
  ls = new QuotaStorage(6000)
  events.length = 0
  g.localStorage = ls
  g.window = { dispatchEvent: (e: Event) => void events.push(e.type) }
})
afterEach(() => {
  delete g.window
  delete g.localStorage
})

describe('registry vs a full localStorage', () => {
  test('response caches are sacrificed first — the watchlist is saved', async () => {
    const { writeStore } = await import('../registry')
    // fill the quota with cached API responses
    for (let i = 0; i < 5; i++) ls.setItem(`sb-cache-v168:stats:${i}`, JSON.stringify({ data: 'x'.repeat(900), ts: i }))
    writeStore({ '111111111': { stir: '111111111', name: 'A', watched: true, meta: { status: 'Faoliyatda' } } })
    expect(JSON.parse(ls.getItem('sud-registry-v1')!)['111111111'].name).toBe('A')
    expect(events).toContain('sud:registry-changed')
    expect(events).not.toContain('sud:storage-full')
  })

  test('then the case lists of NON-watched companies are dropped, watched ones kept', async () => {
    const { writeStore } = await import('../registry')
    ls.limit = 2500
    const cases = Array.from({ length: 40 }, (_, i) => ({ n: `4-1-2601/${i}`, t: 'economic', r: 'x' }))
    writeStore({
      '111111111': { stir: '111111111', watched: true, meta: { orderCases: cases.slice(0, 5) } },
      '222222222': { stir: '222222222', watched: false, meta: { orderCases: cases, status: 'Faoliyatda' } },
      '333333333': { stir: '333333333', watched: false, meta: { orderCases: cases } },
      '444444444': { stir: '444444444', watched: false, meta: { orderCases: cases } },
    })
    const saved = JSON.parse(ls.getItem('sud-registry-v1')!)
    expect(saved['111111111'].meta.orderCases).toHaveLength(5)
    expect(saved['222222222'].meta.orderCases).toBeUndefined()
    expect(saved['222222222'].meta.status).toBe('Faoliyatda') // the rest of the meta survives
    expect(events).not.toContain('sud:storage-full')
  })

  test('when nothing can be freed it says so (event) instead of failing silently', async () => {
    const { writeStore } = await import('../registry')
    ls.limit = 50
    writeStore({ '111111111': { stir: '111111111', name: 'x'.repeat(200), watched: true } })
    expect(events).toContain('sud:storage-full')
    expect(events).not.toContain('sud:registry-changed')
  })
})

describe('response cache', () => {
  test('a write that does not fit evicts the OLDEST entries and succeeds', async () => {
    const { setCached, getCached } = await import('../cache')
    for (let i = 0; i < 5; i++) ls.setItem(`sb-cache-v168:k${i}`, JSON.stringify({ data: 'y'.repeat(1000), ts: 100 + i }))
    setCached('fresh', { big: 'z'.repeat(1500) })
    expect(getCached('fresh')).not.toBeNull()
    expect(ls.getItem('sb-cache-v168:k0')).toBeNull() // oldest went first
    expect(ls.getItem('sb-cache-v168:k4')).not.toBeNull()
  })
})
