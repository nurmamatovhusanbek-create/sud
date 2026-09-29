import { describe, expect, test } from 'bun:test'
import { runCrawl, type CrawlDeps } from '../engine'
import { emptyProgress, type CrawlState } from '../types'
import type { ListParams } from '../source'
import type { RawPublication } from '@/core/public-orders'

/** A fake library: rows per day per court type, served in pages like the real API. */
function fake(days: Record<string, number>, opts: { today?: string; failOn?: (p: ListParams) => boolean; totalLies?: boolean } = {}) {
  const calls: ListParams[] = []
  const saved: CrawlState[] = []
  const stored: string[] = []
  let state: CrawlState = { version: 1, updatedAt: '', types: {} }
  const deps: CrawlDeps = {
    async listPage(p) {
      calls.push(p)
      if (opts.failOn?.(p)) throw new Error('boom')
      const n = days[p.startDate] ?? 0
      const from = p.page * (p.size ?? 100)
      const rows: RawPublication[] = Array.from({ length: Math.max(0, Math.min(p.size ?? 100, n - from)) }, (_, i) => ({
        id: `${p.courtType}-${p.startDate}-${from + i}`,
        case_number: `4-1-${p.startDate}/${from + i}`,
        instance: 'FIRST',
        result: 'FULFILLED',
      }))
      return { rows, total: n === 0 ? null : opts.totalLies ? n + 1 : n }
    },
    async append(o) {
      stored.push(...o.map((x) => x.id))
    },
    async load() {
      return structuredClone(state)
    },
    async save(s) {
      state = structuredClone(s)
      saved.push(structuredClone(s))
    },
    today: () => opts.today ?? '2026-06-10',
    sleep: async () => {},
  }
  return { deps, calls, stored, saved, get state() { return state }, set state(s: CrawlState) { state = s } }
}

const run = (f: ReturnType<typeof fake>, o: Partial<Parameters<typeof runCrawl>[1]> = {}) =>
  runCrawl(f.deps, { courtTypes: ['ECONOMIC'], signal: new AbortController().signal, emptyLimit: 3, pageSize: 2, ...o })

