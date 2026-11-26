import { describe, expect, test } from 'bun:test'
import { createSerialGate } from '../serial-gate'

/** A fake clock: sleep() advances time instantly. `work(ms)` is a holder that keeps the gate for `ms` of fake time. */
function rig(gap: number) {
  let t = 1_000_000
  const gate = createSerialGate({
    gapMs: () => gap,
    now: () => t,
    sleep: async (ms) => {
      await new Promise((r) => setTimeout(r, 0))
      t += ms
    },
  })
  const log: { id: string; start: number; end: number }[] = []
  const work = async (id: string, ms: number, signal?: AbortSignal) => {
    const release = await gate.acquire(signal)
    const start = t
    t += ms
    log.push({ id, start, end: t })
    release()
  }
  return { gate, log, work, clock: () => t }
}

describe('serial gate', () => {
  test('one at a time, the next starts a short rest after the previous one is DONE (not from its start)', async () => {
    const r = rig(4_000)
    await Promise.all([r.work('a', 6_000), r.work('b', 1_000), r.work('c', 2_000)])
    expect(r.log.map((l) => l.id)).toEqual(['a', 'b', 'c'])
    expect(r.log[1].start - r.log[0].end).toBe(4_000) // 4 s after a FINISHED, although a took 6 s
    expect(r.log[2].start - r.log[1].end).toBe(4_000)
    for (let i = 1; i < r.log.length; i++) expect(r.log[i].start).toBeGreaterThanOrEqual(r.log[i - 1].end) // never two at once
  })
  test('a first caller never waits; the next one waits the rest once', async () => {
    const r = rig(4_000)
    const t0 = r.clock()
    await r.work('a', 1_000)
    expect(r.log[0].start).toBe(t0)
    const before = r.clock()
    await r.work('b', 1_000)
    expect(r.log[1].start - before).toBe(4_000) // asked right after a finished: the rest is waited once, never more
    r.gate.waiting() // nothing is queued afterwards
    expect(r.gate.waiting()).toBe(0)
  })
  test('gap 0: still one at a time, no rest', async () => {
    const r = rig(0)
    await Promise.all([r.work('a', 500), r.work('b', 500)])
    expect(r.log[1].start).toBe(r.log[0].end)
  })
  test('a failure that releases lets the next one go; releasing twice does nothing', async () => {
    const r = rig(1_000)
    const a = await r.gate.acquire()
    const nextP = r.work('b', 10)
    a()
    a()
    await nextP
    expect(r.log.map((l) => l.id)).toEqual(['b'])
    expect(r.gate.waiting()).toBe(0)
  })
  test('a caller that aborts while waiting leaves the queue and never takes a turn', async () => {
    const r = rig(1_000)
    const first = await r.gate.acquire()
    const ctl = new AbortController()
    const quitter = r.work('x', 10, ctl.signal)
    const stayer = r.work('y', 10)
    ctl.abort()
    await expect(quitter).rejects.toMatchObject({ name: 'AbortError' })
    first()
    await stayer
    expect(r.log.map((l) => l.id)).toEqual(['y'])
    await expect(r.gate.acquire(ctl.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
