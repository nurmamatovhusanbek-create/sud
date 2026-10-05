/**
 * The court-list route with daily snapshots, through the real route handler: the first open scrapes, later opens
 * (even after the 10-minute memory is gone) do not, `force=1` does, and an incomplete answer is never kept.
 * Only the network is faked (workers, via fetch).
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-snap-route-'))
process.env.SNAPSHOT_DIR = DIR

mock.module('server-only', () => ({}))
const WORKERS = ['https://w1.example/', 'https://w2.example/']
mock.module('@/lib/cf-worker-pool', () => ({
  getCfWorkerUrls: () => WORKERS,
  createWorkerPool: () => ({ nextProxyUrl: (u: string) => u }),
  OriginHealthPool: class {
    recordSuccess() {}
    recordFailure() {}
  },
}))

const TIN = '300111222'
let apiCalls = 0
let jadvalapiOk = true
const row = { casenumber: '4-1001-2621/42935', court: 'Sud', status_name: 'x', claiment: 'A', defendant: 'B', hearing_date: '01.01.2020' }

// installed per test (bun runs every test file in one process; another file's fetch fake must stay intact)
let realFetch: typeof fetch
const fake = (async (input: RequestInfo | URL) => {
  const full = String(input)
  const url = full.slice(WORKERS.find((w) => full.startsWith(w))?.length ?? 0)
  if (url.includes('jadvalapi.sud.uz') && url.includes(`ECONOMIC/findByTin/${TIN}`)) {
    apiCalls++
    return jadvalapiOk
      ? new Response(JSON.stringify([row]), { status: 200, headers: { 'Content-Type': 'application/json' } })
      : new Response('boom', { status: 500 })
  }
  return new Response('[]', { status: 404 })
}) as typeof fetch
beforeEach(() => {
  realFetch = globalThis.fetch
  globalThis.fetch = fake
})
afterEach(() => {
  globalThis.fetch = realFetch
})
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }))

const { GET } = await import('@/app/api/court-cases/route')
const { clearCourtCaseCache } = await import('../court-case')
const { __resetSnapshotsForTests } = await import('../snapshot-store')

const get = async (extra = '') => {
  const req = new NextRequest(`http://localhost:3000/api/court-cases?courtType=economic&mode=tin&value=${TIN}${extra}`, { headers: { host: 'localhost:3000' } })
  return (await GET(req)).json() as Promise<{ ok: boolean; data: { cases: unknown[] }; meta?: { cached?: boolean; fetchedAt?: number } }>
}

beforeEach(() => {
  apiCalls = 0
  jadvalapiOk = true
  clearCourtCaseCache(TIN)
  __resetSnapshotsForTests()
  fs.rmSync(DIR, { recursive: true, force: true })
})

describe('court list snapshot', () => {
  test('first open scrapes and saves; the next opens read the file, with no scrape', async () => {
    const a = await get()
    expect(a.ok).toBe(true)
    expect(a.data.cases).toHaveLength(1)
    expect(a.meta?.cached).toBe(false)
    expect(apiCalls).toBe(1)

    clearCourtCaseCache(TIN) // as after a restart: no memory left
    __resetSnapshotsForTests()
    const b = await get()
    expect(b.data.cases).toHaveLength(1)
    expect(b.meta).toMatchObject({ cached: true, fetchedAt: a.meta?.fetchedAt })
    expect(apiCalls).toBe(1)
  })

  test('force=1 scrapes again even though the snapshot is fresh', async () => {
    await get()
    const c = await get('&force=1')
    expect(c.meta?.cached).toBe(false)
    expect(apiCalls).toBe(2)
  })

  test('an incomplete answer (a source failed) is not kept: the next open scrapes again', async () => {
    jadvalapiOk = false
    await get()
    jadvalapiOk = true
    clearCourtCaseCache(TIN)
    const b = await get()
    expect(b.meta?.cached).toBe(false)
    expect(b.data.cases).toHaveLength(1)
  })
})
