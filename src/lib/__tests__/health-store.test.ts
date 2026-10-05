import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addToBucket, DAY_MS, HOUR_MS, recordTotals, rollUp, spanTotals, type Bucket } from '../health-span'
import { __resetHealthStoreForTests, flushNow, getWorkerHistory, pruneStore, recordRequest, RECENT_KEEP } from '../health-store'
import { OriginHealthPool } from '../cf-worker-pool'

const W1 = 'https://a.example.workers.dev/'
const W2 = 'https://b.example.workers.dev/'
let dir = ''
const NOW = Date.UTC(2026, 9, 5, 12, 30)

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sud-health-'))
  process.env.WORKER_HEALTH_FILE = path.join(dir, 'worker-health.json')
  __resetHealthStoreForTests()
})
afterEach(() => {
  __resetHealthStoreForTests()
  delete process.env.WORKER_HEALTH_FILE
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('buckets (pure)', () => {
  test('requests in the same hour share a bucket; counts and ms add up', () => {
    const b: Bucket[] = []
    addToBucket(b, NOW, true, 300)
    addToBucket(b, NOW + 60_000, false, 900)
    addToBucket(b, NOW + HOUR_MS, true, 100)
    expect(b).toHaveLength(2)
    expect(b[0]).toMatchObject({ w: HOUR_MS, ok: 1, fail: 1, ms: 1200 })
    expect(b[0].t % HOUR_MS).toBe(0)
  })
  test('spanTotals follows the window; null = all time', () => {
    const b: Bucket[] = []
    addToBucket(b, NOW - 10 * DAY_MS, true, 200)
    addToBucket(b, NOW - 2 * DAY_MS, true, 400)
    addToBucket(b, NOW - 2 * HOUR_MS, false, 600)
    expect(spanTotals(b, NOW, 24 * HOUR_MS)).toMatchObject({ requests: 1, ok: 0, fail: 1, avgMs: 600 })
    expect(spanTotals(b, NOW, 7 * DAY_MS)).toMatchObject({ requests: 2, ok: 1, fail: 1, avgMs: 500 })
    expect(spanTotals(b, NOW, 30 * DAY_MS).requests).toBe(3)
    expect(spanTotals(b, NOW, null).requests).toBe(3)
    expect(spanTotals([], NOW, null)).toMatchObject({ requests: 0, avgMs: null })
  })
  test('rollUp folds old hours into days without losing a single request', () => {
    const b: Bucket[] = []
    for (let h = 0; h < 48; h++) addToBucket(b, NOW - 60 * DAY_MS + h * HOUR_MS, h % 4 !== 0, 100) // 2 old days
    addToBucket(b, NOW - HOUR_MS, true, 50)
    const r = rollUp(b, NOW, 35)
    expect(r.filter((x) => x.w === DAY_MS).length).toBeLessThanOrEqual(3)
    expect(r.filter((x) => x.w === HOUR_MS)).toHaveLength(1) // the recent hour stays hourly
    expect(r.reduce((a, x) => a + x.ok + x.fail, 0)).toBe(49)
    expect(r.reduce((a, x) => a + x.ms, 0)).toBe(48 * 100 + 50)
    expect(spanTotals(r, NOW, null).requests).toBe(49)
  })
  test('recordTotals is the same answer from raw records', () => {
    const rs = [{ ts: NOW - 5 * HOUR_MS, ok: true, ms: 100 }, { ts: NOW - 40 * HOUR_MS, ok: false, ms: 300 }]
    expect(recordTotals(rs, NOW, 24 * HOUR_MS)).toMatchObject({ requests: 1, ok: 1, avgMs: 100 })
    expect(recordTotals(rs, NOW, null)).toMatchObject({ requests: 2, fail: 1, avgMs: 200 })
  })
})

describe('the saved history', () => {
  test('survives a restart (state dropped, file kept) — the bug: it only lived in memory', () => {
    recordRequest('jadval.sud.uz', W1, true, 400, NOW - 3 * DAY_MS)
    recordRequest('jadval.sud.uz', W1, false, 1200, NOW - 3 * DAY_MS + 1000)
    recordRequest('orginfo.uz', W1, true, 200, NOW - HOUR_MS)
    recordRequest('jadval.sud.uz', W2, true, 100, NOW)
    expect(flushNow()).toBe(true)
    expect(fs.existsSync(process.env.WORKER_HEALTH_FILE!)).toBe(true)

    __resetHealthStoreForTests() // = the server restarted
    const h = getWorkerHistory(W1)
    expect(h.origins.sort()).toEqual(['jadval.sud.uz', 'orginfo.uz'])
    expect(spanTotals(h.buckets, NOW, null)).toMatchObject({ requests: 3, ok: 2, fail: 1 })
    expect(spanTotals(h.buckets, NOW, 7 * DAY_MS).requests).toBe(3)
    expect(spanTotals(h.buckets, NOW, 24 * HOUR_MS).requests).toBe(1)
    expect(h.recent).toHaveLength(3)
    expect(h.recent[0].ts).toBeLessThan(h.recent[2].ts)
    expect(getWorkerHistory(W2).buckets).toHaveLength(1)
  })
  test('counts keep adding after a restart instead of starting from zero', () => {
    recordRequest('o', W1, true, 100, NOW)
    flushNow()
    __resetHealthStoreForTests()
    recordRequest('o', W1, true, 100, NOW + 1000)
    expect(spanTotals(getWorkerHistory(W1).buckets, NOW + 2000, null).requests).toBe(2)
  })
  test('a busy worker does not push its long history out: only the RAW window is capped', () => {
    for (let i = 0; i < RECENT_KEEP * 3; i++) recordRequest('o', W1, true, 10, NOW - 20 * DAY_MS + i * 1000)
    const h = getWorkerHistory(W1)
    expect(h.recent).toHaveLength(RECENT_KEEP)
    expect(spanTotals(h.buckets, NOW, null).requests).toBe(RECENT_KEEP * 3)
  })
  test('old hours are rolled up into days on save, and nothing is lost', () => {
    for (let i = 0; i < 100; i++) recordRequest('o', W1, i % 2 === 0, 50, Date.now() - 80 * DAY_MS + i * 10 * 60_000)
    recordRequest('o', W1, true, 50, Date.now() - 1000)
    flushNow()
    __resetHealthStoreForTests()
    const b = getWorkerHistory(W1).buckets
    expect(b.some((x) => x.w === DAY_MS)).toBe(true)
    expect(b.reduce((a, x) => a + x.ok + x.fail, 0)).toBe(101)
  })
  test('a worker removed in Settings takes its history with it; the others stay', () => {
    recordRequest('o', W1, true, 1, NOW)
    recordRequest('o', W2, true, 1, NOW)
    pruneStore([W2])
    flushNow()
    __resetHealthStoreForTests()
    expect(getWorkerHistory(W1).buckets).toEqual([])
    expect(getWorkerHistory(W2).buckets).toHaveLength(1)
  })
  test('a damaged file is not fatal: start empty, the next save replaces it', () => {
    fs.writeFileSync(process.env.WORKER_HEALTH_FILE!, '{"version":1,"workers":{"x":')
    expect(getWorkerHistory(W1).buckets).toEqual([])
    recordRequest('o', W1, true, 5, NOW)
    expect(flushNow()).toBe(true)
    expect(JSON.parse(fs.readFileSync(process.env.WORKER_HEALTH_FILE!, 'utf8')).version).toBe(1)
  })
  test('garbage rows inside a valid file are skipped, not trusted', () => {
    fs.writeFileSync(process.env.WORKER_HEALTH_FILE!, JSON.stringify({ version: 1, workers: { [W1]: { o: { b: [[NOW, HOUR_MS, 2, 1, 300], ['x'], [1, 2]], r: [[NOW, 1, 300], 'bad'] } } } }))
    const h = getWorkerHistory(W1)
    expect(h.buckets).toHaveLength(1)
    expect(h.recent).toEqual([{ ts: NOW, ok: true, ms: 300, origin: 'o' }])
  })
  test('the file is private (0600) and written atomically (no temp file left)', () => {
    recordRequest('o', W1, true, 5, NOW)
    flushNow()
    expect(fs.statSync(process.env.WORKER_HEALTH_FILE!).mode & 0o777).toBe(0o600)
    expect(fs.readdirSync(dir)).toEqual(['worker-health.json'])
  })
  test('an unwritable location only costs persistence (memory still counts)', () => {
    process.env.WORKER_HEALTH_FILE = '/proc/nope/worker-health.json'
    __resetHealthStoreForTests()
    recordRequest('o', W1, true, 5, NOW)
    expect(flushNow()).toBe(false)
    expect(getWorkerHistory(W1).buckets).toHaveLength(1)
  })
})

describe('the pool feeds the store', () => {
  test('every success and failure the pool sees is saved against its worker', () => {
    const pool = new OriginHealthPool('test-pool')
    pool.recordSuccess('jadval.sud.uz', W1, 350)
    pool.recordFailure('jadval.sud.uz', W1, 5000, 'timeout')
    pool.recordSuccess('orginfo.uz', W2, 120)
    flushNow()
    __resetHealthStoreForTests()
    expect(spanTotals(getWorkerHistory(W1).buckets, Date.now(), null)).toMatchObject({ requests: 2, ok: 1, fail: 1, ms: 5350 })
    expect(spanTotals(getWorkerHistory(W2).buckets, Date.now(), null).requests).toBe(1)
  })
})
