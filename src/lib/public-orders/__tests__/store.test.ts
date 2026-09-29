import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { StoredOrder } from '@/core/public-orders'

mock.module('server-only', () => ({}))

let dir: string
beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pub-orders-'))
  process.env.PUBLIC_ORDERS_DIR = dir
})
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const order = (caseNumber: string, instance: string, id: string, result = 'FULFILLED'): StoredOrder => ({
  id, caseNumber, instance, result, court: 'C', judge: 'J', category: '', pdfId: 'p-' + id, pdfName: '', pdfSize: 1, courtType: 'ECONOMIC',
})

describe('shard store', () => {
  test('a case lookup returns exactly that case, oldest instance first', async () => {
    const { appendOrders, lookupOrders } = await import('../store')
    await appendOrders([
      order('4-1001-2619/21743', 'APPEAL', 'b'),
      order('4-1001-2619/21743', 'FIRST', 'a'),
      order('4-1401-2609/9788', 'FIRST', 'z'),
    ])
    expect((await lookupOrders('4-1001-2619/21743')).map((o) => o.id)).toEqual(['a', 'b'])
    expect((await lookupOrders(' 4-1401-2609/9788 ')).map((o) => o.id)).toEqual(['z'])
    expect(await lookupOrders('4-9999-0000/1')).toEqual([])
  })

  test('a case number that merely CONTAINS another is not confused with it', async () => {
    const { appendOrders, lookupOrders } = await import('../store')
    await appendOrders([order('4-1-2601/12', 'FIRST', 'short'), order('4-1-2601/123', 'FIRST', 'long')])
    expect((await lookupOrders('4-1-2601/12')).map((o) => o.id)).toEqual(['short'])
  })

  test('re-crawled rows do not duplicate: the last copy of an order id wins', async () => {
    const { appendOrders, lookupOrders } = await import('../store')
    await appendOrders([order('4-2-2601/1', 'FIRST', 'x', 'REFUSED')])
    await appendOrders([order('4-2-2601/1', 'FIRST', 'x', 'FULFILLED')])
    const got = await lookupOrders('4-2-2601/1')
    expect(got).toHaveLength(1)
    expect(got[0].result).toBe('FULFILLED')
  })

  test('concurrent appends do not interleave or lose rows', async () => {
    const { appendOrders, lookupOrders } = await import('../store')
    await Promise.all(Array.from({ length: 40 }, (_, i) => appendOrders([order('4-3-2601/7', 'FIRST', `c${i}`)])))
    expect(await lookupOrders('4-3-2601/7')).toHaveLength(40)
  })

  test('a torn last line (crash mid-write) is ignored, the rest still reads', async () => {
    const { appendOrders, lookupOrders, shardOf } = await import('../store')
    await appendOrders([order('4-4-2601/9', 'FIRST', 'ok')])
    await fs.appendFile(path.join(dir, 'shards', `${shardOf('4-4-2601/9').toString(16).padStart(3, '0')}.jsonl`), '{"id":"torn","caseNumber":"4-4-2601/9","ins')
    expect((await lookupOrders('4-4-2601/9')).map((o) => o.id)).toEqual(['ok'])
  })

  test('crawl state round-trips through disk atomically', async () => {
    const { loadState, saveState } = await import('../store')
    expect((await loadState()).types).toEqual({})
    await saveState({ version: 1, updatedAt: '', types: { ECONOMIC: { newest: '2026-06-10', oldest: '2026-06-01', emptyRun: 0, complete: false, rows: 5, days: 3, mismatches: 0 } } })
    expect((await loadState()).types.ECONOMIC?.rows).toBe(5)
  })

  test('the same case number always lands in the same shard, and shards spread across the space', async () => {
    const { shardOf, SHARDS } = await import('../store')
    expect(shardOf('4-1001-2619/21743')).toBe(shardOf(' 4-1001-2619/21743 '))
    const seen = new Set(Array.from({ length: 5000 }, (_, i) => shardOf(`4-1001-2619/${i}`)))
    expect(seen.size).toBeGreaterThan(SHARDS * 0.9)
  })
})