describe('crawl engine', () => {
  test('walks days newest → oldest, page by page, and stops after N empty days (the start of the library)', async () => {
    const f = fake({ '2026-06-10': 3, '2026-06-09': 2, '2026-06-08': 0, '2026-06-07': 1 })
    const out = await run(f)
    expect(out.status).toBe('done')
    const seen = [...new Set(f.calls.map((c) => c.startDate))]
    // 10, 9, 8(empty 1), 7, 6(empty 1), 5(empty 2), 4(empty 3) → complete
    expect(seen).toEqual(['2026-06-10', '2026-06-09', '2026-06-08', '2026-06-07', '2026-06-06', '2026-06-05', '2026-06-04'])
    // 3 rows at page size 2 = 2 pages; 2 rows = exactly one full page then a short/empty second? (2 rows: page 0 full, total says 2 → stop)
    expect(f.calls.filter((c) => c.startDate === '2026-06-10').map((c) => c.page)).toEqual([0, 1])
    expect(f.calls.filter((c) => c.startDate === '2026-06-09').map((c) => c.page)).toEqual([0])
    expect(f.stored).toHaveLength(6)
    const p = f.state.types.ECONOMIC!
    expect(p).toMatchObject({ newest: '2026-06-10', oldest: '2026-06-04', complete: true, rows: 6, mismatches: 0 })
  })

  test('progress is saved after every day, and an aborted run resumes exactly where it stopped', async () => {
    const f = fake({ '2026-06-10': 1, '2026-06-09': 1, '2026-06-08': 3, '2026-06-07': 1 })
    const ac = new AbortController()
    let n = 0
    const orig = f.deps.listPage
    f.deps.listPage = async (p) => {
      if (++n === 3) ac.abort() // pause while day 8 (2 pages) is half read
      return orig(p)
    }
    const first = await run(f, { signal: ac.signal, emptyLimit: 2 })
    expect(first.status).toBe('paused')
    expect(f.state.types.ECONOMIC).toMatchObject({ newest: '2026-06-10', oldest: '2026-06-09' }) // days 10, 9 done; day 8 NOT marked
    f.deps.listPage = orig
    const before = f.calls.length
    await run(f, { emptyLimit: 2 })
    // second run: top-up (today back to newest−2) then backfill from the day below the oldest covered (06-08)
    const resumed = f.calls.slice(before).map((c) => c.startDate)
    expect(resumed.filter((d, i) => resumed.indexOf(d) === i)).toEqual(['2026-06-10', '2026-06-09', '2026-06-08', '2026-06-07', '2026-06-06', '2026-06-05'])
    expect(f.state.types.ECONOMIC!.complete).toBe(true)
  })

  test('top-up: a later run re-reads the last 2 days and only counts genuinely new rows', async () => {
    const f = fake({ '2026-06-10': 2, '2026-06-09': 1, '2026-06-08': 1 }, { today: '2026-06-10' })
    await run(f, { emptyLimit: 1 })
    const rowsAfterFirst = f.state.types.ECONOMIC!.rows
    // next day: a new day appears, and yesterday grew (a late publication)
    const f2 = fake({ '2026-06-11': 2, '2026-06-10': 3, '2026-06-09': 1, '2026-06-08': 1 }, { today: '2026-06-11' })
    f2.state = f.state
    await run(f2, { emptyLimit: 1 })
    const days = [...new Set(f2.calls.map((c) => c.startDate))]
    expect(days.slice(0, 4)).toEqual(['2026-06-11', '2026-06-10', '2026-06-09', '2026-06-08']) // top-up window = newest−2 … today
    expect(f2.state.types.ECONOMIC!.newest).toBe('2026-06-11')
    expect(f2.state.types.ECONOMIC!.rows).toBe(rowsAfterFirst + 2) // only 06-11's two rows are new
    expect(f2.state.types.ECONOMIC!.complete).toBe(true) // already was; not crawled again downward
    expect(days).not.toContain('2026-06-07')
  })

  test('a day whose row count disagrees with the API total is recorded, not hidden', async () => {
    const f = fake({ '2026-06-10': 2 }, { totalLies: true })
    await run(f, { emptyLimit: 1 })
    expect(f.state.types.ECONOMIC!.mismatches).toBe(1)
  })

  test('a failing page is retried, then the run stops with an error and keeps its progress', async () => {
    const f = fake({ '2026-06-10': 1, '2026-06-09': 1 }, { failOn: (p) => p.startDate === '2026-06-09' })
    const out = await run(f, { retryDelaysMs: [0, 0] })
    expect(out).toEqual({ status: 'error', error: 'boom' })
    expect(f.calls.filter((c) => c.startDate === '2026-06-09')).toHaveLength(3) // 1 try + 2 retries
    expect(f.state.types.ECONOMIC).toMatchObject({ newest: '2026-06-10', oldest: '2026-06-10' })
  })

  test('the floor date ends a backfill', async () => {
    const f = fake({ '2026-06-10': 1, '2026-06-09': 1, '2026-06-08': 1 })
    await run(f, { floor: '2026-06-09', emptyLimit: 99 })
    expect(f.state.types.ECONOMIC).toMatchObject({ oldest: '2026-06-09', complete: true })
  })

  test('each court type keeps its own progress', async () => {
    const f = fake({ '2026-06-10': 1 })
    await run(f, { courtTypes: ['ECONOMIC', 'CIVIL'], emptyLimit: 1 })
    expect(Object.keys(f.state.types).sort()).toEqual(['CIVIL', 'ECONOMIC'])
    expect(f.state.types.CIVIL!.rows).toBe(1)
  })
})

test('emptyProgress starts clean', () => expect(emptyProgress()).toMatchObject({ newest: null, oldest: null, complete: false, rows: 0 }))
