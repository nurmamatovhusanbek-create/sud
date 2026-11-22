/**
 * A company's court list through the disk memory (lib/case-store + court-case): asked with the stored ETag, a «not modified» answer costs
 * no download, a broken download is MERGED into what is kept (never replacing it with less), and a dead court is answered from disk.
 * The rows are synthetic, shaped like jadvalapi's (read live for a large bank, Nov 2026). The network is faked.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

mock.module('server-only', () => ({}))
const WORKERS = ['https://list-w1.example/', 'https://list-w2.example/']
const realPool = { ...(await import('@/lib/cf-worker-pool')) }
mock.module('@/lib/cf-worker-pool', () => ({
  getCfWorkerUrls: () => WORKERS,
  createWorkerPool: () => ({ nextProxyUrl: (u: string) => u }),
  OriginHealthPool: class {
    recordSuccess() {}
    recordFailure() {}
  },
}))

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'case-list-'))
process.env.CASE_STORE_DIR = DIR
const TIN = '309922250'
const FEED = 'civil|jadvalapi.sud.uz/online-monitoring/CIVIL/findByTin'

const mk = (n: number, extra: Record<string, unknown> = {}) => ({
  casenumber: `2-1103-2604/${String(n).padStart(5, '0')}`, category: 'Кредит шартномасига доир', instance: 'Биринчи инстанция', court: 'Sud', region: 'Тошкент вилояти',
  status_name: 'Кўриб чиқиш жараёнида', reg_date: '10.11.2026', hearing_date: '', hearing_time: '', responsible: '', result: '',
  claiment: 'BANK AJ', defendant: `JAMSHID ${n}`, reviews: [], ...extra,
})

type Step = { status: number; etag?: string; rows?: unknown[]; breakAfter?: number; throws?: boolean }
let script: Step[] = []
let seen: Array<{ inm: string | null }> = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const full = String(input)
  if (!full.includes(`CIVIL/findByTin/${TIN}`)) return new Response('[]', { status: 404 })
  const h = new Headers(init?.headers)
  seen.push({ inm: h.get('if-none-match') })
  const step = script.shift()
  if (!step || step.throws) throw new Error('network down')
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (step.etag) headers.etag = step.etag
  if (step.status === 304) return new Response(null, { status: 304, headers })
  if (step.status !== 200) return new Response('boom', { status: step.status })
  const rows = step.rows ?? []
  if (step.breakAfter === undefined) return new Response(JSON.stringify(rows), { status: 200, headers })
  const enc = new TextEncoder()
  const head = `[${rows.slice(0, step.breakAfter).map((r) => JSON.stringify(r)).join(',')},{"casenumber":"2-1103-2604/9`
  let sent = false
  return new Response(new ReadableStream({ pull(c) { if (!sent) { sent = true; c.enqueue(enc.encode(head)) } else c.error(new Error('connection reset')) } }), { status: 200, headers })
}) as typeof fetch
afterAll(() => {
  mock.module('@/lib/cf-worker-pool', () => realPool)
  globalThis.fetch = realFetch
  fs.rmSync(DIR, { recursive: true, force: true })
})

const court = await import('../court-case')
const store = await import('../case-store')
const open = async () => {
  court.clearCourtCaseCache(TIN) // the 10 min memory: every open below is a fresh one
  return court.searchCourtCasesDetailed('civil', 'tin', TIN)
}

beforeEach(() => {
  fs.rmSync(DIR, { recursive: true, force: true })
  store.forgetCaseStoreMemory()
  court.clearCourtCaseCache(TIN)
  script = []
  seen = []
})

describe('a list the court cuts at its row limit', () => {
  const many = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => mk(from + i))

  test('exactly 100 rows (the new system\'s limit) is a window: it is merged into what was seen, so older cases stay', async () => {
    script = [{ status: 200, etag: 'W/"a"', rows: many(1, 100) }, { status: 200, etag: 'W/"b"', rows: many(51, 150) }]
    const a = await open()
    expect(a.cases).toHaveLength(100)
    expect(a.capped).toBe(true)
    const b = await open()
    expect(b.cases).toHaveLength(150) // 1-50 slid out of the court's newest 100 and are still here
    expect(b.capped).toBe(true)
    expect(b.incomplete).toBe(false)
    expect(store.readFeed(TIN, FEED)?.capped).toBe(true)
  })

  test('an unchanged capped list is answered from disk with the accumulated rows and still says capped', async () => {
    script = [{ status: 200, etag: 'W/"a"', rows: many(1, 100) }, { status: 200, etag: 'W/"b"', rows: many(51, 150) }, { status: 304 }]
    await open()
    await open()
    const c = await open()
    expect(c.cases).toHaveLength(150)
    expect(c.capped).toBe(true)
  })

  test('a list under the limit is the whole truth and replaces the stored one', async () => {
    script = [{ status: 200, etag: 'W/"a"', rows: many(1, 100) }, { status: 200, etag: 'W/"b"', rows: many(1, 40) }]
    await open()
    const b = await open()
    expect(b.cases).toHaveLength(40)
    expect(b.capped).toBeUndefined()
  })
})

describe('a big list through the disk memory', () => {
  test('a complete answer is stored with its ETag, and the next open asks with it', async () => {
    script = [{ status: 200, etag: 'W/"v1"', rows: [mk(1), mk(2), mk(3)] }, { status: 304 }]
    const a = await open()
    expect(a.cases).toHaveLength(3)
    expect(a.incomplete).toBe(false)
    expect(seen[0].inm).toBeNull()
    const b = await open()
    expect(seen[1].inm).toBe('W/"v1"')
    expect(b.cases.map((c) => c.caseNumber)).toEqual(a.cases.map((c) => c.caseNumber))
    expect(b.incomplete).toBe(false)
  })

  test('a worker that answers 200 instead of «not modified» but sends the same ETag: the body is not read, the stored list is used', async () => {
    script = [{ status: 200, etag: 'W/"v1"', rows: [mk(1), mk(2), mk(3)] }, { status: 200, etag: 'W/"v1"', rows: [mk(77)] }]
    await open()
    const b = await open()
    // the second body holds only case 77: reading it would have replaced the list. It is the stored list that is shown
    expect(b.cases.map((c) => c.caseNumber.slice(-5))).toEqual(['00001', '00002', '00003'])
    expect(b.incomplete).toBe(false)
  })

  test('the stored list survives a restart: the first open after it already sends the ETag', async () => {
    script = [{ status: 200, etag: 'W/"v1"', rows: [mk(1), mk(2)] }, { status: 304 }]
    await open()
    store.forgetCaseStoreMemory()
    const b = await open()
    expect(seen[1].inm).toBe('W/"v1"')
    expect(b.cases).toHaveLength(2)
  })

  test('a changed list replaces the stored one, and a case the court no longer lists is gone', async () => {
    script = [{ status: 200, etag: 'W/"v1"', rows: [mk(1), mk(2), mk(3)] }, { status: 200, etag: 'W/"v2"', rows: [mk(1), mk(4)] }]
    await open()
    const b = await open()
    expect(b.cases.map((c) => c.caseNumber.slice(-5))).toEqual(['00001', '00004'])
    const kept = store.readFeed(TIN, FEED)
    expect(kept?.etag).toBe('W/"v2"')
    expect(kept?.items).toHaveLength(2)
  })

  test('a download that breaks keeps the cases it already had, merges the new ones, marks the list partial and drops the ETag', async () => {
    script = [
      { status: 200, etag: 'W/"v1"', rows: [mk(1), mk(2), mk(3)] },
      { status: 200, etag: 'W/"v2"', rows: [mk(2, { status_name: 'Архивда' }), mk(9)], breakAfter: 2 },
      { status: 200, etag: 'W/"v3"', rows: [mk(1), mk(2), mk(3), mk(9)] },
    ]
    await open()
    const b = await open()
    expect(b.incomplete).toBe(true)
    expect(b.cases.map((c) => c.caseNumber.slice(-5)).sort()).toEqual(['00001', '00002', '00003', '00009'])
    expect(b.cases.find((c) => c.caseNumber.endsWith('00002'))?.caseStatus).toBe('Архивда')
    // the next ask carries NO ETag: a partial list must be fetched in full
    await open()
    expect(seen[2].inm).toBeNull()
  })

  test('a court that cannot be reached is answered from disk, flagged incomplete', async () => {
    script = [{ status: 200, etag: 'W/"v1"', rows: [mk(1), mk(2)] }, { status: 500 }, { status: 500 }, { status: 500 }]
    await open()
    const b = await open()
    expect(b.cases).toHaveLength(2)
    expect(b.incomplete).toBe(true)
  })

  test('with nothing stored and the court down the answer is empty and incomplete, as before', async () => {
    script = [{ status: 500 }, { status: 500 }, { status: 500 }]
    const a = await open()
    expect(a.cases).toEqual([])
    expect(a.incomplete).toBe(true)
  })
})
