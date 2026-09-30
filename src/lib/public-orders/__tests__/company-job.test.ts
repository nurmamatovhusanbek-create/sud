import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

mock.module('server-only', () => ({}))

// the upstream: every search waits on a gate we open by hand, so pause/resume are tested at exact moments
const gates: (() => void)[] = []
let failNext = false
const searched: string[] = []
mock.module('../source', () => ({
  searchCase: (cn: string) =>
    new Promise((resolve, reject) => {
      searched.push(cn)
      gates.push(() => (failNext ? reject(new Error('worker 502')) : resolve([])))
    }),
  fetchOrderFile: async () => new Uint8Array(),
}))

let dir: string
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pub-job-'))
  process.env.PUBLIC_ORDERS_DIR = dir
})
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms))
// one lookup = 3 parallel instance searches; release them all
async function finishCurrentCase() {
  await tick(10)
  for (const g of gates.splice(0)) g()
  await tick(30)
}
const job = (n: number, extra: Record<string, string> = {}) => ({ caseNumber: `4-1001-2601/${n}`, courtType: 'ECONOMIC' as const, sig: 's', result: 'Daʼvo qanoatlantirilsin', ...extra })

describe('company job queue', () => {
  test('cases still heard in the first instance are left out, decided / appealed ones are queued', async () => {
    const { enqueueCases, cancelCases, caseJobStatus } = await import('../company-job')
    const out = await enqueueCases([
      job(1, { result: '', caseStatus: 'Иш юритувда' }),
      job(2, { result: '', caseStatus: 'Апелляцияда' }),
      job(3),
    ])
    expect(out.added).toBe(2)
    expect(out.ongoing).toBe(1)
    expect(caseJobStatus().ongoing).toBe(1)
    cancelCases()
    await finishCurrentCase()
  })

  test('pause keeps the queue and its ORDER; resume continues from the same case with the same counters', async () => {
    const { enqueueCases, pauseCases, resumeCases, caseJobStatus } = await import('../company-job')
    await tick(50)
    searched.length = 0
    await enqueueCases([job(11), job(12), job(13)])
    await tick(30)
    expect(searched.every((c) => c.endsWith('/11'))).toBe(true) // first case is being searched
    pauseCases()
    expect(caseJobStatus().state).toBe('paused') // answers at once
    await finishCurrentCase() // the case in flight finishes …
    let st = caseJobStatus()
    expect(st.state).toBe('paused') // … and nothing else starts
    expect(st.remaining).toBe(2)
    expect(st.done).toBe(1)
    expect(searched.some((c) => c.endsWith('/12'))).toBe(false)

    resumeCases()
    await tick(30)
    expect(searched.some((c) => c.endsWith('/12'))).toBe(true) // continues with the NEXT case, in order
    expect(searched.some((c) => c.endsWith('/13'))).toBe(false)
    st = caseJobStatus()
    expect(st.state).toBe('running')
    expect(st.total).toBe(3) // counters were not reset
    expect(st.done).toBe(1)
    await finishCurrentCase()
    await finishCurrentCase()
    expect(caseJobStatus().state).toBe('done')
    expect(caseJobStatus().done).toBe(3)
  })

  test('resuming while the paused case is still being searched just carries on (no second loop)', async () => {
    const { enqueueCases, pauseCases, resumeCases, caseJobStatus } = await import('../company-job')
    searched.length = 0
    await enqueueCases([job(21), job(22)])
    await tick(30)
    pauseCases()
    resumeCases()
    expect(caseJobStatus().state).toBe('running')
    await finishCurrentCase()
    await finishCurrentCase()
    expect(searched.filter((c) => c.endsWith('/21')).length).toBe(3) // 3 instance searches, once
    expect(caseJobStatus().done).toBe(2)
  })

  test('cancel drops what is left; the automatic feeder never undoes a pause', async () => {
    const { enqueueCases, pauseCases, cancelCases, caseJobStatus } = await import('../company-job')
    searched.length = 0
    await enqueueCases([job(31), job(32), job(33)])
    await tick(30)
    pauseCases()
    await enqueueCases([job(34)], { keepPaused: true })
    expect(caseJobStatus().state).toBe('paused')
    expect(caseJobStatus().remaining).toBe(3)
    cancelCases()
    expect(caseJobStatus().remaining).toBe(0)
    await finishCurrentCase()
    expect(caseJobStatus().state).not.toBe('running')
    expect(searched.some((c) => c.endsWith('/32'))).toBe(false)
  })

  test('DETECT (plan) is free: it counts what needs a look, changes nothing and makes no request', async () => {
    const { planCases, caseJobStatus } = await import('../company-job')
    await tick(50)
    searched.length = 0
    const before = JSON.stringify(caseJobStatus())
    const p = await planCases([job(41), job(42), job(43, { result: '', caseStatus: 'Иш юритувда' })])
    expect(p.need.map((c) => c.caseNumber)).toEqual(['4-1001-2601/41', '4-1001-2601/42'])
    expect(p.ongoing).toBe(1)
    await tick(30)
    expect(searched).toEqual([]) // nothing scraped
    expect(JSON.stringify(caseJobStatus())).toBe(before) // and no state moved: nothing «ready», nothing queued
  })

  test('cases already known or waiting out their back-off are not work (no request, not counted)', async () => {
    const { enqueueCases, planCases, caseJobStatus } = await import('../company-job')
    const { markChecked } = await import('../store')
    await tick(50)
    await markChecked({ caseNumber: '4-1001-2601/51', at: new Date().toISOString(), sig: 's', seen: [], misses: 0 }) // checked just now, unchanged
    await markChecked({ caseNumber: '4-1001-2601/52', at: new Date().toISOString(), sig: 's', seen: ['FIRST', 'APPEAL', 'CASSATION'], misses: 0 })
    const cases = [job(51), job(52), job(53)]
    const p = await planCases(cases)
    expect(p.need).toHaveLength(1)
    expect(p.known).toBe(2)
    const out = await enqueueCases(cases)
    expect(out.added).toBe(1)
    expect(out.known).toBe(2)
    expect(caseJobStatus().total).toBe(1)
    await finishCurrentCase()
    await finishCurrentCase()
  })

  test('a failed lookup stays listed and «retry» re-queues exactly it, no refresh needed', async () => {
    const { enqueueCases, retryFailed, caseJobStatus } = await import('../company-job')
    await tick(50)
    failNext = true
    await enqueueCases([job(61)])
    await tick(30)
    await finishCurrentCase() // all 3 instance searches reject
    await tick(30)
    let st = caseJobStatus()
    expect(st.errors).toBe(1)
    expect(st.failed).toBe(1)
    failNext = false
    searched.length = 0
    const r = await retryFailed()
    expect(r.added).toBe(1)
    await tick(30)
    expect(searched.some((c) => c.endsWith('/61'))).toBe(true)
    await finishCurrentCase()
    st = caseJobStatus()
    expect(st.failed).toBe(0)
  })
})
