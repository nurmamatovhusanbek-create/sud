import { describe, expect, test } from 'bun:test'
import { createPacer } from '../pacer'

/** A fake clock: sleep() advances time instantly, so «10 seconds» costs nothing. */
function rig(gap: number | (() => number)) {
  let t = 1_000_000
  const starts: { id: string; at: number }[] = []
  const pacer = createPacer({
    gapMs: typeof gap === 'number' ? () => gap : gap,
    now: () => t,
    // a real tick first, so every released caller has recorded its start before the clock moves on
    sleep: async (ms) => {
      await new Promise((res) => setTimeout(res, 0))
      t += ms
    },
  })
  const go = (id: string, p: 'interactive' | 'background' = 'background', signal?: AbortSignal) =>
    pacer.pace(p, signal).then(() => void starts.push({ id, at: t }))
  return { pacer, starts, go, clock: () => t, advance: (ms: number) => void (t += ms) }
}

describe('pacer', () => {
  test('forty callers at once: one starts every gap, in order', async () => {
    const r = rig(10_000)
    await Promise.all(Array.from({ length: 40 }, (_, i) => r.go(`r${i}`)))
    expect(r.starts).toHaveLength(40)
    expect(r.starts.map((s) => s.id)).toEqual(Array.from({ length: 40 }, (_, i) => `r${i}`))
    for (let i = 1; i < 40; i++) expect(r.starts[i].at - r.starts[i - 1].at).toBeGreaterThanOrEqual(10_000)
  })

  test('the first request goes at once; an idle pacer owes nothing', async () => {
    const r = rig(10_000)
    const t0 = r.clock()
    await r.go('a')
    expect(r.starts[0].at).toBe(t0)
    r.advance(60_000)
    const t1 = r.clock()
    await r.go('b')
    expect(r.starts[1].at).toBe(t1)
  })

  test('a person (interactive) is released before the crawl (background) that is already waiting', async () => {
    const r = rig(10_000)
    const all = [r.go('crawl-1'), r.go('crawl-2'), r.go('crawl-3')]
    await Promise.resolve() // crawl-1 has been released; 2 and 3 wait
    all.push(r.go('click', 'interactive'))
    await Promise.all(all)
    expect(r.starts.map((s) => s.id)).toEqual(['crawl-1', 'click', 'crawl-2', 'crawl-3'])
  })

  test('a gap of 0 switches pacing off', async () => {
    const r = rig(0)
    const t0 = r.clock()
    await Promise.all([r.go('a'), r.go('b'), r.go('c')])
    expect(r.starts.every((s) => s.at === t0)).toBe(true)
  })

  test('the gap is read at every release, so changing it takes effect without a restart', async () => {
    let gap = 10_000
    const r = rig(() => gap)
    await r.go('a')
    gap = 2_000
    await r.go('b') // the slot already booked still ran at the old gap…
    await r.go('c')
    expect(r.starts[2].at - r.starts[1].at).toBe(2_000)
  })

  test('a caller that gives up (abort) leaves the queue and takes no slot', async () => {
    const r = rig(10_000)
    const ac = new AbortController()
    const a = r.go('a')
    const gone = r.go('gone', 'background', ac.signal)
    const c = r.go('c')
    ac.abort()
    await a
    await expect(gone).rejects.toThrow()
    await c
    expect(r.starts.map((s) => s.id)).toEqual(['a', 'c'])
    expect(r.starts[1].at - r.starts[0].at).toBe(10_000) // c did not wait for the slot of the one that left
  })

  test('already aborted: rejected at once and never queued', async () => {
    const r = rig(10_000)
    const ac = new AbortController()
    ac.abort()
    await expect(r.pacer.pace('background', ac.signal)).rejects.toThrow()
    expect(r.pacer.waiting()).toBe(0)
  })
})
