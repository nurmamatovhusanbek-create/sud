/**
 * Bills in the daily snapshot: the helpers, and the route through the real handler. The network is faked (workers, via
 * fetch) and fails for everything, so any scrape attempt shows up as an error or a stale fallback.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-bills-snap-'))
process.env.SNAPSHOT_DIR = DIR

mock.module('server-only', () => ({}))
const WORKERS = ['https://bills-w1.example/', 'https://bills-w2.example/'] // own URLs: the scheduler keeps per-worker failure state for the whole test process
// bun's mock.module is process-wide: keep the real module to put back when this file is done
const realPool = { ...(await import('@/lib/cf-worker-pool')) }
mock.module('@/lib/cf-worker-pool', () => ({
  getCfWorkerUrls: () => WORKERS,
  createWorkerPool: () => ({ nextProxyUrl: (u: string) => u }),
  OriginHealthPool: class {
    recordSuccess() {}
    recordFailure() {}
  },
}))

const { billsStorable, replayLines } = await import('../bills-snapshot')
const { readSnapshot, writeSnapshot, __resetSnapshotsForTests } = await import('../snapshot-store')
const { GET } = await import('@/app/api/bills/route')
import type { EnrichedBill } from '../billing'

const INN = '300999111'
const bill = (n: string, error?: string): EnrichedBill => ({ number: n, invoiceStatus: 'PAID', issued: 1767225600000, detail: error ? null : ({ amount: 100 } as never), ...(error ? { error } : {}) }) as EnrichedBill
const snapData = { total: 2, bills: [bill('A1'), bill('A2')] }

let networkCalls = 0
let realFetch: typeof fetch
const fake = (async () => {
  networkCalls++
  return new Response('down', { status: 503 })
}) as unknown as typeof fetch
beforeEach(() => {
  realFetch = globalThis.fetch
  globalThis.fetch = fake
  networkCalls = 0
  __resetSnapshotsForTests()
  fs.rmSync(DIR, { recursive: true, force: true })
})
afterEach(() => {
  globalThis.fetch = realFetch
})
afterAll(() => {
  mock.module('@/lib/cf-worker-pool', () => realPool)
  fs.rmSync(DIR, { recursive: true, force: true })
})

const lines = async (extra = '') => {
  const res = await GET(new NextRequest(`http://localhost:3000/api/bills?inn=${INN}${extra}`, { headers: { host: 'localhost:3000' } }))
  return (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)
}

describe('helpers', () => {
  test('stored only when no bill is left with a TRANSIENT error', () => {
    expect(billsStorable([bill('1'), bill('2')])).toBe(true)
    expect(billsStorable([bill('1'), bill('2', 'HTTP 500 from origin')])).toBe(true) // definitive: a stable fact
    expect(billsStorable([bill('1'), bill('2', 'timeout after 8000ms')])).toBe(false)
    expect(billsStorable([])).toBe(true)
  })

  test('the replay is the live stream: meta, every bill in order, done', () => {
    const out = replayLines(INN, { data: snapData, fetchedAt: 123 }).map((l) => JSON.parse(l))
    expect(out.map((m) => m.type)).toEqual(['meta', 'bill', 'bill', 'done'])
    expect(out[0]).toMatchObject({ total: 2, cached: true, fetchedAt: 123 })
    expect(out[0].stale).toBeUndefined()
    expect(out.slice(1, 3).map((m) => m.index)).toEqual([0, 1])
    expect(out[3]).toMatchObject({ fetchedAt: 123 })
    expect(JSON.parse(replayLines(INN, { data: snapData, fetchedAt: 1 }, true)[0]).stale).toBe(true)
  })
})

describe('GET /api/bills with a snapshot', () => {
  test('inside its day: replayed with NO network call (no captcha, no scrape)', async () => {
    writeSnapshot(INN, 'bills', snapData, Date.now() - 3600_000)
    const out = await lines()
    expect(out.map((m) => m.type)).toEqual(['meta', 'bill', 'bill', 'done'])
    expect(out[0]).toMatchObject({ cached: true })
    expect(networkCalls).toBe(0)
  })

  test('force=1 scrapes even though the snapshot is fresh; when that fails the error comes through and the snapshot stays', async () => {
    writeSnapshot(INN, 'bills', snapData, Date.now() - 3600_000)
    const out = await lines('&force=1')
    expect(out.at(-1)?.type).toBe('error')
    expect(networkCalls).toBeGreaterThan(0)
    expect(readSnapshot(INN, 'bills')?.data).toEqual(snapData)
  })

  test('past its day and the sites fail before anything is sent: the old list is shown, flagged stale', async () => {
    writeSnapshot(INN, 'bills', snapData, Date.now() - 2 * 24 * 3600_000)
    const out = await lines()
    const meta = out.find((m) => m.type === 'meta')
    expect(meta).toMatchObject({ cached: true, stale: true })
    expect(out.filter((m) => m.type === 'bill')).toHaveLength(2)
    expect(out.at(-1)?.type).toBe('done')
  })

  test('no snapshot and the sites fail: an error, as before', async () => {
    const out = await lines()
    expect(out.at(-1)?.type).toBe('error')
  })
})
